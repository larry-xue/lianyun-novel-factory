import { and, eq, gte, inArray, lt, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  bookBriefs,
  bookStates,
  books,
  chapterRevisions,
  chapters,
  characters as charactersTbl,
  elements as elementsTbl,
  outlineNodes,
  plotThreads,
  runs,
  topicCards,
} from '../db/schema/index.ts';
import { countChineseChars } from '../llm/client.ts';
import {
  runStoryDesignerHarness,
  type StoryDesignerHarnessResult,
} from './story-designer-harness.ts';
import { loadPromptOrFallback } from './prompts.ts';
import { STORY_DESIGNER_SKILL_PROMPT } from '../prompts/story-designer-skill.system.ts';
import { GOLDEN_THREE_CHAPTERS_FRAGMENT } from '../prompts/fragments/index.ts';
import { type ChapterWriteResult } from '../mastra/agents/chapter-writer.ts';
import {
  reviseOutline,
  summarizeArc,
} from './book-maintenance.ts';
import { upsertDoc } from './book-docs.ts';
import {
  introduceThread,
  listOpenForChapter,
  markOverdueAsAbandoned,
  recordThreadEvent,
  type OpenThreadForChapter,
} from './plot-threads.ts';
import {
  BatchChapterPlanResultSchema,
  chapterPlanner,
  MilestoneSchema,
  type BatchChapterPlanResult,
  type ChapterBeat,
  type Milestone,
} from '../mastra/agents/chapter-planner.ts';
import {
  markChapterDone,
} from './outline-nodes.ts';
import { arcSummaries, bookDocs } from '../db/schema/index.ts';
import { createGateRequest } from './gates.ts';
import { runChildAgent } from './run-tracer.ts';
import { writeChapterViaHarness } from './chapter-writer-harness.ts';
import { runChapterQualityGate, type ChapterQualityGateResult } from './quality-linter.ts';
import { snapshotAfterChapter } from './chapter-snapshots.ts';
import { CancelledError, isAbortLikeError, withCancellation } from './cancellation.ts';

/**
 * 把"主体逻辑"包成「rootRunId 注册到 cancellation 注册表 + ALS 注入 signal」。
 * 任何子 agent / harness 都能读到 signal，从 fetch 层面被 abort。
 *
 * 出错时分流：CancelledError / AbortError → root run 标 cancelled、关联 book 标 paused；其他 → failure。
 * 调用方负责创建 rootRun 行；本函数负责包住其后的执行 + 失败时落地状态。
 *
 * bookIdRef 是引用：fn 执行过程中 produceBook 可能动态创建 book，cancel 时再读 ref.current。
 */
interface BookIdRef {
  current?: string;
}

async function runRootWithCancellation<T>(opts: {
  rootRunId: string;
  bookIdRef: BookIdRef;
  fn: () => Promise<T>;
}): Promise<T> {
  return await withCancellation(opts.rootRunId, async () => {
    try {
      return await opts.fn();
    } catch (err) {
      const cancelled = err instanceof CancelledError || isAbortLikeError(err);
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(runs)
        .set({
          status: cancelled ? 'cancelled' : 'failure',
          finishedAt: new Date(),
          errorMd: cancelled ? '用户中断' : message,
        })
        .where(eq(runs.id, opts.rootRunId));
      if (cancelled && opts.bookIdRef.current) {
        // book_status enum 没有 cancelled，用 paused 表示「当前没有活跃跑批，可手动 resume」
        await db
          .update(books)
          .set({ status: 'paused' })
          .where(eq(books.id, opts.bookIdRef.current));
      }
      throw err;
    }
  });
}

/**
 * 给 chapter-planner / chapter-writer / consistency-guard 用的运行期上下文。
 *
 * brief 元数据（logline / audience / mainArc / protagonist）从 books 表读，
 * 由 story-designer-harness 在立项 commit 时落入。
 *
 * vaultDocs 是整本书的活文档（character / world / style / relations + 题材
 * 自创 kind），排除 chapter-plan / milestone / reader_notes（后两者是"运行期
 * 衍生"或"主编私人"的，不进 prompt）。**风格** 从 vault docs(kind='style', ...)
 * 自然注入，不再单独抽出来；早期的 style_profiles 指纹机制已删。整批一次性贴
 * prompt，章节循环里随 living-doc-updater 增量变。
 *
 * characters 是 (name, role) 索引行，给 active_characters 引用 / book_states
 * 用；完整角色档案在 docs/character/<slug>。
 */
interface BookContext {
  title: string;
  loglineMd: string;
  audience: string;
  mainArcMd: string;
  protagonist: string;
  characters: Array<{ name: string; role: string }>;
  vaultDocs: Array<{ kind: string; slug: string; title: string; contentMd: string }>;
}

const ProduceInput = z.object({
  topicTitle: z.string().min(2).max(40),
  pitch: z.string().min(10),
  elementSlugs: z.array(z.string().min(1)).min(1).max(10),
  classification: z
    .object({
      mainCategory: z.string(),
      themes: z.array(z.string()).default([]),
      characterTypes: z.array(z.string()).default([]),
      plotElements: z.array(z.string()).default([]),
    })
    .optional(),
  totalChapters: z.number().int().min(1).max(5000).default(1),
  charsPerChapter: z.number().int().min(500).max(8000).default(3000),
  /** S5 加：gate 行为模式。fully-auto 一路跑到底；其他模式 gate-1/2/3 在未来 S8 实装时挂起 */
  gateMode: z.enum(['fully-auto', 'auto-with-confirm', 'manual']).default('fully-auto'),
  /** 第 1 章 char_count 低于这个值就 kill 掉本书，停止后续章节生成 */
  earlyKillBelowChars: z.number().int().min(0).default(2200),
  /** 一致性 guard 失败时最多重写次数 */
  maxGuardRetries: z.number().int().min(0).max(3).default(1),
  /** 章末加 hook-smith 强化（默认开） */
  useHookSmith: z.boolean().default(true),
  /** 每 N 章触发一次 arc-summarizer；0 = 关闭（默认）。
   * 长篇生产里 arc 摘要会把上一弧的所有设定固化成"既成历史"喂回下一弧 planner，
   * 反而加速题材漂移。题材契约 + 设定预算 + canonical-numbers + cast 已替代它的长程记忆职责。
   * 写 100+ 章长书需要跨弧摘要时再手动开启。 */
  arcSummaryEvery: z.number().int().min(0).max(50).default(0),
  /** 每 M 章触发一次 plan-reviser 检查大纲；0 = 关闭 */
  planRevisionEvery: z.number().int().min(0).max(20).default(0),
  /** 每章写作前跑 chapter-planner 做战术规划（默认开） */
  useChapterPlanner: z.boolean().default(true),
  /** chapter-planner 回看最近 N 章内容 */
  plannerLookbackChapters: z.number().int().min(1).max(10).default(3),
  /** 创建者；从 server fn 透传 currentUser.id；脚本 / batch 等场景可不传 */
  ownerId: z.string().uuid().optional(),
  /** Pilot 模式：每写完一章打全量 chapter_snapshots，便于回退。默认关。 */
  pilot: z.boolean().default(false),
  /** Pilot 触发自哪个 batch（用于关联 chapter_snapshots.batch_id）。 */
  batchId: z.string().uuid().optional(),
});
export type ProduceInput = z.infer<typeof ProduceInput>;

export interface ProduceResult {
  bookId: string;
  rootRunId: string;
  chaptersWritten: number;
  totalCharCount: number;
  averageCharCount: number;
  killed: boolean;
  killReason?: string;
}

/* ──────────────────────────────────────────────
 * 动态规划 helpers：替代旧 outline-architect
 * ────────────────────────────────────────────── */

/**
 * 加载书的运行期上下文：brief 从 books 表读，characters 从 characters 表读，
 * vault docs 从 book_docs 全量读（排除 chapter-plan / milestone / reader_notes）。
 */
async function loadBookContext(bookId: string): Promise<BookContext> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error(`loadBookContext: book ${bookId} 不存在`);

  const docs = await db
    .select({
      kind: bookDocs.kind,
      slug: bookDocs.slug,
      title: bookDocs.title,
      contentMd: bookDocs.contentMd,
    })
    .from(bookDocs)
    .where(eq(bookDocs.bookId, bookId))
    .orderBy(asc(bookDocs.kind), asc(bookDocs.slug));

  const vaultDocs = docs.filter(
    (d) => d.kind !== 'chapter-plan' && d.kind !== 'milestone' && d.kind !== 'reader_notes',
  );

  const chars = await db
    .select({ name: charactersTbl.name, role: charactersTbl.role })
    .from(charactersTbl)
    .where(eq(charactersTbl.bookId, bookId));

  return {
    title: book.title,
    loglineMd: book.loglineMd,
    audience: book.audience,
    mainArcMd: book.mainArcMd,
    protagonist: book.protagonist,
    characters: chars,
    vaultDocs,
  };
}

/**
 * 用户在 chapter-scout chat 钦点的 chapter-plan：
 * book_docs(kind='chapter-plan', slug='ch{idx}-plan', pinned_by_user=true)
 * 命中 → 还原成 ChapterBeat，覆盖 planner 当章输出。
 */
async function getPinnedChapterPlan(bookId: string, idx: number): Promise<ChapterBeat | null> {
  const [row] = await db
    .select({ title: bookDocs.title, meta: bookDocs.meta })
    .from(bookDocs)
    .where(
      and(
        eq(bookDocs.bookId, bookId),
        eq(bookDocs.kind, 'chapter-plan'),
        eq(bookDocs.slug, `ch${idx}-plan`),
        eq(bookDocs.pinnedByUser, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  const beat = (row.meta as { beat?: Partial<ChapterBeat> & { title?: string; summaryMd?: string; intent?: string } })
    ?.beat;
  if (!beat) return null;
  return {
    idx,
    title: beat.title ?? row.title,
    summaryMd: beat.summaryMd ?? '',
    intent: beat.intent ?? '',
  };
}

/**
 * 找当前 chapterIdx 所属的 milestone（覆盖该章节的 startIdx 最大且 ≤ idx 的那份）。
 * 从 book_docs(kind='milestone').meta.milestone 直接还原 Milestone 对象。
 */
async function getCurrentMilestoneForChapter(
  bookId: string,
  idx: number,
): Promise<Milestone | null> {
  const rows = await db
    .select({ slug: bookDocs.slug, meta: bookDocs.meta })
    .from(bookDocs)
    .where(and(eq(bookDocs.bookId, bookId), eq(bookDocs.kind, 'milestone')));

  let best: { startIdx: number; meta: Record<string, unknown> } | null = null;
  for (const row of rows) {
    const m = row.slug.match(/^milestone-ch(\d+)$/);
    if (!m) continue;
    const startIdx = Number(m[1]);
    if (startIdx > idx) continue;
    if (!best || startIdx > best.startIdx) {
      best = { startIdx, meta: row.meta as Record<string, unknown> };
    }
  }
  if (!best) return null;
  const raw = (best.meta as { milestone?: unknown })?.milestone;
  if (!raw) return null;
  const parsed = MilestoneSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * 从 outline_nodes 中取下一批已规划但未完成的章拍。pacingPhase 不挂在 beat 上
 * （由 milestone 提供），所以这里只取 idx/title/summaryMd/intent。
 */
async function getNextPlannedBeats(bookId: string, limit = 10): Promise<ChapterBeat[]> {
  const nodes = await db
    .select({
      idx: outlineNodes.idx,
      title: outlineNodes.title,
      summaryMd: outlineNodes.summaryMd,
      intent: outlineNodes.intent,
    })
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.bookId, bookId),
        eq(outlineNodes.level, 'chapter'),
        eq(outlineNodes.status, 'planned'),
      ),
    )
    .orderBy(asc(outlineNodes.idx))
    .limit(limit);

  return nodes.map((n) => ({
    idx: n.idx,
    title: n.title,
    summaryMd: n.summaryMd,
    intent: n.intent,
  }));
}

/**
 * 调用 chapter-planner 生成下一段 milestone + chapterBeats。
 * 副作用：milestone 落 book_docs(kind='milestone', slug='milestone-ch{startIdx}')，
 *        beat 写入 outline_nodes（pacingPhase 用 milestone 的）。
 */
async function planBatchChapters(opts: {
  rootRunId: string;
  bookId: string;
  bookContext: BookContext;
  totalChapters: number;
  charsPerChapter: number;
  startIdx: number;
  batchSize: number;
}): Promise<{ milestone: Milestone; chapterBeats: ChapterBeat[] }> {
  // 收集上下文
  const prevState = await getLatestState(opts.bookId);
  const openThreads = await listOpenForChapter(opts.bookId, opts.startIdx);

  const lookbackStart = Math.max(1, opts.startIdx - 3);
  const recentChapters =
    opts.startIdx > 1
      ? await db
          .select({ idx: chapters.idx, title: chapters.title, contentMd: chapters.contentMd })
          .from(chapters)
          .where(
            and(
              eq(chapters.bookId, opts.bookId),
              gte(chapters.idx, lookbackStart),
              lt(chapters.idx, opts.startIdx),
            ),
          )
          .orderBy(chapters.idx)
      : [];

  // 题材契约 + canonical-numbers + cast：从 books 行 + 约定 slug 的 lore 文档读
  const [bookRow] = await db
    .select({
      protagonist: books.protagonist,
      mainCategory: books.mainCategory,
      themes: books.themes,
      prohibitedTropes: books.prohibitedTropes,
    })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);
  const protagonist = bookRow?.protagonist ?? '';
  const canonicalNumbersDoc = await loadCanonicalNumbersDoc(opts.bookId);
  const castDoc = await loadCastDoc(opts.bookId);

  // 组装 prompt：完整角色档案在 docs/character/<x>，characters 表只列 name/role
  const characters = opts.bookContext.characters
    .map((c) => `- ${c.name}（${c.role}）`)
    .join('\n');

  const threadsBlock = openThreads.length
    ? formatThreadClipboard(openThreads, opts.startIdx, 12)
    : '（暂无未回收伏笔）';

  const recentBlock = recentChapters.length
    ? recentChapters
        .map((c) => `### 第 ${c.idx} 章 ${c.title}\n${truncate(c.contentMd, 600)}`)
        .join('\n\n')
    : '（尚无前文）';

  const stateBlock = prevState ? stateToContext(prevState) : '（尚无前文状态）';

  // vault 全量（character / world / style / relations / lore / 自创 kind 等），
  // 每条限 300 字摘要。design / lore 两个旧分块统一在这里。
  const vaultBlock = opts.bookContext.vaultDocs.length
    ? opts.bookContext.vaultDocs
        .map((d) => `### docs/${d.kind}/${d.slug} · ${d.title}\n${oneLine(d.contentMd, 300)}`)
        .join('\n\n')
    : '（暂无活文档）';

  const themesStr = (bookRow?.themes ?? []).join('、') || '（未指定）';
  const prohibitedStr =
    (bookRow?.prohibitedTropes ?? []).map((t) => `- ${t}`).join('\n') ||
    '（未指定；planner 自行评估题材边界）';
  const canonicalBlock = canonicalNumbersDoc
    ? canonicalNumbersDoc.contentMd
    : '（暂未建立 canonical-numbers；如本批引入数字型设定，请记得稳定）';
  const castBlock = castDoc
    ? castDoc.contentMd
    : '（暂未建立 cast 台账；如本批让某角色登场或退场，记录到 cast）';

  const prompt = [
    `## 题材契约（不可违反）`,
    `主角：${protagonist || '（未设；请告诉用户报错）'}`,
    `主分类：${bookRow?.mainCategory || '（未指定）'}`,
    `题材：${themesStr}`,
    `禁止套路（红线）：`,
    prohibitedStr,
    `**任何 keyAnchor / newConcept 都不能踩红线；如发现既有剧情已偏向红线，milestone 必须把方向拉回。**`,
    ``,
    `## POV 锁`,
    `本书 POV 角色 = 主角 = "${protagonist}"。`,
    `milestone.povCharacter 必须 = "${protagonist}"。**主角不能下线、POV 不能切给配角，即使叙事方便也不行。**`,
    ``,
    `## canonical-numbers（数字稳定）`,
    canonicalBlock,
    ``,
    `## 在场角色 cast（POV/主线/支线 角色台账）`,
    castBlock,
    ``,
    `## 书`,
    `《${opts.bookContext.title}》`,
    `一句话：${oneLine(opts.bookContext.loglineMd, 160)}`,
    `主线：${oneLine(opts.bookContext.mainArcMd, 200)}`,
    `目标读者：${opts.bookContext.audience}`,
    ``,
    `## 活文档（vault：character / world / style / relations / 自创 kind）`,
    vaultBlock,
    ``,
    `## 角色`,
    characters || '（暂无角色信息——请从活文档里 character/<x> doc 推断）',
    ``,
    `## 当前状态`,
    stateBlock,
    ``,
    `## 开放伏笔`,
    threadsBlock,
    ``,
    `## 近几章内容`,
    recentBlock,
    ``,
    `## 规划任务`,
    `已写章数：${opts.startIdx - 1}`,
    `总目标章数：${opts.totalChapters}`,
    `每章字数：${opts.charsPerChapter}`,
    `本次规划：第 ${opts.startIdx} 章开始，规划 ${opts.batchSize} 章`,
    ``,
    `综合以上所有信息，规划下一批 ${opts.batchSize} 章的战术节拍。`,
    `idx 从 ${opts.startIdx} 开始连续递增。`,
    `**设定预算：milestone.newConcepts 最多 1 个；引用既有设定不算新概念，不要列出。**`,
    // 黄金 3 章：仅当本批 plan 覆盖 idx ≤ 3 时注入爆款约束
    ...(opts.startIdx <= 3 ? [``, GOLDEN_THREE_CHAPTERS_FRAGMENT] : []),
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'chapter-planner',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { startIdx: opts.startIdx, batchSize: opts.batchSize, totalChapters: opts.totalChapters },
    agent: chapterPlanner,
    schema: BatchChapterPlanResultSchema,
    prompt,
  });

  // POV 锁强制校验：milestone.povCharacter 必须 = books.protagonist
  if (protagonist && result.milestone.povCharacter !== protagonist) {
    throw new Error(
      `[chapter-planner] POV 锁违反：milestone.povCharacter="${result.milestone.povCharacter}"，但 books.protagonist="${protagonist}"。POV 不能切给配角。`,
    );
  }
  if (!protagonist) {
    console.warn(
      `[chapter-planner] book ${opts.bookId} 的 protagonist 字段为空，POV 锁无法生效。请在立项时设置主角。`,
    );
  }

  // 将章拍写入 outline_nodes（pacingPhase 来自 milestone）
  for (const beat of result.chapterBeats) {
    try {
      await db.insert(outlineNodes).values({
        bookId: opts.bookId,
        level: 'chapter',
        idx: beat.idx,
        title: beat.title,
        summaryMd: beat.summaryMd,
        intent: beat.intent,
        pacingPhase: result.milestone.pacingPhase,
        status: 'planned',
        generatedByRunId: opts.rootRunId,
      });
    } catch (e) {
      // idx 已存在（之前批次或重跑），跳过
      console.warn(`[planBatchChapters] insert beat ch${beat.idx} failed (may already exist): ${e instanceof Error ? e.message : e}`);
    }
  }

  // 保存 milestone 到 book_docs（content_md 给人看，meta.milestone 给程序读）
  const endIdx = opts.startIdx + result.chapterBeats.length - 1;
  try {
    await upsertDoc({
      bookId: opts.bookId,
      kind: 'milestone',
      slug: `milestone-ch${opts.startIdx}`,
      title: `Milestone：${result.milestone.name}（ch${opts.startIdx}-${endIdx}）`,
      contentMd: formatMilestoneDoc(result.milestone, opts.startIdx, endIdx),
      editor: 'agent',
      reasonMd: `chapter-planner 规划 ch${opts.startIdx}-${endIdx}`,
      runId: opts.rootRunId,
      meta: { milestone: result.milestone, startIdx: opts.startIdx, endIdx },
    });
  } catch (e) {
    console.warn(`[planBatchChapters] save milestone failed: ${e instanceof Error ? e.message : e}`);
  }

  return { milestone: result.milestone, chapterBeats: result.chapterBeats };
}

function formatMilestoneDoc(m: Milestone, startIdx: number, endIdx: number): string {
  return [
    `# Milestone：${m.name}`,
    ``,
    `**章节范围**：第 ${startIdx}-${endIdx} 章`,
    `**节拍阶段**：${m.pacingPhase}`,
    ``,
    `## 推进目标`,
    m.goalMd,
    ``,
    `## 必须触达的剧情锚点`,
    m.keyAnchors.map((a, i) => `${i + 1}. ${a}`).join('\n'),
  ].join('\n');
}

export async function produceBook(input: unknown): Promise<ProduceResult> {
  const cfg = ProduceInput.parse(input);
  const {
    topicTitle,
    pitch,
    elementSlugs,
    totalChapters,
    charsPerChapter,
    earlyKillBelowChars,
    maxGuardRetries,
    useHookSmith,
    arcSummaryEvery,
    planRevisionEvery,
  } = cfg;

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'produce-book',
      status: 'running',
      input: cfg as unknown as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('failed to insert root run');

  const bookIdRef: BookIdRef = {};
  return await runRootWithCancellation({
    rootRunId: rootRun.id,
    bookIdRef,
    fn: async () => {
    // 创建 book（不再一次性生成大纲，由 chapter-planner 动态规划）。
    // 风格走 vault docs(kind='style', ...) 路径，立项不再钦点指纹。
    const [book] = await db
      .insert(books)
      .values({
        title: topicTitle,
        status: cfg.gateMode === 'fully-auto' ? 'writing' : 'planning',
        gateMode: cfg.gateMode,
        ownerId: cfg.ownerId ?? null,
        elementSlugs,
        mainCategory: cfg.classification?.mainCategory ?? '',
        themes: cfg.classification?.themes ?? [],
        characterTypes: cfg.classification?.characterTypes ?? [],
        plotElements: cfg.classification?.plotElements ?? [],
        meta: {
          targetChapters: totalChapters,
          targetCharsPerChapter: charsPerChapter,
          produceCfg: cfg as unknown as Record<string, unknown>,
        },
      })
      .returning();
    if (!book) throw new Error('failed to insert book');
    bookIdRef.current = book.id;

    await db.update(runs).set({ bookId: book.id }).where(eq(runs.id, rootRun.id));

    // 立项设计阶段：跑 story-designer harness 一气呵成产 vault + 落 brief。
    // brief（loglineMd / audience / mainArcMd / protagonist / prohibitedTropes）
    // 由 commitStoryDesignerSession 直接落 books 表，protagonist 同时建立 POV 锁。
    const designResult = await runStoryDesignFromPitch({
      bookId: book.id,
      rootRunId: rootRun.id,
      bookTitle: topicTitle,
      pitch,
      elementSlugs,
      classification: cfg.classification,
    });

    // 初始 bookState：activeCharacters 至少含主角。其他角色在第一章 living-doc-updater
    // 自动登记到 character/<x> doc + book_states 增量。
    await db.insert(bookStates).values({
      bookId: book.id,
      chapterIdx: 0,
      arcStage: '开篇',
      activeCharacters: [{ name: designResult.brief.protagonistName, status: '主角' }],
      lastEventSummaryMd: '尚未开篇。',
      nextChapterIntentMd: '开篇',
      generatedByRunId: rootRun.id,
    });

    if (cfg.gateMode !== 'fully-auto') {
      await createGateRequest({
        bookId: book.id,
        kind: 'gate-1',
        triggeredByRunId: rootRun.id,
        noteMd: '立项 gate：设计文档就绪。点确认开始写作。',
        payload: { chapterCount: totalChapters, charsPerChapter },
      });
      // 同 produceForExistingBook：root run 到此完工，章节循环在 resumeAfterGate1
      // 的新 root run 里跑。不标 success 这条会永远 running。
      await db
        .update(runs)
        .set({
          status: 'success',
          finishedAt: new Date(),
          output: { phase: 'awaiting-gate-1', chaptersWritten: 0 },
        })
        .where(eq(runs.id, rootRun.id));
      return {
        bookId: book.id,
        rootRunId: rootRun.id,
        chaptersWritten: 0,
        totalCharCount: 0,
        averageCharCount: 0,
        killed: false,
      };
    }

    const bookContext = await loadBookContext(book.id);
    return await runChapterLoop({
      book,
      rootRunId: rootRun.id,
      bookContext,
      totalChapters,
      charsPerChapter,
      earlyKillBelowChars,
      maxGuardRetries,
      useHookSmith,
      arcSummaryEvery,
      planRevisionEvery,
      pilot: cfg.pilot,
      batchId: cfg.batchId,
    });
    },
  });
}

/**
 * 章节循环。从 produceBook 中抽出，让 gate-1 暂停后能从外部 resume 调用。
 * 使用动态规划：chapter-planner 每次生成 5-10 章节拍，写完再规划下一批。
 */
interface ChapterLoopOpts {
  book: typeof books.$inferSelect;
  rootRunId: string;
  bookContext: BookContext;
  totalChapters: number;
  charsPerChapter: number;
  earlyKillBelowChars: number;
  maxGuardRetries: number;
  useHookSmith: boolean;
  arcSummaryEvery: number;
  planRevisionEvery: number;
  /** Pilot 模式：每章写完后打 chapter_snapshots 全量快照，供 UI 回退。 */
  pilot?: boolean;
  /** 关联的 batch_id；snapshot 写入时关联，方便 UI 看哪些 snapshot 来自同一次跑批。 */
  batchId?: string;
}

/**
 * 写单章的全套副作用：生成 → guard 重写 → hook/polish → 入库 → bookStates → threadActions → 章末扫描超期 → 活文档更新 → arcSummary。
 * 由 runChapterLoop 在 for 循环里调用，也由 writeNextChapter 单独调用（增量续写入口）。
 */
interface WriteOneChapterResult {
  charCount: number;
  killed: boolean;
  killReason?: string;
}

async function writeOneChapter(
  opts: ChapterLoopOpts & { idx: number; beat: ChapterBeat; milestone: Milestone },
): Promise<WriteOneChapterResult> {
  const {
    book,
    rootRunId,
    bookContext,
    totalChapters,
    charsPerChapter,
    earlyKillBelowChars,
    maxGuardRetries,
    useHookSmith,
    arcSummaryEvery,
    planRevisionEvery,
    idx,
    beat,
    milestone,
  } = opts;

  const openThreadsForChapter = await listOpenForChapter(book.id, idx);

  // Harness 模式：writer 自己用 list/read/grep/update_doc/mark_thread 探索 + 维护活文档。
  // 不再静态拼 lore / arc 摘要进 prompt（writer 按需 read）。
  const prevState = await getLatestState(book.id);

  // 一次性载入 quality gate 需要的不变上下文（题材契约 / canonical / cast / 上一章 hook）
  const [bookRow] = await db
    .select({
      protagonist: books.protagonist,
      prohibitedTropes: books.prohibitedTropes,
    })
    .from(books)
    .where(eq(books.id, book.id))
    .limit(1);
  const canonicalDoc = await loadCanonicalNumbersDoc(book.id);
  const castDoc = await loadCastDoc(book.id);

  // chapter-writer + quality gate retry 循环
  let attempt = 0;
  let harnessRes!: Awaited<ReturnType<typeof writeChapterViaHarness>>;
  let gateResult: ChapterQualityGateResult | undefined;
  let rewriteHintMd: string | undefined;
  const revisions: Array<{ kind: 'raw' | 'gate_rejected'; contentMd: string; runId: string; notesMd: string }> = [];

  while (true) {
    harnessRes = await writeChapterViaHarness({
      rootRunId,
      bookId: book.id,
      idx,
      totalChapters,
      charsPerChapter,
      bookContext,
      beat,
      milestone,
      prevStateText: stateToContext(prevState),
      openThreadsForChapter,
      rewriteHintMd,
    });

    gateResult = await runChapterQualityGate({
      rootRunId,
      bookId: book.id,
      chapterIdx: idx,
      chapterTitle: harnessRes.final.title,
      chapterContentMd: harnessRes.final.contentMd,
      protagonist: bookRow?.protagonist ?? '',
      prohibitedTropes: bookRow?.prohibitedTropes ?? [],
      canonicalNumbersMd: canonicalDoc?.contentMd ?? '',
      castMd: castDoc?.contentMd ?? '',
      lastHookMd: prevState?.lastHookMd ?? '',
      bookTitle: book.title,
      audience: bookContext.audience,
      mainArcMd: bookContext.mainArcMd,
    });

    if (gateResult.passed) {
      revisions.push({
        kind: 'raw',
        contentMd: harnessRes.final.contentMd,
        runId: harnessRes.runId,
        notesMd: `harness: ${harnessRes.toolCallCount} tool calls, ${harnessRes.turns} turns; gate-attempt=${attempt}`,
      });
      break;
    }

    // 失败：留稿 + 准备重写
    revisions.push({
      kind: 'gate_rejected',
      contentMd: harnessRes.final.contentMd,
      runId: harnessRes.runId,
      notesMd: `gate fail @attempt ${attempt}: ${gateResult.deterministic.passed ? 'LLM' : 'deterministic'} layer; ${gateResult.llmReport?.summaryMd ?? gateResult.deterministic.rewriteHintMd.slice(0, 80)}`,
    });

    if (attempt >= maxGuardRetries) {
      console.warn(
        `[writeOneChapter] ch${idx}: quality gate 重试 ${maxGuardRetries} 次仍未过；放行带 issues 入库（保留 gate report 在 chapter.scores）`,
      );
      break;
    }
    attempt++;
    rewriteHintMd = gateResult.rewriteHintMd;
  }

  const written = {
    final: harnessRes.final,
    guardPassed: gateResult?.passed ?? false,
    retries: attempt,
    revisions,
    gateResult,
  };

  const charCount = countChineseChars(written.final.contentMd);
  const gateScoreSummary = written.gateResult
    ? {
        deterministicPassed: written.gateResult.deterministic.passed,
        deterministicHits: written.gateResult.deterministic.hits.length,
        llmPassed: written.gateResult.llmReport?.passed ?? null,
        llmIssues:
          written.gateResult.llmReport?.issues.map((i) => ({
            kind: i.kind,
            severity: i.severity,
          })) ?? null,
        llmSummaryMd: written.gateResult.llmReport?.summaryMd ?? null,
      }
    : null;
  const [chapterRow] = await db
    .insert(chapters)
    .values({
      bookId: book.id,
      idx,
      title: written.final.title,
      contentMd: written.final.contentMd,
      charCount,
      status: 'final',
      scores: {
        hookMd: written.final.hookMd,
        guardPassed: written.guardPassed,
        guardRetries: written.retries,
        qualityGate: gateScoreSummary,
      },
    })
    .returning();

  if (chapterRow) {
    for (const rev of written.revisions) {
      await db.insert(chapterRevisions).values({
        chapterId: chapterRow.id,
        kind: rev.kind,
        contentMd: rev.contentMd,
        charCount: countChineseChars(rev.contentMd),
        runId: rev.runId,
        notesMd: rev.notesMd ?? '',
      });
    }

    // 回填 outline_node：标 done、关联 chapterId
    try {
      await markChapterDone(book.id, idx, chapterRow.id, written.final.newState.lastEventSummaryMd);
    } catch (e) {
      console.warn(`[writeOneChapter] markChapterDone(ch${idx}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  await db.insert(bookStates).values({
    bookId: book.id,
    chapterIdx: idx,
    arcStage: written.final.newState.arcStage,
    activeCharacters: written.final.newState.activeCharacters,
    lastEventSummaryMd: written.final.newState.lastEventSummaryMd,
    // 章末 hook 写回：下一章 prompt 顶部贴回原文，writer 必须显式接续
    lastHookMd: extractLastHook(written.final.contentMd, written.final.hookMd),
    nextChapterIntentMd: written.final.newState.nextChapterIntentMd,
    generatedByRunId: rootRunId,
  });

  await applyThreadActions({
    bookId: book.id,
    chapterIdx: idx,
    rootRunId,
    actions: written.final.newState.threadActions,
  });

  try {
    const abandoned = await markOverdueAsAbandoned(book.id, idx, 5, rootRunId);
    if (abandoned.length) {
      console.log(`[writeOneChapter] ch${idx}: auto-abandoned ${abandoned.length} overdue thread(s)`);
    }
  } catch (e) {
    console.warn(
      `[writeOneChapter] markOverdueAsAbandoned(ch${idx}) failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  if (idx === 1 && charCount < earlyKillBelowChars) {
    return {
      charCount,
      killed: true,
      killReason: `首章字数 ${charCount} < ${earlyKillBelowChars}，淘汰`,
    };
  }

  // Harness 模式下，writer 已通过 update_doc 在 commit 阶段维护了活文档，无需独立 living-doc-updater。

  if (arcSummaryEvery > 0 && idx % arcSummaryEvery === 0) {
    const arcIdx = Math.ceil(idx / arcSummaryEvery);
    try {
      await summarizeArc({
        bookId: book.id,
        rootRunId,
        arcIdx,
        rangeStart: idx - arcSummaryEvery + 1,
        rangeEnd: idx,
      });
    } catch (e) {
      console.warn(`[writeOneChapter] arc-summarizer(arc${arcIdx}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (planRevisionEvery > 0 && idx % planRevisionEvery === 0 && idx < totalChapters) {
    try {
      await reviseOutline({ bookId: book.id, rootRunId, upToChapterIdx: idx });
    } catch (e) {
      console.warn(`[writeOneChapter] plan-reviser(ch${idx}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { charCount, killed: false };
}

async function runChapterLoop(opts: ChapterLoopOpts): Promise<ProduceResult> {
  const {
    book,
    rootRunId,
    bookContext,
    totalChapters,
    charsPerChapter,
    pilot = false,
    batchId,
  } = opts;

  let totalChars = 0;
  let chaptersWritten = 0;
  let killed = false;
  let killReason: string | undefined;
  let plannedBeats: ChapterBeat[] = [];
  let currentMilestone: Milestone | undefined;

  try {
    for (let idx = 1; idx <= totalChapters; idx++) {
      // 动态规划：仅当当前章没有已规划 beat 时才触发下一批 plan。
      // 旧实现是 remaining < 5 就 plan，导致 milestone-chN 与 milestone-chM 区间 overlap
      // （N 段还剩 4 章时就开始规划 M 段，M.startIdx 落在 N 区间内，writer 半路换轨）。
      // 现在改成 remaining 跑完 → plan 下一段，保证 milestone 区间永不重叠。
      const remaining = plannedBeats.filter((b) => b.idx >= idx);
      const totalRemaining = totalChapters - idx + 1;
      if (remaining.length === 0 && totalRemaining > 0) {
        try {
          const batchSize = Math.min(10, totalRemaining);
          const planned = await planBatchChapters({
            rootRunId,
            bookId: book.id,
            bookContext,
            totalChapters,
            charsPerChapter,
            startIdx: idx,
            batchSize,
          });
          plannedBeats = planned.chapterBeats;
          currentMilestone = planned.milestone;
        } catch (e) {
          console.warn(`[runChapterLoop] planBatchChapters(ch${idx}) failed: ${e instanceof Error ? e.message : e}`);
          throw new Error(`无法规划第 ${idx} 章，chapter-planner 失败且无已规划章拍`);
        }
      }

      // 找到当前章的 beat + milestone。Pinned chapter-plan 优先：
      // chapter-scout chat 钦点的 beat 直接覆盖 planner 的输出，下游 writer 不感知差异。
      let beat = plannedBeats.find((b) => b.idx === idx);
      const pinned = await getPinnedChapterPlan(book.id, idx);
      if (pinned) beat = pinned;
      if (!beat) {
        console.warn(`[runChapterLoop] no planned beat for chapter ${idx}, stopping`);
        break;
      }
      if (!currentMilestone) {
        throw new Error(`无 milestone 上下文，无法写第 ${idx} 章`);
      }

      const r = await writeOneChapter({ ...opts, idx, beat, milestone: currentMilestone });
      totalChars += r.charCount;
      chaptersWritten = idx;

      if (pilot && !r.killed) {
        try {
          await snapshotAfterChapter({
            bookId: book.id,
            chapterIdx: idx,
            batchId: batchId ?? null,
            kind: 'pilot',
            noteMd: `pilot 跑批第 ${idx} 章末快照`,
          });
        } catch (e) {
          console.warn(
            `[runChapterLoop] snapshotAfterChapter(ch${idx}) failed: ${e instanceof Error ? e.message : e}`,
          );
        }
      }

      if (r.killed) {
        killed = true;
        killReason = r.killReason;
        break;
      }
    }

    await db
      .update(books)
      .set({
        status: killed
          ? 'killed'
          : chaptersWritten === totalChapters
            ? 'completed'
            : 'paused',
      })
      .where(eq(books.id, book.id));

    await db
      .update(runs)
      .set({
        status: killed ? 'cancelled' : 'success',
        finishedAt: new Date(),
        output: {
          chaptersWritten,
          totalChars,
          killed,
          killReason,
        },
      })
      .where(eq(runs.id, rootRunId));

    return {
      bookId: book.id,
      rootRunId: rootRunId,
      chaptersWritten,
      totalCharCount: totalChars,
      averageCharCount: chaptersWritten ? Math.round(totalChars / chaptersWritten) : 0,
      killed,
      killReason,
    };
  } catch (err) {
    // failure / cancelled 的状态写入交给外层 runRootWithCancellation 统一处理；
    // 这里只确保最终状态来自一个地方，避免双写竞态。
    throw err;
  }
}


/**
 * 渲染「可回收伏笔清单」给 chapter-writer 与 consistency-guard 看。
 * 按优先级分组：P0 已超期 → P1 临近窗口 / 长线伏笔 → 其他（截断）。
 */
function formatThreadClipboard(
  threads: OpenThreadForChapter[],
  currentIdx: number,
  limitOthers: number,
): string {
  if (threads.length === 0) return '（暂无未回收伏笔）';

  const overdue = threads.filter((t) => t.isOverdue);
  const urgent = threads.filter(
    (t) => !t.isOverdue && (t.weight === 'book' || t.chaptersUntilDeadline <= 3),
  );
  const others = threads.filter((t) => !overdue.includes(t) && !urgent.includes(t));

  const fmt = (t: OpenThreadForChapter): string => {
    const tag = t.isOverdue
      ? `已超期 ${currentIdx - t.expectedPayoffEnd} 章`
      : `还剩 ${t.chaptersUntilDeadline} 章窗口`;
    const trigger = t.payoffTriggerMd ? ` · 触发：${oneLine(t.payoffTriggerMd, 60)}` : '';
    return `- slug=${t.slug} · weight=${t.weight} · status=${t.status} · 第 ${t.introducedAtChapterIdx} 章引入 · ${tag}\n  ${oneLine(t.title, 80)}${trigger}`;
  };

  const parts: string[] = [];
  if (overdue.length) {
    parts.push('### [P0 已超期，必须 pay 或在 noteMd 解释为何跳过]');
    parts.push(...overdue.map(fmt));
    parts.push('');
  }
  if (urgent.length) {
    parts.push('### [P1 临近窗口或长线伏笔]');
    parts.push(...urgent.map(fmt));
    parts.push('');
  }
  if (others.length) {
    const shown = others.slice(0, limitOthers);
    parts.push(
      `### [其他 open/hinted${others.length > limitOthers ? `（共 ${others.length}，列前 ${limitOthers}）` : ''}]`,
    );
    parts.push(...shown.map(fmt));
  }
  return parts.join('\n');
}

/**
 * 把 chapter-writer 声明的 threadActions 落到 plot_threads / plot_thread_events。
 * 失败仅 console.warn，不阻塞主循环——单个 action 处理失败不能影响章节入库。
 */
async function applyThreadActions(opts: {
  bookId: string;
  chapterIdx: number;
  rootRunId: string;
  actions: ChapterWriteResult['newState']['threadActions'];
}): Promise<void> {
  const actions = opts.actions ?? [];

  for (const action of actions) {
    try {
      if (action.kind === 'introduce') {
        if (!action.title?.trim()) {
          console.warn(
            `[produceBook] threadAction introduce 缺 title (ch${opts.chapterIdx})，跳过`,
          );
          continue;
        }
        await introduceThread({
          bookId: opts.bookId,
          title: action.title.trim(),
          slug: action.slug,
          weight: action.weight,
          payoffWindowChapters: action.payoffWindowChapters,
          payoffTriggerMd: action.payoffTriggerMd,
          introducedAtChapterIdx: opts.chapterIdx,
          detailMd: action.noteMd,
          generatedByRunId: opts.rootRunId,
          noteMd: action.noteMd,
        });
      } else {
        // hint / pay：必须有 slug
        if (!action.slug?.trim()) {
          console.warn(
            `[produceBook] threadAction ${action.kind} 缺 slug (ch${opts.chapterIdx})，跳过`,
          );
          continue;
        }
        const [thread] = await db
          .select()
          .from(plotThreads)
          .where(and(eq(plotThreads.bookId, opts.bookId), eq(plotThreads.slug, action.slug)));
        if (!thread) {
          console.warn(
            `[produceBook] threadAction ${action.kind} 引用未知 slug "${action.slug}" (ch${opts.chapterIdx})，跳过`,
          );
          continue;
        }
        await recordThreadEvent({
          threadId: thread.id,
          chapterIdx: opts.chapterIdx,
          kind: action.kind,
          noteMd: action.noteMd,
          generatedByRunId: opts.rootRunId,
        });
      }
    } catch (e) {
      console.warn(
        `[produceBook] threadAction ${action.kind} (ch${opts.chapterIdx}) 失败：${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }

}

/**
 * 章末 hook 提取：优先用 LLM 显式给的 hook_md（已是浓缩），其次截取正文末尾 ~250 字。
 * 写回 bookStates.lastHookMd 让下章 writer prompt 顶部能贴回原文，强制接续上一章末尾的
 * 人物 / 事件 / 异象，避免跨章 cliffhanger 在下章开头凭空消失。
 */
function extractLastHook(contentMd: string, hookMd: string): string {
  // hookMd 是 LLM 自己提炼的章末 hook（submit_chapter args.hook_md），已经精炼；优先用
  if (hookMd && hookMd.length >= 4 && hookMd.length <= 300) {
    return hookMd.trim();
  }
  // 兜底：截章末 250 字（正文末段往往就是 cliffhanger）
  const flat = contentMd.trimEnd();
  const tail = flat.slice(-250);
  return tail.trim();
}

/** 取 canonical-numbers 文档（kind='lore', slug='canonical-numbers'）。
 * 由 chapter-writer 的 living-doc-updater 在引入数字型设定时维护。 */
async function loadCanonicalNumbersDoc(
  bookId: string,
): Promise<{ contentMd: string } | undefined> {
  const [row] = await db
    .select({ contentMd: bookDocs.contentMd })
    .from(bookDocs)
    .where(
      and(
        eq(bookDocs.bookId, bookId),
        eq(bookDocs.kind, 'lore'),
        eq(bookDocs.slug, 'canonical-numbers'),
      ),
    )
    .limit(1);
  return row;
}

/** 取在场角色台账（kind='lore', slug='cast'）。 */
async function loadCastDoc(bookId: string): Promise<{ contentMd: string } | undefined> {
  const [row] = await db
    .select({ contentMd: bookDocs.contentMd })
    .from(bookDocs)
    .where(
      and(eq(bookDocs.bookId, bookId), eq(bookDocs.kind, 'lore'), eq(bookDocs.slug, 'cast')),
    )
    .limit(1);
  return row;
}

/** 取 arc 摘要，格式化为 chapter-writer 可读的文本块。 */
async function getArcSummariesContext(bookId: string): Promise<string | undefined> {
  const arcs = await db
    .select()
    .from(arcSummaries)
    .where(eq(arcSummaries.bookId, bookId))
    .orderBy(arcSummaries.arcIdx);
  if (arcs.length === 0) return undefined;
  return arcs
    .map(
      (a) =>
        `Arc ${a.arcIdx} ${a.arcName}（第 ${a.rangeStart}-${a.rangeEnd} 章）：${oneLine(a.summaryMd, 200)}`,
    )
    .join('\n');
}

async function getLatestState(bookId: string) {
  const all = await db
    .select()
    .from(bookStates)
    .where(eq(bookStates.bookId, bookId));
  if (all.length === 0) return undefined;
  return all.reduce((acc, cur) => (cur.chapterIdx > acc.chapterIdx ? cur : acc));
}

function stateToContext(state?: typeof bookStates.$inferSelect): string {
  if (!state) return '（尚无前文状态）';
  const active = Array.isArray(state.activeCharacters)
    ? (state.activeCharacters as Array<{ name?: string; status?: string }>)
        .map((c) => `${c.name ?? '?'}: ${c.status ?? '?'}`)
        .join('；')
    : '—';
  // 伏笔状态走 plot_threads（清单单独由 listOpenForChapter 注入），这里不再渲染
  return [
    `阶段：${state.arcStage}`,
    `在场角色：${active}`,
    `上一章核心事件：${state.lastEventSummaryMd}`,
    `下一章意图（来自上轮提示）：${state.nextChapterIntentMd}`,
  ].join('\n');
}

function oneLine(s: string, max = 120): string {
  return s.replace(/\s+/g, ' ').slice(0, max).trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * gate-1 通过后 resume 写作：从 books.meta.produceCfg 读取配置，调 runChapterLoop。
 * 调用方负责先把 gate_request 标 approved（services/gates.ts），这里只跑后半段。
 */
export async function resumeAfterGate1(bookId: string): Promise<ProduceResult> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error(`resumeAfterGate1: book ${bookId} 不存在`);

  const meta = (book.meta ?? {}) as Record<string, unknown>;
  const cfgRaw = meta.produceCfg as Record<string, unknown> | undefined;
  const cfg = cfgRaw ? ProduceInput.parse(cfgRaw) : null;

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'produce-book-resume',
      bookId,
      status: 'running',
      input: { resumeOf: bookId, gate: 'gate-1' } as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('resumeAfterGate1: 创建 root run 失败');

  return await runRootWithCancellation({
    rootRunId: rootRun.id,
    bookIdRef: { current: bookId },
    fn: async () => {
      await db.update(books).set({ status: 'writing' }).where(eq(books.id, bookId));

      const bookContext = await loadBookContext(bookId);

      return await runChapterLoop({
        book: { ...book, status: 'writing' },
        rootRunId: rootRun.id,
        bookContext,
        totalChapters: cfg?.totalChapters ?? 200,
        charsPerChapter: cfg?.charsPerChapter ?? 3000,
        earlyKillBelowChars: cfg?.earlyKillBelowChars ?? 2200,
        maxGuardRetries: cfg?.maxGuardRetries ?? 1,
        useHookSmith: cfg?.useHookSmith ?? true,
        arcSummaryEvery: cfg?.arcSummaryEvery ?? 20,
        planRevisionEvery: cfg?.planRevisionEvery ?? 0,
        pilot: cfg?.pilot ?? false,
        batchId: cfg?.batchId,
      });
    },
  });
}


/**
 * Pilot 模式：在已有 book 上连续跑 N 章（≤20），每章写完打全量 chapter_snapshots。
 * 等价于"循环调用 writeNextChapter 并打快照"。被 pg-boss 队列异步调用。
 *
 * 失败逻辑：
 * - 任一章 writeNextChapter 抛错 → 整批 throw（前面已写的章保留 + 已打的快照保留）
 * - 任一章 killed → 直接停（剩余章不写）
 */
export async function runPilotChapters(input: {
  bookId: string;
  chapterCount: number;
  batchId?: string;
}): Promise<{
  bookId: string;
  written: number;
  killed: boolean;
  killReason?: string;
}> {
  const max = Math.min(20, Math.max(1, Math.floor(input.chapterCount)));
  let written = 0;
  for (let i = 0; i < max; i++) {
    const r = await writeNextChapter(input.bookId);
    written++;
    try {
      await snapshotAfterChapter({
        bookId: input.bookId,
        chapterIdx: r.idx,
        batchId: input.batchId ?? null,
        kind: 'pilot',
        noteMd: `pilot 跑批：第 ${r.idx} 章末快照`,
      });
    } catch (e) {
      console.warn(
        `[runPilotChapters] snapshotAfterChapter(ch${r.idx}) failed: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (r.killed) {
      return { bookId: input.bookId, written, killed: true, killReason: r.killReason };
    }
  }
  return { bookId: input.bookId, written, killed: false };
}

/**
 * 已有书续写下一章（增量入口）。
 * - 从 books.meta.outlineDraft + meta.produceCfg rehydrate
 * - 计算 nextIdx = max(existing chapter idx) + 1
 * - 调用 writeOneChapter 写一章
 * - 如果是最后一章自动把 books.status 设为 completed
 *
 * 失败时不更新 book.status；run 标 failure。
 */
export async function writeNextChapter(bookId: string): Promise<{
  idx: number;
  charCount: number;
  killed: boolean;
  killReason?: string;
  rootRunId: string;
}> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error(`writeNextChapter: book ${bookId} 不存在`);

  const meta = (book.meta ?? {}) as Record<string, unknown>;
  const cfgRaw = meta.produceCfg as Record<string, unknown> | undefined;
  const cfg = cfgRaw ? ProduceInput.parse(cfgRaw) : null;
  const totalChapters = cfg?.totalChapters ?? 200;

  const existing = await db
    .select({ idx: chapters.idx })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  const maxIdx = existing.reduce((acc, c) => Math.max(acc, c.idx), 0);
  const nextIdx = maxIdx + 1;
  if (nextIdx > totalChapters) {
    throw new Error(`writeNextChapter: 已写完 ${totalChapters} 章`);
  }

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'write-next-chapter',
      bookId,
      status: 'running',
      input: { idx: nextIdx } as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('writeNextChapter: 创建 root run 失败');

  return await runRootWithCancellation({
    rootRunId: rootRun.id,
    bookIdRef: { current: bookId },
    fn: async () => {
    if (book.status !== 'writing') {
      await db.update(books).set({ status: 'writing' }).where(eq(books.id, bookId));
    }

    const bookContext = await loadBookContext(bookId);
    const charsPerChapter = cfg?.charsPerChapter ?? 3000;

    // 动态规划：检查是否有足够的 planned beats，没有就补充
    let beats = await getNextPlannedBeats(bookId, 10);
    let milestone: Milestone | null = null;
    if (beats.length === 0 || !beats.find((b) => b.idx === nextIdx)) {
      try {
        const planned = await planBatchChapters({
          rootRunId: rootRun.id,
          bookId,
          bookContext,
          totalChapters,
          charsPerChapter,
          startIdx: nextIdx,
          batchSize: Math.min(10, totalChapters - nextIdx + 1),
        });
        beats = planned.chapterBeats;
        milestone = planned.milestone;
      } catch (e) {
        throw new Error(`writeNextChapter: chapter-planner 失败: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      // beats 是历史 planned 节拍，对应的 milestone 在 book_docs 里
      milestone = await getCurrentMilestoneForChapter(bookId, nextIdx);
    }

    const beat = beats.find((b) => b.idx === nextIdx);
    if (!beat) {
      throw new Error(`writeNextChapter: chapter-planner 未返回第 ${nextIdx} 章的 beat`);
    }
    if (!milestone) {
      throw new Error(`writeNextChapter: 找不到第 ${nextIdx} 章的 milestone 上下文`);
    }

    const r = await writeOneChapter({
      book,
      rootRunId: rootRun.id,
      bookContext,
      totalChapters,
      charsPerChapter,
      earlyKillBelowChars: cfg?.earlyKillBelowChars ?? 2200,
      maxGuardRetries: cfg?.maxGuardRetries ?? 1,
      useHookSmith: cfg?.useHookSmith ?? true,
      arcSummaryEvery: cfg?.arcSummaryEvery ?? 20,
      planRevisionEvery: cfg?.planRevisionEvery ?? 0,
      idx: nextIdx,
      beat,
      milestone,
    });

    if (r.killed) {
      await db.update(books).set({ status: 'killed' }).where(eq(books.id, bookId));
    } else if (nextIdx >= totalChapters) {
      await db.update(books).set({ status: 'completed' }).where(eq(books.id, bookId));
    }

    await db
      .update(runs)
      .set({
        status: r.killed ? 'cancelled' : 'success',
        finishedAt: new Date(),
        output: { idx: nextIdx, charCount: r.charCount, killed: r.killed } as Record<string, unknown>,
      })
      .where(eq(runs.id, rootRun.id));

    return {
      idx: nextIdx,
      charCount: r.charCount,
      killed: r.killed,
      killReason: r.killReason,
      rootRunId: rootRun.id,
    };
    },
  });
}

/**
 * 在已有 book（chat 立项创建的 stub）上启动生产：
 * 跑 outline-architect → 更新 book → 创建 gate-1（非 fully-auto）。
 * gate-1 通过后由 resumeAfterGate1 跑章节循环。
 *
 * 与 produceBook 的区别：复用现有 books 行 / 从 brief + topicCard 推导 cfg / 不创建新 book row。
 */
export async function produceForExistingBook(input: {
  bookId: string;
  gateMode?: 'fully-auto' | 'auto-with-confirm' | 'manual';
}): Promise<ProduceResult> {
  const gateMode = input.gateMode ?? 'auto-with-confirm';

  const [book] = await db.select().from(books).where(eq(books.id, input.bookId));
  if (!book) throw new Error(`produceForExistingBook: book ${input.bookId} 不存在`);

  const existingCh = await db
    .select({ idx: chapters.idx })
    .from(chapters)
    .where(eq(chapters.bookId, input.bookId))
    .limit(1);
  if (existingCh.length > 0) {
    throw new Error(
      `produceForExistingBook: book ${input.bookId} 已经有章节。请改用 writeNextChapter 续跑。`,
    );
  }

  const briefRows = await db.select().from(bookBriefs).where(eq(bookBriefs.bookId, input.bookId));
  const brief = briefRows[0];
  if (!brief) throw new Error(`produceForExistingBook: book ${input.bookId} 没有 brief`);

  const cfg = ProduceInput.parse({
    topicTitle: book.title.length >= 2 ? book.title : '（待定）',
    pitch: brief.briefIdeaMd,
    elementSlugs: book.elementSlugs.length > 0 ? book.elementSlugs : ['rebirth'],
    totalChapters: brief.targetTotalChapters,
    charsPerChapter: brief.targetCharsPerChapter,
    gateMode,
  });

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'produce-book-existing',
      bookId: input.bookId,
      status: 'running',
      input: cfg as unknown as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('produceForExistingBook: 创建 root run 失败');

  return await runRootWithCancellation({
    rootRunId: rootRun.id,
    bookIdRef: { current: input.bookId },
    fn: async () => {
    // 兜底：confirmTopicFn 已经会在立项后跑一次 story-designer-harness，但若那
    // 一步失败 / retry / 旧数据没有 brief，则在这里补一次。判定标准用 books.logline_md
    // 是否非空（harness commit 时 brief 必填且 min(20)），幂等。
    if (!book.loglineMd || book.loglineMd.trim().length === 0) {
      await designForExistingBook({ bookId: input.bookId });
    }

    // 更新 book 状态（不再生成大纲，由 chapter-planner 动态规划）。
    // 风格走 vault docs(kind='style', ...) 路径，由 design 阶段 / 用户手动维护。
    const [updatedBook] = await db
      .update(books)
      .set({
        status: gateMode === 'fully-auto' ? 'writing' : 'planning',
        gateMode,
        meta: {
          ...((book.meta ?? {}) as Record<string, unknown>),
          targetChapters: cfg.totalChapters,
          targetCharsPerChapter: cfg.charsPerChapter,
          produceCfg: cfg as unknown as Record<string, unknown>,
        },
      })
      .where(eq(books.id, input.bookId))
      .returning();
    if (!updatedBook) throw new Error('produceForExistingBook: 更新 book 失败');

    // designForExistingBook 已经把 brief 落 books 表 + vault docs 落 book_docs。
    // bookContext 直接从这两处读运行期上下文。
    const bookContext = await loadBookContext(input.bookId);

    // 初始 bookState：activeCharacters 至少含主角；其他角色随章节生成由
    // living-doc-updater 自动登记。
    await db.insert(bookStates).values({
      bookId: input.bookId,
      chapterIdx: 0,
      arcStage: '开篇',
      activeCharacters: bookContext.protagonist
        ? [{ name: bookContext.protagonist, status: '主角' }]
        : [],
      lastEventSummaryMd: '尚未开篇。',
      nextChapterIntentMd: '开篇',
      generatedByRunId: rootRun.id,
    });

    if (gateMode !== 'fully-auto') {
      await createGateRequest({
        bookId: input.bookId,
        kind: 'gate-1',
        triggeredByRunId: rootRun.id,
        noteMd: '设计文档就绪，点确认开始写作。',
        payload: { chapterCount: cfg.totalChapters, charsPerChapter: cfg.charsPerChapter },
      });
      // 这条 root run 的工作就到这里：vault + brief + state 都准备好，gate 也挂了。
      // 后续章节循环由 resumeAfterGate1 开新 root run（produce-book-resume）跑，
      // 跟这条解耦。所以这里必须收尾标 success——否则 run 永远 running，
      // /runs 页一直显示「跑批中」、book-busy.writing 永远 true。
      await db
        .update(runs)
        .set({
          status: 'success',
          finishedAt: new Date(),
          output: { phase: 'awaiting-gate-1', chaptersWritten: 0 },
        })
        .where(eq(runs.id, rootRun.id));
      return {
        bookId: input.bookId,
        rootRunId: rootRun.id,
        chaptersWritten: 0,
        totalCharCount: 0,
        averageCharCount: 0,
        killed: false,
      };
    }

    return await runChapterLoop({
      book: updatedBook,
      rootRunId: rootRun.id,
      bookContext,
      totalChapters: cfg.totalChapters,
      charsPerChapter: cfg.charsPerChapter,
      earlyKillBelowChars: cfg.earlyKillBelowChars,
      maxGuardRetries: cfg.maxGuardRetries,
      useHookSmith: cfg.useHookSmith,
      arcSummaryEvery: cfg.arcSummaryEvery,
      planRevisionEvery: cfg.planRevisionEvery,
    });
    },
  });
}

/* ──────────────────────────────────────────────
 * 设计阶段：story-designer harness 一气呵成产 vault + 落 brief
 * ────────────────────────────────────────────── */

export async function designForExistingBook(input: {
  bookId: string;
  feedback?: string;
}): Promise<StoryDesignerHarnessResult> {
  const [book] = await db.select().from(books).where(eq(books.id, input.bookId));
  if (!book) throw new Error(`designForExistingBook: book ${input.bookId} 不存在`);

  const briefRows = await db.select().from(bookBriefs).where(eq(bookBriefs.bookId, input.bookId));
  const brief = briefRows[0];

  let pitch = brief?.briefIdeaMd ?? '';
  if (book.topicCardId) {
    const [tc] = await db.select().from(topicCards).where(eq(topicCards.id, book.topicCardId));
    if (tc) pitch = `${tc.hook}\n\n${tc.notesMd || pitch}`;
  }

  return await runStoryDesignFromPitch({
    bookId: input.bookId,
    bookTitle: book.title,
    pitch,
    elementSlugs: book.elementSlugs,
    classification: book.mainCategory
      ? {
          mainCategory: book.mainCategory,
          themes: book.themes,
          characterTypes: book.characterTypes,
          plotElements: book.plotElements,
        }
      : undefined,
    feedback: input.feedback,
  });
}

/**
 * 跑 story-designer harness 一气呵成：vault 落 book_docs，brief 落 books 表。
 * produceBook 立项阶段 / produceForExistingBook 兜底 / design-review-harness
 * regenerate 都走这个入口。
 *
 * 当 feedback 给了或已有 vault docs 时，把现有 docs 注入 contextPrompt，让
 * harness 在原 vault 基础上修改（覆盖 upsertDoc），实现"重生成"语义。
 */
async function runStoryDesignFromPitch(opts: {
  bookId: string;
  bookTitle: string;
  pitch: string;
  elementSlugs: string[];
  classification?: ProduceInput['classification'];
  /** 立项主链路有 rootRun 可贴；存量重生成入口自起 root run */
  rootRunId?: string;
  /** 用户在 design-review 里指出的修改诉求 */
  feedback?: string;
}): Promise<StoryDesignerHarnessResult> {
  const elementRows = opts.elementSlugs.length
    ? await db.select().from(elementsTbl).where(inArray(elementsTbl.slug, opts.elementSlugs))
    : [];
  const elementContext = elementRows
    .map((e) => `- ${e.zh}（${e.slug}/${e.category}）：${(e.definitionMd || '').slice(0, 100)}`)
    .join('\n');

  const existingDocs =
    opts.feedback
      ? await db
          .select({
            kind: bookDocs.kind,
            slug: bookDocs.slug,
            title: bookDocs.title,
            contentMd: bookDocs.contentMd,
          })
          .from(bookDocs)
          .where(eq(bookDocs.bookId, opts.bookId))
      : [];

  const existingBlock = existingDocs.length
    ? [
        `## 现有 vault（按反馈调整；用相同 path 调 update_doc 覆盖）`,
        ...existingDocs.map(
          (d) => `### docs/${d.kind}/${d.slug} · ${d.title}\n${d.contentMd}`,
        ),
        ``,
      ]
    : [];

  const feedbackBlock = opts.feedback
    ? [
        `## 用户反馈`,
        opts.feedback,
        ``,
        `请根据以上反馈修改 vault。保留满意的 doc 不动；只覆盖反馈涉及的部分；必要时新增 doc。submit_design 时 brief 也要按反馈调整。`,
        ``,
      ]
    : [];

  const promptParts: string[] = [
    `## 选题信息`,
    `书名：${opts.bookTitle}`,
    `钩子/卖点：${opts.pitch}`,
    ``,
    `## 可用元素`,
    elementContext || '（无）',
    ``,
  ];
  if (opts.classification?.mainCategory) {
    promptParts.push(
      `## 分类标签`,
      `主分类：${opts.classification.mainCategory}`,
      `主题：${opts.classification.themes.join('、')}`,
      `角色类型：${opts.classification.characterTypes.join('、')}`,
      `情节元素：${opts.classification.plotElements.join('、')}`,
      ``,
    );
  }
  promptParts.push(...existingBlock, ...feedbackBlock);
  promptParts.push(
    `## 任务`,
    existingDocs.length
      ? `基于用户反馈在现有 vault 上修改：用相同 path 调 update_doc 覆盖；最后 submit_design 落 brief。`
      : `从空白 vault 起步：先 update_doc 写齐角色 / 世界观 / 风格 / 关系图（至少 4 份），再 submit_design 给 brief。`,
  );
  const contextPrompt = promptParts.join('\n');

  // root run：主链路传 parentRunId；其他入口（design-review regenerate / 兜底
  // 补设计）自起一个 design-book run 当 root，让 harness 嵌进 runs 树。
  let rootRunId = opts.rootRunId;
  if (!rootRunId) {
    const [rootRun] = await db
      .insert(runs)
      .values({
        kind: 'design-book',
        bookId: opts.bookId,
        status: 'running',
        input: { bookId: opts.bookId, feedback: opts.feedback ?? null },
        startedAt: new Date(),
      })
      .returning();
    if (!rootRun) throw new Error('runStoryDesignFromPitch: 创建 root run 失败');
    rootRunId = rootRun.id;
  }

  try {
    const systemPrompt = await loadPromptOrFallback(
      'story-designer-skill.system',
      STORY_DESIGNER_SKILL_PROMPT,
    );

    const result = await runStoryDesignerHarness({
      bookId: opts.bookId,
      contextPrompt,
      systemPrompt,
      parentRunId: rootRunId,
    });

    if (!opts.rootRunId) {
      // 自起 root run 的入口由我们 close
      await db
        .update(runs)
        .set({
          status: 'success',
          finishedAt: new Date(),
          output: {
            brief: result.brief as unknown as Record<string, unknown>,
            docsCommitted: result.docsCommitted,
          },
        })
        .where(eq(runs.id, rootRunId));
    }

    return result;
  } catch (err) {
    if (!opts.rootRunId) {
      await db
        .update(runs)
        .set({
          status: 'failure',
          finishedAt: new Date(),
          errorMd: err instanceof Error ? err.message : String(err),
        })
        .where(eq(runs.id, rootRunId));
    }
    throw err;
  }
}

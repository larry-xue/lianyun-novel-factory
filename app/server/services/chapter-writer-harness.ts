import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookDocs, books, bookStates } from '../db/schema/index.ts';
import { CHAPTER_WRITER_HARNESS_SYSTEM } from '../prompts/chapter-writer.harness.system.ts';
import { GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT } from '../prompts/fragments/index.ts';
import {
  buildChapterWriterTools,
  commitChapterWriterSession,
  createHarnessSession,
  SubmitChapterArgs,
  type SubmitChapterPayload,
} from './harness-tools.ts';
import { loadPromptOrFallback } from './prompts.ts';
import { runHarnessedAgent } from './run-tracer.ts';
import type { ChapterBeat, Milestone } from '../mastra/agents/chapter-planner.ts';
import type { OpenThreadForChapter } from './plot-threads.ts';
import type { ChapterWriteResult } from '../mastra/agents/chapter-writer.ts';

interface HarnessBookContext {
  title: string;
  loglineMd: string;
  audience: string;
  mainArcMd: string;
  protagonist: string;
  characters: Array<{ name: string; role: string }>;
  /**
   * 整本 vault（character / world / style / relations / 自创 kind 等），
   * 排除 chapter-plan / milestone / reader_notes。loadBookContext 一次性
   * 加载；写章节时从 livingDocsBlock 走（每章可变，cache 边界外）。
   */
  vaultDocs: Array<{ kind: string; slug: string; title: string; contentMd: string }>;
}

export interface WriteChapterViaHarnessOpts {
  rootRunId: string;
  bookId: string;
  idx: number;
  totalChapters: number;
  charsPerChapter: number;
  bookContext: HarnessBookContext;
  beat: ChapterBeat;
  /** chapter-planner 给的 5-10 章 milestone 目标，writer 在内自由战术 */
  milestone: Milestone;
  prevStateText: string;
  openThreadsForChapter: OpenThreadForChapter[];
  rewriteHintMd?: string;
  /** harness 单 turn 最多 token；默认 16k 给 submit 余量 */
  maxTokens?: number;
  maxToolCalls?: number;
}

export interface WriteChapterViaHarnessResult {
  /** 与旧 ChapterWriteResult 兼容（threadActions 为空——已在 commit 阶段落库） */
  final: ChapterWriteResult;
  runId: string;
  toolCallCount: number;
  turns: number;
  docsCommitted: string[];
  threadActionsApplied: number;
}

export async function writeChapterViaHarness(
  opts: WriteChapterViaHarnessOpts,
): Promise<WriteChapterViaHarnessResult> {
  const session = createHarnessSession(opts.bookId, opts.idx);
  const tools = buildChapterWriterTools({ charsPerChapter: opts.charsPerChapter });

  // db 优先，未 seed 时 fallback 到代码里的常量；UI 编辑后下次调用立即生效
  const systemPrompt = await loadPromptOrFallback(
    'chapter-writer.harness.system',
    CHAPTER_WRITER_HARNESS_SYSTEM,
  );
  const userPrompt = await buildHarnessUserPrompt(opts);

  const harness = await runHarnessedAgent<SubmitChapterPayload>({
    kind: 'chapter-write-harness',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { idx: opts.idx, totalChapters: opts.totalChapters, beatTitle: opts.beat.title },
    systemPrompt,
    userPrompt,
    tools,
    terminalToolNames: ['submit_chapter'],
    toolContext: { session },
    maxToolCalls: opts.maxToolCalls ?? 30,
    maxTokens: opts.maxTokens ?? 16000,
  });

  // 二次校验（runHarnessedAgent 内部已经走过 SubmitChapterArgs，这里只是类型收敛）
  const payload = SubmitChapterArgs.parse(harness.result);

  // 原子提交 pending docs + thread actions
  const commit = await commitChapterWriterSession({
    session,
    rootRunId: opts.rootRunId,
  });

  const final: ChapterWriteResult = {
    title: payload.title,
    contentMd: payload.content_md,
    hookMd: payload.hook_md,
    newState: {
      arcStage: payload.new_state.arc_stage,
      activeCharacters: payload.new_state.active_characters.map((c) => ({
        name: c.name,
        status: c.status,
      })),
      // threadActions 已在 commit 阶段落库，这里清空避免上层重复 apply
      threadActions: [],
      lastEventSummaryMd: payload.new_state.last_event_summary_md,
      nextChapterIntentMd: payload.new_state.next_chapter_intent_md,
    },
  };

  return {
    final,
    runId: harness.runId,
    toolCallCount: harness.toolCallCount,
    turns: harness.turns,
    docsCommitted: commit.docsCommitted,
    threadActionsApplied: commit.threadActionsApplied,
  };
}

async function buildHarnessUserPrompt(opts: WriteChapterViaHarnessOpts): Promise<string> {
  // characters 表只列 name/role 索引；完整角色档案在 docs/character/<x> doc，由 vault 走。
  const charactersBlock = opts.bookContext.characters.length
    ? opts.bookContext.characters.map((c) => `- ${c.name}（${c.role}）`).join('\n')
    : '（暂无 characters 表行；以 docs/character/* 为准）';

  // ── 动态部分（每章变化）：vault 全量随 living-doc-updater 增量改 ──
  // 风格通过 vault docs(kind='style', ...) 自然进入下面的 livingDocsBlock，
  // 不再走 books.style_md 副本路径（已删）。
  const livingDocsBlock = await loadLivingDocsBlock(opts.bookId);
  const threadsClipboard = formatThreadsClipboard(opts.openThreadsForChapter, opts.idx);
  const rewriteBlock = opts.rewriteHintMd
    ? [`## 上一次稿子的质检反馈（本次必须修复）`, opts.rewriteHintMd, '']
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
  const themesStr = (bookRow?.themes ?? []).join('、') || '（未指定）';
  const prohibitedStr =
    (bookRow?.prohibitedTropes ?? []).map((t) => `- ${t}`).join('\n') || '（未指定）';
  const canonicalNumbersBlock = await loadCanonicalNumbersBlock(opts.bookId);
  const castBlock = await loadCastBlock(opts.bookId);

  // 章末 hook：从 book_states 取上一章的 lastHookMd（submit_chapter 写入）
  const lastHookMd = await loadLastHookMd(opts.bookId, opts.idx);
  const hookBlock = lastHookMd
    ? [
        `## 上一章末尾原文 hook（本章必须显式接续这个钩子）`,
        lastHookMd,
        `**接续原则**：上一章末出现的人物/异象/突发事件不能在本章开头无故消失。如要"延后处理"，本章开头必须给出明确说明。`,
        '',
      ]
    : [];

  const pctStart = Math.round(((opts.beat.idx - 1) / opts.totalChapters) * 100);
  const pctEnd = Math.round((opts.beat.idx / opts.totalChapters) * 100);

  const milestoneBlock = [
    `## 当前 milestone（来自 chapter-planner，本章是 milestone 内的一个节拍）`,
    `名称：${opts.milestone.name}`,
    `推进目标：${opts.milestone.goalMd}`,
    `必须触达的剧情锚点：`,
    ...opts.milestone.keyAnchors.map((a, i) => `  ${i + 1}. ${a}`),
    `（本章不必覆盖整个 milestone——多章累计达成。但本章一定要朝目标推进。）`,
  ].join('\n');

  const upperLimit = opts.charsPerChapter + 1000;
  const lowerLimit = Math.max(0, opts.charsPerChapter - 300);

  // 顺序：[整本书 brief] → [题材契约/canonical/cast] → [milestone] → [vault 快照] → [章动态] → [字数 + 开始]
  // brief 来自 books 表（整本书静态），vault 每章随 living-doc-updater 变。
  return [
    `# 任务：写章节（详细信息见下）`,
    '',
    `## 整本书 brief（不变）`,
    `书名：《${opts.bookContext.title}》`,
    `主角（POV 锁）：${protagonist || opts.bookContext.protagonist || '（未设）'}`,
    `一句话：${opts.bookContext.loglineMd || '（未设）'}`,
    `面向：${opts.bookContext.audience}`,
    `主线：${opts.bookContext.mainArcMd}`,
    '',
    `## 题材契约（不可违反）`,
    `主分类：${bookRow?.mainCategory || '（未指定）'}`,
    `题材：${themesStr}`,
    `禁止套路（红线）：`,
    prohibitedStr,
    `**任何新引入的人物/设定/转折都不能踩红线；POV 必须始终是主角"${protagonist}"。**`,
    '',
    `## canonical-numbers（数字稳定，不要改）`,
    canonicalNumbersBlock,
    '',
    `## cast（在场角色台账）`,
    castBlock,
    '',
    `## characters 表锚点（如有）`,
    charactersBlock,
    '',
    // ─── 中等静态（每 milestone 切换）───
    milestoneBlock,
    '',
    // ─── 全动态（每章变化）：vault 全量 ───
    `## 当前 vault 活文档快照（character / world / style / relations / 自创 kind 等；随章节增量更新）`,
    livingDocsBlock,
    '',
    `## 本章信息`,
    `章号：第 ${opts.idx}/${opts.totalChapters} 章（全书 ${pctStart}-${pctEnd}%）`,
    `标题候选：${opts.beat.title || '（未设）'}`,
    `摘要：${opts.beat.summaryMd}`,
    `意图：${opts.beat.intent}`,
    '',
    `## 上一章状态（章末快照）`,
    opts.prevStateText || '（无；本章是第 1 章）',
    '',
    ...hookBlock,
    `## 可回收伏笔清单`,
    threadsClipboard,
    '',
    ...rewriteBlock,
    // 黄金 3 章：仅当本章 idx ≤ 3 时注入爆款呈现约束
    ...(opts.idx <= 3 ? [GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT, ''] : []),
    `## 字数硬指标（不可超）`,
    `content_md 中文字符必须落在 ${lowerLimit}-${upperLimit} 之间（目标 ${opts.charsPerChapter}，可超 +1000、可少 -300）。`,
    `**写到 ${upperLimit} 字符立即停笔 submit**——超字会被 submit_chapter 自动 reject 让你重写。`,
    `经济原则：对话 > 内心戏 > 描写；删冗余形容词、删重复信息、删非必要环境描写。`,
    '',
    `## 开始`,
    `**所有信息已就位**——直接构思 + 写正文 + submit_chapter。**不要 list / read / grep**（信息全在上面）。`,
    `本章涉及角色变化时用 update_doc 维护活文档；伏笔动作用 mark_thread（slug 必须来自上面的「可回收伏笔清单」）。`,
  ].join('\n');
}

async function loadCanonicalNumbersBlock(bookId: string): Promise<string> {
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
  return row?.contentMd ?? '（暂无 canonical-numbers；如本章引入数字型设定，写完用 update_doc docs/lore/canonical-numbers 维护）';
}

async function loadCastBlock(bookId: string): Promise<string> {
  const [row] = await db
    .select({ contentMd: bookDocs.contentMd })
    .from(bookDocs)
    .where(
      and(eq(bookDocs.bookId, bookId), eq(bookDocs.kind, 'lore'), eq(bookDocs.slug, 'cast')),
    )
    .limit(1);
  return row?.contentMd ?? '（暂无 cast 台账；本章让某角色登场或退场时，写完用 update_doc docs/lore/cast 维护）';
}

async function loadLastHookMd(bookId: string, idx: number): Promise<string> {
  if (idx <= 1) return '';
  const [row] = await db
    .select({ lastHookMd: bookStates.lastHookMd })
    .from(bookStates)
    .where(and(eq(bookStates.bookId, bookId), eq(bookStates.chapterIdx, idx - 1)))
    .limit(1);
  return row?.lastHookMd ?? '';
}

/**
 * 拉 vault 活文档全文喂进 prompt，让 writer 不需要 list/read 探索。
 * 排除 chapter-plan / milestone / reader_notes（运行期衍生 / 主编私人）。
 * 每章随 living-doc-updater 增量变，cache 命中边界之外。
 */
async function loadLivingDocsBlock(bookId: string): Promise<string> {
  const rows = await db
    .select({
      kind: bookDocs.kind,
      slug: bookDocs.slug,
      title: bookDocs.title,
      contentMd: bookDocs.contentMd,
    })
    .from(bookDocs)
    .where(
      and(
        eq(bookDocs.bookId, bookId),
        ne(bookDocs.kind, 'chapter-plan'),
        ne(bookDocs.kind, 'milestone'),
        ne(bookDocs.kind, 'reader_notes'),
      ),
    )
    .orderBy(asc(bookDocs.kind), asc(bookDocs.slug));
  if (rows.length === 0) return '（暂无活文档；首次运行常见状态）';
  return rows
    .map((d) => `### docs/${d.kind}/${d.slug} · ${d.title}\n${d.contentMd}`)
    .join('\n\n---\n\n');
}

function formatThreadsClipboard(threads: OpenThreadForChapter[], currentIdx: number): string {
  if (threads.length === 0) return '（无开放伏笔）';
  const overdue = threads.filter((t) => t.isOverdue);
  const urgent = threads.filter(
    (t) => !t.isOverdue && (t.chaptersUntilDeadline <= 3 || t.weight === 'book'),
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
    parts.push('### [P0 已超期，必须 pay 或 hint 并解释]');
    parts.push(...overdue.map(fmt));
    parts.push('');
  }
  if (urgent.length) {
    parts.push('### [P1 临近窗口或长线]');
    parts.push(...urgent.map(fmt));
    parts.push('');
  }
  if (others.length) {
    const shown = others.slice(0, 8);
    parts.push(
      `### [其他 open/hinted${others.length > 8 ? `（共 ${others.length}，列前 8）` : ''}]`,
    );
    parts.push(...shown.map(fmt));
  }
  return parts.join('\n');
}

function oneLine(s: string, max = 200): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
}

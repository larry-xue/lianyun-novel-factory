import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  bookBriefs,
  books,
  runs,
  styleSamples,
  toolCalls,
  topicCards,
  topicNegotiations,
  type NegotiationAction,
  type NegotiationMessage,
  type TopicNegotiation,
} from '../db/schema/index.ts';
import {
  BRAINSTORM_TERMINAL_TOOLS,
  runBrainstormHarness,
  type ConfirmedBrief,
  type PreselectedStyleSample,
} from './brainstorm-harness.ts';
import {
  DESIGN_REVIEW_TERMINAL_TOOLS,
  runDesignReviewHarness,
} from './design-review-harness.ts';
import { BRAINSTORM_SKILL_PROMPT } from '../prompts/brainstorm-skill.system.ts';
import { DESIGN_REVIEW_SKILL_PROMPT } from '../prompts/design-review-skill.system.ts';
import { loadPromptOrFallback } from './prompts.ts';
import { produceForExistingBook } from './book-producer.ts';

/**
 * 立项 chat 业务层。
 *
 * 一本书一条 active negotiation，messages jsonb 数组。
 * 每轮 user 发言 → agentRespond 调 brainstorm-harness（仿 Claude Code skill，
 * 工具集：list_kb / read_kb / grep_kb / pin_decision / unpin_decision /
 * ask_user / confirm_topic）→ harness 跑到 ask_user / confirm_topic 退出，
 * 把 widget + 累积决策落到 negotiation。
 * 用户在 confirm widget 上点"批准开书"才调 confirmTopic 落 topic_card + brief。
 */

/**
 * 创建一本"立项中"的 stub book + brief + negotiation。
 * 入口：用户在 /books/ 给一段 idea 文案 → 走这条创建。
 */
export async function startBookFromIdea(input: {
  briefIdeaMd: string;
  initialPreferences?: {
    targetTotalChapters?: number;
    targetCharsPerChapter?: number;
    /** 用户在 /books/ 入口预选的范文 id 列表 */
    styleSampleIds?: string[];
    /** 用户在 /books/ 入口预选的元素 slug 列表 */
    elementSlugs?: string[];
  };
  ownerId?: string | null;
}): Promise<{
  bookId: string;
  negotiationId: string;
}> {
  const idea = z.string().min(10).max(8_000).parse(input.briefIdeaMd);
  const styleSampleIds = input.initialPreferences?.styleSampleIds ?? [];
  const preselectedElementSlugs = input.initialPreferences?.elementSlugs ?? [];

  return await db.transaction(async (tx) => {
    const [book] = await tx
      .insert(books)
      .values({
        title: '（立项中）',
        status: 'planning',
        ownerId: input.ownerId ?? null,
        elementSlugs: preselectedElementSlugs,
        outlineMd: '',
      })
      .returning();
    if (!book) throw new Error('startBookFromIdea: 创建 book 失败');

    await tx.insert(bookBriefs).values({
      bookId: book.id,
      briefIdeaMd: idea,
      targetTotalChapters: input.initialPreferences?.targetTotalChapters ?? 20,
      targetCharsPerChapter: input.initialPreferences?.targetCharsPerChapter ?? 3000,
      styleSampleIds,
      preselectedElementSlugs,
    });

    const firstMessage: NegotiationMessage = {
      role: 'user',
      contentMd: idea,
      ts: new Date().toISOString(),
    };
    // 用户已预选的元素直接 mirror 进 decisions.elementSlugs，让 scout
    // 不必重复问；styleSampleIds 不在 decisions 里（不算立项决策），由
    // brainstorm-harness 从 brief 旁路拉到 prompt 上下文。
    const initialDecisions: Record<string, unknown> = {};
    if (preselectedElementSlugs.length > 0) {
      initialDecisions.elementSlugs = preselectedElementSlugs;
    }

    const [neg] = await tx
      .insert(topicNegotiations)
      .values({
        bookId: book.id,
        status: 'active',
        messages: [firstMessage],
        decisions: initialDecisions,
      })
      .returning();
    if (!neg) throw new Error('startBookFromIdea: 创建 negotiation 失败');

    return { bookId: book.id, negotiationId: neg.id };
  });
}

export async function getNegotiationByBook(bookId: string): Promise<TopicNegotiation | null> {
  const [row] = await db
    .select()
    .from(topicNegotiations)
    .where(eq(topicNegotiations.bookId, bookId))
    .limit(1);
  return row ?? null;
}

export async function postUserMessage(
  bookId: string,
  contentMd: string,
): Promise<TopicNegotiation> {
  const text = z.string().min(1).max(8_000).parse(contentMd.trim());
  const neg = await getNegotiationByBook(bookId);
  if (!neg) throw new Error(`postUserMessage: book ${bookId} 没有 negotiation`);
  if (neg.status !== 'active' && neg.status !== 'designing') {
    throw new Error(`postUserMessage: negotiation 状态 ${neg.status}，无法发新消息`);
  }
  const next: NegotiationMessage = {
    role: 'user',
    contentMd: text,
    ts: new Date().toISOString(),
  };
  const [updated] = await db
    .update(topicNegotiations)
    .set({ messages: [...neg.messages, next] })
    .where(eq(topicNegotiations.id, neg.id))
    .returning();
  return updated!;
}

/** 内部：把一条 system 消息追加到 negotiation。confirmTopicFn 通报"设计已就绪"用。 */
export async function appendSystemMessage(
  bookId: string,
  contentMd: string,
): Promise<TopicNegotiation> {
  const neg = await getNegotiationByBook(bookId);
  if (!neg) throw new Error(`appendSystemMessage: book ${bookId} 没有 negotiation`);
  const msg: NegotiationMessage = {
    role: 'system',
    contentMd,
    ts: new Date().toISOString(),
  };
  const [updated] = await db
    .update(topicNegotiations)
    .set({ messages: [...neg.messages, msg] })
    .where(eq(topicNegotiations.id, neg.id))
    .returning();
  return updated!;
}

/**
 * 推进 chat 一轮。按 negotiation.status 分流：
 *   - active    → brainstorm-harness（立项决策）
 *   - designing → design-review-harness（设计 review）
 *   - 其它      → throw
 *
 * harness 跑到软/硬终止才退出；返回的 widget 落到一条新 agent 消息上，前端
 * 用 WidgetRenderer 渲染。
 */
export async function agentRespond(bookId: string): Promise<TopicNegotiation> {
  const neg = await getNegotiationByBook(bookId);
  if (!neg) throw new Error(`agentRespond: book ${bookId} 没有 negotiation`);
  if (neg.status === 'active') {
    return await agentRespondBrainstorm(bookId, neg);
  }
  if (neg.status === 'designing') {
    return await agentRespondDesignReview(bookId, neg);
  }
  throw new Error(`agentRespond: negotiation 状态 ${neg.status}`);
}

async function agentRespondBrainstorm(
  bookId: string,
  neg: TopicNegotiation,
): Promise<TopicNegotiation> {
  const systemPrompt = await loadPromptOrFallback(
    'brainstorm-skill.system',
    BRAINSTORM_SKILL_PROMPT,
  );

  // chat 历史中的 system 消息（widget 自动应答之类）也喂给 harness
  const history = neg.messages.map((m) => ({
    role: m.role,
    contentMd: m.contentMd,
  }));

  const { preselectedStyleSamples } = await loadPreselectedBriefContext(bookId);

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'brainstorm-turn',
      bookId,
      status: 'running',
      input: { messageCount: neg.messages.length } as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('agentRespond: 创建 root run 失败');

  try {
    const out = await runBrainstormHarness({
      bookId,
      decisions: neg.decisions,
      history,
      systemPrompt,
      parentRunId: rootRun.id,
      preselectedStyleSamples,
    });

    const actions = await collectHarnessActions(out.runId, BRAINSTORM_TERMINAL_TOOLS);

    let agentMessage: NegotiationMessage;
    if (out.terminal.kind === 'ask_user') {
      agentMessage = {
        role: 'agent',
        contentMd: out.terminal.payload.replyMd,
        widget: out.terminal.payload.widget,
        actions,
        ts: new Date().toISOString(),
        runId: rootRun.id,
      };
    } else {
      agentMessage = {
        role: 'agent',
        contentMd: out.terminal.payload.replyMd,
        widget: {
          kind: 'confirm',
          header: '请最终确认',
          summaryMd: out.terminal.payload.summaryMd,
        },
        briefDraft: out.terminal.payload.brief as unknown as Record<string, unknown>,
        actions,
        ts: new Date().toISOString(),
        runId: rootRun.id,
      };
    }

    const [updated] = await db
      .update(topicNegotiations)
      .set({
        messages: [...neg.messages, agentMessage],
        decisions: out.decisions,
      })
      .where(eq(topicNegotiations.id, neg.id))
      .returning();

    await db
      .update(runs)
      .set({
        status: 'success',
        finishedAt: new Date(),
        output: {
          terminalKind: out.terminal.kind,
          toolCallCount: out.toolCallCount,
          turns: out.turns,
        } as Record<string, unknown>,
      })
      .where(eq(runs.id, rootRun.id));

    return updated!;
  } catch (e) {
    await db
      .update(runs)
      .set({
        status: 'failure',
        finishedAt: new Date(),
        errorMd: e instanceof Error ? e.message : String(e),
      })
      .where(eq(runs.id, rootRun.id));
    throw e;
  }
}

async function agentRespondDesignReview(
  bookId: string,
  neg: TopicNegotiation,
): Promise<TopicNegotiation> {
  const systemPrompt = await loadPromptOrFallback(
    'design-review-skill.system',
    DESIGN_REVIEW_SKILL_PROMPT,
  );

  const history = neg.messages.map((m) => ({
    role: m.role,
    contentMd: m.contentMd,
  }));

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'design-review-turn',
      bookId,
      status: 'running',
      input: { messageCount: neg.messages.length } as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('agentRespondDesignReview: 创建 root run 失败');

  try {
    const out = await runDesignReviewHarness({
      bookId,
      history,
      systemPrompt,
      parentRunId: rootRun.id,
    });

    const actions = await collectHarnessActions(out.runId, DESIGN_REVIEW_TERMINAL_TOOLS);

    let agentMessage: NegotiationMessage;
    if (out.terminal.kind === 'ask_user') {
      agentMessage = {
        role: 'agent',
        contentMd: out.terminal.payload.replyMd,
        widget: out.terminal.payload.widget,
        actions,
        ts: new Date().toISOString(),
        runId: rootRun.id,
      };
    } else {
      agentMessage = {
        role: 'agent',
        contentMd: out.terminal.payload.replyMd,
        widget: {
          kind: 'confirm',
          header: '开始写作？',
          summaryMd: out.terminal.payload.summaryMd,
          approveLabel: '开始写作',
        },
        produceArgs: { gateMode: out.terminal.payload.gateMode },
        actions,
        ts: new Date().toISOString(),
        runId: rootRun.id,
      };
    }

    const [updated] = await db
      .update(topicNegotiations)
      .set({ messages: [...neg.messages, agentMessage] })
      .where(eq(topicNegotiations.id, neg.id))
      .returning();

    await db
      .update(runs)
      .set({
        status: 'success',
        finishedAt: new Date(),
        output: {
          terminalKind: out.terminal.kind,
          toolCallCount: out.toolCallCount,
          turns: out.turns,
        } as Record<string, unknown>,
      })
      .where(eq(runs.id, rootRun.id));

    return updated!;
  } catch (e) {
    await db
      .update(runs)
      .set({
        status: 'failure',
        finishedAt: new Date(),
        errorMd: e instanceof Error ? e.message : String(e),
      })
      .where(eq(runs.id, rootRun.id));
    throw e;
  }
}

/**
 * 用户在最近一条 agent 消息（widget=confirm）上点"批准开书" → 落库。
 * 从该消息的 briefDraft 取 brain-storm 拟定的 brief，落 topic_card + book +
 * book_brief + 把 negotiation 标 confirmed。
 */
export async function confirmTopic(input: {
  bookId: string;
}): Promise<{ bookId: string; topicCardId: string }> {
  const neg = await getNegotiationByBook(input.bookId);
  if (!neg) throw new Error('confirmTopic: negotiation 不存在');
  if (neg.status !== 'active') {
    throw new Error(`confirmTopic: negotiation 已 ${neg.status}`);
  }

  const lastConfirmIdx = [...neg.messages]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(({ m }) => m.role === 'agent' && m.widget?.kind === 'confirm' && m.briefDraft);
  if (!lastConfirmIdx) {
    throw new Error('confirmTopic: 找不到带 briefDraft 的 confirm 消息（agent 还没出 brief）');
  }
  const briefDraft = lastConfirmIdx.m.briefDraft as ConfirmedBrief;

  return await db.transaction(async (tx) => {
    const [topicRow] = await tx
      .insert(topicCards)
      .values({
        title: briefDraft.proposedTitle,
        hook: briefDraft.coreConflictMd.slice(0, 120),
        elementSlugs: briefDraft.elementSlugs,
        targetAudience: briefDraft.targetAudience,
        mainCategory: briefDraft.mainCategory,
        themes: briefDraft.themes ?? [],
        characterTypes: briefDraft.characterTypes ?? [],
        plotElements: briefDraft.plotElements ?? [],
        status: 'approved',
        score: {} as Record<string, unknown>,
        scoreOverall: 0,
        notesMd: briefDraft.synopsisMd,
      })
      .returning();
    if (!topicRow) throw new Error('confirmTopic: 创建 topic_card 失败');

    await tx
      .update(books)
      .set({
        title: briefDraft.proposedTitle,
        elementSlugs: briefDraft.elementSlugs,
        mainCategory: briefDraft.mainCategory,
        themes: briefDraft.themes ?? [],
        characterTypes: briefDraft.characterTypes ?? [],
        plotElements: briefDraft.plotElements ?? [],
        bookSummaryMd: briefDraft.synopsisMd,
        topicCardId: topicRow.id,
      })
      .where(eq(books.id, input.bookId));

    await tx
      .update(bookBriefs)
      .set({
        targetTotalChapters: briefDraft.totalChapters,
        targetCharsPerChapter: briefDraft.charsPerChapter,
        forbiddenMd: briefDraft.forbiddenMd ?? '',
        confirmedAt: new Date(),
      })
      .where(eq(bookBriefs.bookId, input.bookId));

    // status 推到 'designing'：design-review-harness 接管 chat。
    // 完整 confirm 由后续 startWriting 触发（status → 'confirmed'）。
    await tx
      .update(topicNegotiations)
      .set({ status: 'designing', topicCardId: topicRow.id })
      .where(eq(topicNegotiations.id, neg.id));

    return { bookId: input.bookId, topicCardId: topicRow.id };
  });
}

/**
 * design review 结束 → 开始写章。design-review-harness 的 start_writing 终止 +
 * 用户在 confirm widget 上点"开始写作"才触发。
 *
 * 状态推进：'designing' → 'confirmed'，并同步调用 produceForExistingBook 启动
 * gate-1（或 fully-auto 直接进章节循环）。
 */
export async function startWriting(input: {
  bookId: string;
  /** 默认从最近一条 confirm 消息的 produceArgs 读，传值则覆盖 */
  gateMode?: 'fully-auto' | 'auto-with-confirm' | 'manual';
}): Promise<{ bookId: string; gateMode: 'fully-auto' | 'auto-with-confirm' | 'manual' }> {
  const neg = await getNegotiationByBook(input.bookId);
  if (!neg) throw new Error('startWriting: negotiation 不存在');
  if (neg.status !== 'designing') {
    throw new Error(`startWriting: negotiation 状态 ${neg.status}（需 designing）`);
  }

  const lastConfirm = [...neg.messages]
    .reverse()
    .find((m) => m.role === 'agent' && m.widget?.kind === 'confirm' && m.produceArgs);
  const gateMode =
    input.gateMode ??
    (lastConfirm?.produceArgs?.gateMode as 'fully-auto' | 'auto-with-confirm' | 'manual') ??
    'auto-with-confirm';

  await db
    .update(topicNegotiations)
    .set({ status: 'confirmed' })
    .where(eq(topicNegotiations.id, neg.id));

  await produceForExistingBook({ bookId: input.bookId, gateMode });

  return { bookId: input.bookId, gateMode };
}

/**
 * 把一次 harness run 的非终止 tool_calls 拍平成给前端 UI 用的行动卡列表。
 * argsSummary 是 1-2 行可读摘要；resultMd 截到 280 字。
 * terminalTools 用于过滤终止工具自身（ask_user / confirm_topic / start_writing）。
 */
async function collectHarnessActions(
  harnessRunId: string,
  terminalTools: ReadonlyArray<string>,
): Promise<NegotiationAction[]> {
  const rows = await db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.runId, harnessRunId))
    .orderBy(asc(toolCalls.seq));

  const terminalSet = new Set<string>(terminalTools);
  return rows
    .filter((r) => !terminalSet.has(r.toolName))
    .map<NegotiationAction>((r) => ({
      seq: r.seq,
      tool: r.toolName,
      argsSummary: summarizeArgs(r.toolName, r.argsJson),
      resultMd: truncate(r.resultMd, 280),
      ...(r.errorMd ? { errorMd: r.errorMd.slice(0, 280) } : {}),
      ...(typeof r.durationMs === 'number' ? { durationMs: r.durationMs } : {}),
    }));
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_kb':
      return String(args.path ?? '/') || '/';
    case 'read_kb':
      return String(args.path ?? '');
    case 'grep_kb': {
      const pattern = String(args.pattern ?? '');
      const scope = args.scope ? `（${args.scope}）` : '';
      return `${pattern}${scope}`;
    }
    case 'pin_decision': {
      const key = String(args.key ?? '');
      const value = args.value;
      const valueStr =
        typeof value === 'string'
          ? value
          : Array.isArray(value)
            ? value.map(String).join('、')
            : JSON.stringify(value);
      return `${key} = ${truncate(valueStr, 80)}`;
    }
    case 'unpin_decision':
      return String(args.key ?? '');
    default:
      return truncate(JSON.stringify(args), 120);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function getBookBrief(bookId: string) {
  const [row] = await db
    .select()
    .from(bookBriefs)
    .where(eq(bookBriefs.bookId, bookId))
    .limit(1);
  return row ?? null;
}

/**
 * 给 brainstorm-harness 用：从 brief 拉出预选的范文实际内容。
 * 返回内容会注入 user prompt，让 scout agent 知道用户已经定下的语感参照。
 */
async function loadPreselectedBriefContext(bookId: string): Promise<{
  preselectedStyleSamples: PreselectedStyleSample[];
}> {
  const brief = await getBookBrief(bookId);
  if (!brief) {
    return { preselectedStyleSamples: [] };
  }

  let samples: PreselectedStyleSample[] = [];
  if (brief.styleSampleIds.length > 0) {
    const rows = await db
      .select({
        id: styleSamples.id,
        author: styleSamples.author,
        title: styleSamples.title,
        contentMd: styleSamples.contentMd,
      })
      .from(styleSamples)
      .where(inArray(styleSamples.id, brief.styleSampleIds));
    // 按 brief.styleSampleIds 顺序对齐
    const byId = new Map(rows.map((r) => [r.id, r]));
    samples = brief.styleSampleIds
      .map((id) => byId.get(id))
      .filter((r): r is (typeof rows)[number] => !!r)
      .map((r) => ({ author: r.author, title: r.title, contentMd: r.contentMd }));
  }

  return { preselectedStyleSamples: samples };
}

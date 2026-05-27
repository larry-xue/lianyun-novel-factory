import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  bookDocs,
  chapterScoutSessions,
  chapters,
  runs,
  toolCalls,
  type ChapterScoutMessage,
  type ChapterScoutSession,
  type NegotiationAction,
} from '../db/schema/index.ts';
import {
  CHAPTER_SCOUT_TERMINAL_TOOLS,
  runChapterScoutHarness,
  type ConfirmedBeat,
} from './chapter-scout-harness.ts';
import { CHAPTER_SCOUT_SKILL_PROMPT } from '../prompts/chapter-scout-skill.system.ts';
import { loadPromptOrFallback } from './prompts.ts';
import { upsertDoc } from './book-docs.ts';

/**
 * 单章 chapter-scout chat 业务层。
 *
 * 一本书 + 一个 chapter_idx = 一条会话。状态 active → confirmed/abandoned。
 * 用户每轮 user 发言 → agentRespond 跑 chapter-scout-harness（仿
 * brainstorm-harness）→ harness 跑到 ask_user / confirm_beat 退出，
 * 把 widget + 累积决策落到 session。
 *
 * 用户在 confirm widget 上点"确认开写"才调 confirmChapterPlan：
 * 落 book_docs(kind='chapter-plan', slug='ch{N}-plan', pinned_by_user=true)。
 */

export async function getScoutSession(
  bookId: string,
  chapterIdx: number,
): Promise<ChapterScoutSession | null> {
  const [row] = await db
    .select()
    .from(chapterScoutSessions)
    .where(
      and(
        eq(chapterScoutSessions.bookId, bookId),
        eq(chapterScoutSessions.chapterIdx, chapterIdx),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * 进入 scout chat 时调一次。已有 active session 直接复用；否则创建空会话。
 * v1 仅允许 chapterIdx = 已写章节数 + 1（下一章），调用方自行校验。
 */
export async function ensureScoutSession(
  bookId: string,
  chapterIdx: number,
): Promise<ChapterScoutSession> {
  const existing = await getScoutSession(bookId, chapterIdx);
  if (existing) return existing;
  const [row] = await db
    .insert(chapterScoutSessions)
    .values({
      bookId,
      chapterIdx,
      status: 'active',
      messages: [],
      decisions: {},
    })
    .returning();
  if (!row) throw new Error('ensureScoutSession: 创建 session 失败');
  return row;
}

export async function postScoutUserMessage(
  bookId: string,
  chapterIdx: number,
  contentMd: string,
): Promise<ChapterScoutSession> {
  const text = z.string().min(1).max(8_000).parse(contentMd.trim());
  const sess = await ensureScoutSession(bookId, chapterIdx);
  if (sess.status !== 'active') {
    throw new Error(`postScoutUserMessage: 状态 ${sess.status}，无法发新消息`);
  }
  const next: ChapterScoutMessage = {
    role: 'user',
    contentMd: text,
    ts: new Date().toISOString(),
  };
  const [updated] = await db
    .update(chapterScoutSessions)
    .set({ messages: [...sess.messages, next] })
    .where(
      and(
        eq(chapterScoutSessions.bookId, bookId),
        eq(chapterScoutSessions.chapterIdx, chapterIdx),
      ),
    )
    .returning();
  return updated!;
}

/**
 * 跑 chapter-scout-harness 推进单章 chat 一轮。harness 跑到 ask_user 或
 * confirm_beat 才退出；返回的 widget 落到一条新 agent 消息上。
 */
export async function agentRespondScout(
  bookId: string,
  chapterIdx: number,
): Promise<ChapterScoutSession> {
  const sess = await ensureScoutSession(bookId, chapterIdx);
  if (sess.status !== 'active') {
    throw new Error(`agentRespondScout: 状态 ${sess.status}`);
  }

  const systemPrompt = await loadPromptOrFallback(
    'chapter-scout-skill.system',
    CHAPTER_SCOUT_SKILL_PROMPT,
  );

  const history = sess.messages.map((m) => ({
    role: m.role,
    contentMd: m.contentMd,
  }));

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'chapter-scout-turn',
      bookId,
      status: 'running',
      input: {
        chapterIdx,
        messageCount: sess.messages.length,
      } as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('agentRespondScout: 创建 root run 失败');

  try {
    const out = await runChapterScoutHarness({
      bookId,
      chapterIdx,
      decisions: sess.decisions,
      history,
      systemPrompt,
      parentRunId: rootRun.id,
    });

    const actions = await collectHarnessActions(out.runId);

    let agentMessage: ChapterScoutMessage;
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
          header: '确认开写',
          summaryMd: out.terminal.payload.summaryMd,
        },
        beatDraft: out.terminal.payload.beat as unknown as Record<string, unknown>,
        actions,
        ts: new Date().toISOString(),
        runId: rootRun.id,
      };
    }

    const [updated] = await db
      .update(chapterScoutSessions)
      .set({
        messages: [...sess.messages, agentMessage],
        decisions: out.decisions,
      })
      .where(
        and(
          eq(chapterScoutSessions.bookId, bookId),
          eq(chapterScoutSessions.chapterIdx, chapterIdx),
        ),
      )
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
 * 用户在 confirm widget 上点"确认开写" → 落 chapter-plan。
 * 把最近一条 agent 消息（widget=confirm）的 beatDraft 写入 book_docs，标 pinned_by_user=true。
 * session 标 confirmed。
 */
export async function confirmChapterPlan(input: {
  bookId: string;
  chapterIdx: number;
  runId?: string;
}): Promise<{ docId: string; planSlug: string }> {
  const sess = await getScoutSession(input.bookId, input.chapterIdx);
  if (!sess) throw new Error('confirmChapterPlan: session 不存在');
  if (sess.status !== 'active') {
    throw new Error(`confirmChapterPlan: session 已 ${sess.status}`);
  }

  const lastConfirm = [...sess.messages]
    .reverse()
    .find((m) => m.role === 'agent' && m.widget?.kind === 'confirm' && m.beatDraft);
  if (!lastConfirm) {
    throw new Error('confirmChapterPlan: 找不到带 beatDraft 的 confirm 消息（agent 还没出 beat）');
  }
  const beat = lastConfirm.beatDraft as ConfirmedBeat;

  const slug = `ch${input.chapterIdx}-plan`;
  const contentMd = formatChapterPlanDoc(beat, input.chapterIdx);

  const doc = await upsertDoc({
    bookId: input.bookId,
    kind: 'chapter-plan',
    slug,
    title: `第 ${input.chapterIdx} 章规划：${beat.title}`,
    contentMd,
    editor: 'human',
    reasonMd: `chapter-scout chat 用户确认（ch${input.chapterIdx}）`,
    runId: input.runId,
    generatedByRunId: input.runId,
    meta: {
      beat,
      chapterIdx: input.chapterIdx,
      pinnedByUser: true,
    },
  });

  // pinnedByUser 标在列上（meta 里也存一份，便于回放）
  await db
    .update(bookDocs)
    .set({ pinnedByUser: true })
    .where(eq(bookDocs.id, doc.id));

  await db
    .update(chapterScoutSessions)
    .set({ status: 'confirmed' })
    .where(
      and(
        eq(chapterScoutSessions.bookId, input.bookId),
        eq(chapterScoutSessions.chapterIdx, input.chapterIdx),
      ),
    );

  return { docId: doc.id, planSlug: slug };
}

function formatChapterPlanDoc(beat: ConfirmedBeat, idx: number): string {
  const parts = [
    `# 第 ${idx} 章规划：${beat.title}`,
    ``,
    `## 本章纲要`,
    beat.summaryMd,
    ``,
    `## 在主线/弧线中的作用`,
    beat.intent,
  ];
  if (beat.twist) {
    parts.push(``, `## 本章 twist`, beat.twist);
  }
  if (beat.anchors.length) {
    parts.push(``, `## 必须命中的锚点`);
    parts.push(beat.anchors.map((a, i) => `${i + 1}. ${a}`).join('\n'));
  }
  return parts.join('\n');
}

async function collectHarnessActions(harnessRunId: string): Promise<NegotiationAction[]> {
  const rows = await db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.runId, harnessRunId))
    .orderBy(asc(toolCalls.seq));

  const terminalSet = new Set<string>(CHAPTER_SCOUT_TERMINAL_TOOLS);
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
    case 'list':
      return String(args.path ?? '/') || '/';
    case 'read':
      return String(args.path ?? '');
    case 'grep': {
      const pattern = String(args.pattern ?? '');
      const path = args.path ? `（${args.path}）` : '';
      return `${pattern}${path}`;
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

/**
 * 校验：chapterIdx 是否就是「下一章」。v1 限定。
 */
export async function assertNextChapter(bookId: string, chapterIdx: number): Promise<void> {
  const existing = await db
    .select({ idx: chapters.idx })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  const maxIdx = existing.reduce((acc, c) => Math.max(acc, c.idx), 0);
  if (chapterIdx !== maxIdx + 1) {
    throw new Error(
      `chapter-scout 仅支持下一章（当前已写 ${maxIdx} 章，应规划第 ${maxIdx + 1} 章；请求第 ${chapterIdx} 章）`,
    );
  }
}

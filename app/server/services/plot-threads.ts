import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  plotThreadEvents,
  plotThreads,
  type PlotThread,
  type PlotThreadEvent,
} from '../db/schema/index.ts';
import { createHash } from 'node:crypto';

/**
 * 伏笔（plot_threads）业务层。
 *
 * 设计点：
 * - introduceThread 是幂等的：(book_id, slug) unique，重复调用 returning 已有行
 * - recordThreadEvent 同时更新 thread.status（hint→hinted, pay→paid_off, abandon→abandoned）
 * - listOpenForChapter 是给 chapter-writer 用的"可回收坑清单"输入
 * - markOverdueAsAbandoned 章末调用，把过期且仍 open/hinted 的转 abandoned
 */

const TitleSchema = z.string().min(1).max(200);

/**
 * 从 title 生成确定性 slug：'auto-' + md5 前 16 位。
 * Agent 也可以自己指定 slug；不指定时走这个。
 */
export function autoSlugFromTitle(title: string): string {
  const hash = createHash('md5').update(title).digest('hex').slice(0, 16);
  return `auto-${hash}`;
}

export interface IntroduceThreadInput {
  bookId: string;
  slug?: string;
  title: string;
  weight?: 'small' | 'arc' | 'book';
  introducedAtChapterIdx: number;
  /** 期望回收窗口的相对长度。默认 small=4 / arc=10 / book=50 */
  payoffWindowChapters?: number;
  payoffTriggerMd?: string;
  detailMd?: string;
  relatedCharacterIds?: string[];
  relatedRuleSlugs?: string[];
  generatedByRunId?: string;
  /** 同时记录一个 introduce 事件（默认 true） */
  recordEvent?: boolean;
  noteMd?: string;
}

export async function introduceThread(input: IntroduceThreadInput): Promise<PlotThread> {
  const title = TitleSchema.parse(input.title.trim());
  const weight = input.weight ?? 'arc';
  const slug = input.slug ?? autoSlugFromTitle(title);
  const introducedAt = Math.max(0, input.introducedAtChapterIdx);
  const window =
    input.payoffWindowChapters ?? (weight === 'small' ? 4 : weight === 'book' ? 50 : 10);

  const [row] = await db
    .insert(plotThreads)
    .values({
      bookId: input.bookId,
      slug,
      title,
      weight,
      status: 'open',
      introducedAtChapterIdx: introducedAt,
      expectedPayoffStart: introducedAt + 1,
      expectedPayoffEnd: introducedAt + window,
      payoffTriggerMd: input.payoffTriggerMd ?? '',
      detailMd: input.detailMd ?? title,
      relatedCharacterIds: input.relatedCharacterIds ?? [],
      relatedRuleSlugs: input.relatedRuleSlugs ?? [],
      generatedByRunId: input.generatedByRunId,
    })
    .onConflictDoNothing({ target: [plotThreads.bookId, plotThreads.slug] })
    .returning();

  // ON CONFLICT DO NOTHING 时 returning 为空，说明已存在 → 取出来返回
  const existing =
    row ??
    (
      await db
        .select()
        .from(plotThreads)
        .where(and(eq(plotThreads.bookId, input.bookId), eq(plotThreads.slug, slug)))
        .limit(1)
    )[0];

  if (!existing) {
    throw new Error(`introduceThread: failed to insert or fetch thread ${slug}`);
  }

  if (input.recordEvent !== false) {
    // 已存在的 thread 不重复记 introduce
    if (row) {
      await db.insert(plotThreadEvents).values({
        threadId: existing.id,
        bookId: input.bookId,
        chapterIdx: introducedAt,
        kind: 'introduce',
        noteMd: input.noteMd ?? '',
        generatedByRunId: input.generatedByRunId,
      });
    }
  }

  return existing;
}

export interface RecordThreadEventInput {
  threadId: string;
  chapterIdx: number;
  kind: 'introduce' | 'hint' | 'pay' | 'abandon';
  noteMd?: string;
  generatedByRunId?: string;
}

const STATUS_BY_EVENT_KIND = {
  introduce: 'open',
  hint: 'hinted',
  pay: 'paid_off',
  abandon: 'abandoned',
} as const;

export async function recordThreadEvent(input: RecordThreadEventInput): Promise<PlotThreadEvent> {
  const [thread] = await db
    .select()
    .from(plotThreads)
    .where(eq(plotThreads.id, input.threadId))
    .limit(1);
  if (!thread) throw new Error(`recordThreadEvent: thread ${input.threadId} not found`);

  const [event] = await db
    .insert(plotThreadEvents)
    .values({
      threadId: input.threadId,
      bookId: thread.bookId,
      chapterIdx: input.chapterIdx,
      kind: input.kind,
      noteMd: input.noteMd ?? '',
      generatedByRunId: input.generatedByRunId,
    })
    .returning();

  // 状态机：introduce 不动状态（已 open），hint/pay/abandon 推进
  if (input.kind !== 'introduce') {
    const newStatus = STATUS_BY_EVENT_KIND[input.kind];
    const patch: Partial<PlotThread> = { status: newStatus };
    if (input.kind === 'pay') {
      patch.payoffNotesMd = input.noteMd ?? '';
    }
    await db.update(plotThreads).set(patch).where(eq(plotThreads.id, input.threadId));
  }

  return event!;
}

/**
 * 给定一本书和当前章号，返回"可回收坑清单"——
 * agent 写下一章时要看这个，按 P0/P1/P2/P3 优先级判断是否回收。
 *
 * 简单版：返回所有 status in ('open','hinted') 的，附带"是否过期"标记。
 * 优先级排序留给调用方（chapter-writer prompt 装配）。
 */
export interface OpenThreadForChapter extends PlotThread {
  isOverdue: boolean;
  chaptersUntilDeadline: number;
}

export async function listOpenForChapter(
  bookId: string,
  currentChapterIdx: number,
): Promise<OpenThreadForChapter[]> {
  const rows = await db
    .select()
    .from(plotThreads)
    .where(
      and(
        eq(plotThreads.bookId, bookId),
        inArray(plotThreads.status, ['open', 'hinted']),
      ),
    );

  return rows
    .map((r) => ({
      ...r,
      isOverdue: currentChapterIdx > r.expectedPayoffEnd,
      chaptersUntilDeadline: r.expectedPayoffEnd - currentChapterIdx,
    }))
    .sort((a, b) => {
      // 过期的优先；同样过期/未过期内，weight 越大越优先
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const w = { book: 0, arc: 1, small: 2 };
      return w[a.weight] - w[b.weight];
    });
}

/**
 * 章末扫描：把超过 expected_payoff_end + grace 章仍未动的转 abandoned。
 * 默认 grace=5。
 */
export async function markOverdueAsAbandoned(
  bookId: string,
  currentChapterIdx: number,
  graceChapters = 5,
  runId?: string,
): Promise<PlotThread[]> {
  const cutoff = currentChapterIdx - graceChapters;
  const overdue = await db
    .select()
    .from(plotThreads)
    .where(
      and(
        eq(plotThreads.bookId, bookId),
        inArray(plotThreads.status, ['open', 'hinted']),
        lt(plotThreads.expectedPayoffEnd, cutoff),
      ),
    );

  if (overdue.length === 0) return [];

  const ids = overdue.map((t) => t.id);
  await db
    .update(plotThreads)
    .set({
      status: 'abandoned',
      payoffNotesMd: sql`'超过预期回收窗口 (end=' || expected_payoff_end || ')，自动作废于第 ' || ${currentChapterIdx} || ' 章'`,
    })
    .where(inArray(plotThreads.id, ids));

  await db.insert(plotThreadEvents).values(
    overdue.map((t) => ({
      threadId: t.id,
      bookId,
      chapterIdx: currentChapterIdx,
      kind: 'abandon' as const,
      noteMd: `超期自动作废（end=${t.expectedPayoffEnd}, grace=${graceChapters}）`,
      generatedByRunId: runId,
    })),
  );

  return overdue;
}

/**
 * 拉一本书的全部伏笔（管理面用）。
 */
export async function listThreadsForBook(bookId: string): Promise<PlotThread[]> {
  return await db
    .select()
    .from(plotThreads)
    .where(eq(plotThreads.bookId, bookId))
    .orderBy(plotThreads.introducedAtChapterIdx, plotThreads.createdAt);
}

/**
 * 拉一条伏笔的全部事件历史（管理面用）。
 */
export async function listEventsForThread(threadId: string): Promise<PlotThreadEvent[]> {
  return await db
    .select()
    .from(plotThreadEvents)
    .where(eq(plotThreadEvents.threadId, threadId))
    .orderBy(plotThreadEvents.chapterIdx, plotThreadEvents.createdAt);
}

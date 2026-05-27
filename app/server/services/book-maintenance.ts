import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  arcSummaries,
  bookDocs,
  bookStates,
  books,
  chapters,
  outlineRevisions,
} from '../db/schema/index.ts';
import {
  ArcSummaryResultSchema,
  BookSummaryResultSchema,
  arcSummarizer,
  bookSummarizer,
} from '../mastra/agents/arc-summarizer.ts';
import {
  PlanReviseResultSchema,
  planReviser,
} from '../mastra/agents/plan-reviser.ts';
import { runChildAgent } from './run-tracer.ts';

/**
 * 把 [rangeStart, rangeEnd] 章节的 book_states + chapters 抽给 arc-summarizer。
 * arcIdx 由调用方决定（通常是 (Math.floor(rangeStart / arcSize)+1) 这种）。
 */
export async function summarizeArc(opts: {
  bookId: string;
  rootRunId: string;
  arcIdx: number;
  rangeStart: number;
  rangeEnd: number;
}): Promise<{ arcSummaryId: string }> {
  const ch = await db
    .select({
      idx: chapters.idx,
      title: chapters.title,
      contentMd: chapters.contentMd,
      charCount: chapters.charCount,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.bookId, opts.bookId),
        gte(chapters.idx, opts.rangeStart),
        lte(chapters.idx, opts.rangeEnd),
      ),
    )
    .orderBy(chapters.idx);

  if (ch.length === 0) throw new Error('arc 内没有章节');

  const states = await db
    .select()
    .from(bookStates)
    .where(
      and(
        eq(bookStates.bookId, opts.bookId),
        gte(bookStates.chapterIdx, opts.rangeStart),
        lte(bookStates.chapterIdx, opts.rangeEnd),
      ),
    )
    .orderBy(bookStates.chapterIdx);

  const prompt = [
    `## 章节范围`,
    `第 ${opts.rangeStart} - ${opts.rangeEnd} 章（共 ${ch.length} 章）`,
    ``,
    `## 章节摘要（来自 book_states）`,
    states.length
      ? states
          .map(
            (s) =>
              `### 第 ${s.chapterIdx} 章\n阶段：${s.arcStage}\n事件：${s.lastEventSummaryMd}`,
          )
          .join('\n')
      : '（暂无 book_states）',
    ``,
    `## 章节正文（节选，每章前 600 字）`,
    ch
      .map((c) => `### 第 ${c.idx} 章 ${c.title}\n${truncate(c.contentMd, 600)}`)
      .join('\n\n'),
    ``,
    `## 任务`,
    `输出 JSON: { arcName, summaryMd, pivotsMd, openThreads }。summaryMd 200-450 字。`,
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'arc-summarizer',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { arcIdx: opts.arcIdx, range: [opts.rangeStart, opts.rangeEnd] },
    agent: arcSummarizer,
    schema: ArcSummaryResultSchema,
    prompt,
  });

  // upsert by (bookId, arcIdx)
  const [existing] = await db
    .select()
    .from(arcSummaries)
    .where(
      and(eq(arcSummaries.bookId, opts.bookId), eq(arcSummaries.arcIdx, opts.arcIdx)),
    );

  if (existing) {
    const [row] = await db
      .update(arcSummaries)
      .set({
        arcName: result.arcName,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
        summaryMd: result.summaryMd,
        pivotsMd: result.pivotsMd,
        openThreads: result.openThreads,
        generatedByRunId: opts.rootRunId,
      })
      .where(eq(arcSummaries.id, existing.id))
      .returning();
    return { arcSummaryId: row!.id };
  }
  const [row] = await db
    .insert(arcSummaries)
    .values({
      bookId: opts.bookId,
      arcIdx: opts.arcIdx,
      arcName: result.arcName,
      rangeStart: opts.rangeStart,
      rangeEnd: opts.rangeEnd,
      summaryMd: result.summaryMd,
      pivotsMd: result.pivotsMd,
      openThreads: result.openThreads,
      generatedByRunId: opts.rootRunId,
    })
    .returning();
  return { arcSummaryId: row!.id };
}

/**
 * 把所有 arc_summaries 喂给 book-summarizer，刷新 books.bookSummaryMd。
 */
export async function summarizeBook(opts: {
  bookId: string;
  rootRunId: string;
}): Promise<{ summaryMd: string }> {
  const arcs = await db
    .select()
    .from(arcSummaries)
    .where(eq(arcSummaries.bookId, opts.bookId))
    .orderBy(arcSummaries.arcIdx);

  if (arcs.length === 0) throw new Error('还没有 arc_summaries 可整合');

  const [book] = await db.select().from(books).where(eq(books.id, opts.bookId));
  if (!book) throw new Error(`book ${opts.bookId} 不存在`);

  const prompt = [
    `## 书`,
    `《${book.title}》`,
    ``,
    `## arc 摘要列表`,
    arcs
      .map(
        (a) =>
          `### Arc ${a.arcIdx} ${a.arcName}（第 ${a.rangeStart}-${a.rangeEnd} 章）\n${a.summaryMd}\n关键转折：${a.pivotsMd}\n开放伏笔：${(a.openThreads as string[]).join('；') || '—'}`,
      )
      .join('\n\n'),
    ``,
    `## 任务`,
    `输出 JSON: { summaryMd }。300-600 字，按 开端-发展-当前-暗线 四段。`,
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'book-summarizer',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { arcCount: arcs.length },
    agent: bookSummarizer,
    schema: BookSummaryResultSchema,
    prompt,
  });

  await db
    .update(books)
    .set({ bookSummaryMd: result.summaryMd })
    .where(eq(books.id, opts.bookId));

  return { summaryMd: result.summaryMd };
}

export const ReviseOutlineInputSchema = z.object({
  bookId: z.string().uuid(),
  upToChapterIdx: z.number().int().nonnegative(),
});
export type ReviseOutlineInput = z.infer<typeof ReviseOutlineInputSchema>;

/**
 * 让 plan-reviser 看一下是否要改大纲。可能产出新的 outline_revisions 行。
 * 调用方决定是否在下一章生成时使用新版（通过 books.outlineMd 自动反映）。
 */
export async function reviseOutline(opts: {
  bookId: string;
  rootRunId: string;
  upToChapterIdx: number;
}): Promise<{
  decision: 'keep' | 'revise' | 'rebuild-tail';
  newVersion?: number;
}> {
  const [book] = await db.select().from(books).where(eq(books.id, opts.bookId));
  if (!book) throw new Error(`book ${opts.bookId} 不存在`);

  const states = await db
    .select()
    .from(bookStates)
    .where(eq(bookStates.bookId, opts.bookId))
    .orderBy(bookStates.chapterIdx);

  const arcs = await db
    .select()
    .from(arcSummaries)
    .where(eq(arcSummaries.bookId, opts.bookId))
    .orderBy(arcSummaries.arcIdx);

  const loreDocs = await db
    .select({ title: bookDocs.title, contentMd: bookDocs.contentMd })
    .from(bookDocs)
    .where(and(eq(bookDocs.bookId, opts.bookId), eq(bookDocs.kind, 'lore')))
    .limit(20);

  const prompt = [
    `## 书`,
    `《${book.title}》当前大纲版本 v${book.outlineVersion}`,
    ``,
    `## 当前最新大纲（outlineMd）`,
    truncate(book.outlineMd, 3500),
    ``,
    `## 已写章节状态`,
    states
      .map(
        (s) =>
          `第 ${s.chapterIdx} 章 [${s.arcStage}] ${s.lastEventSummaryMd}`,
      )
      .join('\n'),
    ``,
    `## arc 摘要`,
    arcs.length
      ? arcs.map((a) => `Arc ${a.arcIdx} ${a.arcName}: ${a.pivotsMd}`).join('\n')
      : '（暂无）',
    ``,
    `## 世界观设定（lore 活文档）`,
    loreDocs.length
      ? loreDocs.map((d) => `### ${d.title}\n${oneLine(d.contentMd, 200)}`).join('\n\n')
      : '（暂无）',
    ``,
    `## 任务`,
    `当前已写到第 ${opts.upToChapterIdx} 章，下一章开始的方向是否还吻合？`,
    `输出 JSON: { decision, reasonMd, newOutlineMd, chapterPlan, riskNotesMd }。chapterPlan 必须只包含**第 ${opts.upToChapterIdx + 1} 章及以后**的未写章节。`,
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'plan-reviser',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { upToChapterIdx: opts.upToChapterIdx, currentVersion: book.outlineVersion },
    agent: planReviser,
    schema: PlanReviseResultSchema,
    prompt,
  });

  if (result.decision === 'keep') {
    return { decision: 'keep' };
  }

  const newVersion = book.outlineVersion + 1;
  const newOutlineMd =
    result.newOutlineMd && result.newOutlineMd.length > 40
      ? result.newOutlineMd
      : book.outlineMd;

  await db.insert(outlineRevisions).values({
    bookId: opts.bookId,
    version: newVersion,
    outlineMd: newOutlineMd,
    chapterPlan: result.chapterPlan,
    reasonMd: result.reasonMd,
    triggeredAtChapterIdx: opts.upToChapterIdx,
    generatedByRunId: opts.rootRunId,
    meta: { decision: result.decision, riskNotesMd: result.riskNotesMd } as unknown as Record<
      string,
      unknown
    >,
  });

  await db
    .update(books)
    .set({ outlineMd: newOutlineMd, outlineVersion: newVersion })
    .where(eq(books.id, opts.bookId));

  return { decision: result.decision, newVersion };
}

function oneLine(s: string, max = 100): string {
  return s.replace(/\s+/g, ' ').slice(0, max).trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…（截断 ${s.length - max} 字）`;
}

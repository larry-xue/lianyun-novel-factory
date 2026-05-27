import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  arcSummaries,
  chapters,
  volumeSummaries,
  type VolumeSummary,
} from '../db/schema/index.ts';
import {
  ArcSummaryResultSchema,
  arcSummarizer,
} from '../mastra/agents/arc-summarizer.ts';
import { runChildAgent } from './run-tracer.ts';

/**
 * 卷级摘要。S7 加。
 *
 * summarizeVolume：把本卷范围内的章节 + arc 摘要喂给 arc-summarizer agent
 * （复用 schema：arc-summarizer 输出 arcName/summaryMd/pivotsMd/openThreads，
 * 语义上当作"卷"用），落 volume_summaries 表。
 *
 * 风格滚动蒸馏（mergeStyleProfileFromVolume）已删——风格统一走 vault docs
 * (kind='style', ...) 路径，由用户/design-review/living-doc-updater 编辑。
 */

export async function summarizeVolume(opts: {
  bookId: string;
  rootRunId: string;
  volumeIdx: number;
  rangeStart: number;
  rangeEnd: number;
  volumeName?: string;
  styleDriftNotesMd?: string;
}): Promise<{ volumeSummaryId: string }> {
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
    .orderBy(asc(chapters.idx));

  if (ch.length === 0) throw new Error(`卷 ${opts.volumeIdx} 范围内没有章节`);

  const arcs = await db
    .select()
    .from(arcSummaries)
    .where(
      and(
        eq(arcSummaries.bookId, opts.bookId),
        gte(arcSummaries.rangeStart, opts.rangeStart),
        lte(arcSummaries.rangeEnd, opts.rangeEnd),
      ),
    )
    .orderBy(asc(arcSummaries.arcIdx));

  const prompt = [
    `## 卷范围`,
    `第 ${opts.rangeStart}-${opts.rangeEnd} 章（共 ${ch.length} 章 / ${arcs.length} 弧）`,
    ``,
    `## 该卷内已有的 arc 摘要`,
    arcs.length
      ? arcs
          .map(
            (a) =>
              `### Arc ${a.arcIdx} ${a.arcName}（第 ${a.rangeStart}-${a.rangeEnd} 章）\n${a.summaryMd}\n关键转折：${a.pivotsMd}`,
          )
          .join('\n\n')
      : '（暂无 arc 摘要）',
    ``,
    `## 章节首段节选`,
    ch.map((c) => `### 第 ${c.idx} 章 ${c.title}\n${c.contentMd.slice(0, 400)}`).join('\n\n'),
    ``,
    `## 任务`,
    `当前在做"卷"级摘要（不是 arc）。输出 JSON：{ arcName: 卷名, summaryMd: 300-600 字本卷主线推进, pivotsMd: 关键转折串联, openThreads: 卷末仍开放的伏笔 }。`,
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'volume-summarizer',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { volumeIdx: opts.volumeIdx, range: [opts.rangeStart, opts.rangeEnd] },
    agent: arcSummarizer,
    schema: ArcSummaryResultSchema,
    prompt,
  });

  const arcIdsCovered = arcs.map((a) => a.id);
  const [existing] = await db
    .select()
    .from(volumeSummaries)
    .where(
      and(
        eq(volumeSummaries.bookId, opts.bookId),
        eq(volumeSummaries.volumeIdx, opts.volumeIdx),
      ),
    );

  if (existing) {
    const [row] = await db
      .update(volumeSummaries)
      .set({
        volumeName: opts.volumeName ?? result.arcName,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
        summaryMd: result.summaryMd,
        pivotsMd: result.pivotsMd,
        styleDriftNotesMd: opts.styleDriftNotesMd ?? '',
        arcIdsCovered,
        generatedByRunId: opts.rootRunId,
      })
      .where(eq(volumeSummaries.id, existing.id))
      .returning();
    return { volumeSummaryId: row!.id };
  }

  const [row] = await db
    .insert(volumeSummaries)
    .values({
      bookId: opts.bookId,
      volumeIdx: opts.volumeIdx,
      volumeName: opts.volumeName ?? result.arcName,
      rangeStart: opts.rangeStart,
      rangeEnd: opts.rangeEnd,
      summaryMd: result.summaryMd,
      pivotsMd: result.pivotsMd,
      styleDriftNotesMd: opts.styleDriftNotesMd ?? '',
      arcIdsCovered,
      generatedByRunId: opts.rootRunId,
    })
    .returning();
  return { volumeSummaryId: row!.id };
}

export async function listVolumeSummariesForBook(bookId: string): Promise<VolumeSummary[]> {
  return await db
    .select()
    .from(volumeSummaries)
    .where(eq(volumeSummaries.bookId, bookId))
    .orderBy(asc(volumeSummaries.volumeIdx));
}

/**
 * 一卷写完时的便利包装：summarize 卷摘要。
 * 由 producer/UI 在卷末点用。
 */
export async function finalizeVolume(opts: {
  bookId: string;
  rootRunId: string;
  volumeIdx: number;
  rangeStart: number;
  rangeEnd: number;
  volumeName?: string;
  styleDriftNotesMd?: string;
}): Promise<{ volumeSummaryId: string }> {
  return await summarizeVolume(opts);
}

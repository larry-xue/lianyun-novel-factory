import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  bookDocs,
  bookStates,
  chapterSnapshots,
  chapters,
  outlineNodes,
  type ChapterSnapshot,
  type ChapterSnapshotDoc,
  type ChapterSnapshotState,
} from '../db/schema/index.ts';
import { upsertDoc } from './book-docs.ts';

/**
 * Pilot 模式：每写完一章打全量快照。回退 = 选中某章 → 还原 state/docs +
 * 软杀后续章节。
 *
 * 边界明确：v1 只还原 book_states / book_docs / chapters / outline_nodes /
 * chapter_snapshots 这五张表。plot_threads / arc_summaries / characters 等长程
 * 副作用 v1 不还原（用户回退后基本是重新跑 pilot 覆盖，不残留是 nice-to-have）。
 */

export async function snapshotAfterChapter(opts: {
  bookId: string;
  chapterIdx: number;
  batchId?: string | null;
  kind?: 'pilot' | 'manual';
  noteMd?: string;
}): Promise<ChapterSnapshot> {
  const { bookId, chapterIdx, batchId, kind = 'pilot', noteMd = '' } = opts;

  const [stateRow] = await db
    .select()
    .from(bookStates)
    .where(and(eq(bookStates.bookId, bookId), eq(bookStates.chapterIdx, chapterIdx)))
    .limit(1);

  const stateJsonb: ChapterSnapshotState = stateRow
    ? {
        arcStage: stateRow.arcStage,
        activeCharacters: stateRow.activeCharacters,
        lastEventSummaryMd: stateRow.lastEventSummaryMd,
        nextChapterIntentMd: stateRow.nextChapterIntentMd,
      }
    : {
        arcStage: '',
        activeCharacters: [],
        lastEventSummaryMd: '',
        nextChapterIntentMd: '',
      };

  const docs = await db
    .select({
      kind: bookDocs.kind,
      slug: bookDocs.slug,
      title: bookDocs.title,
      contentMd: bookDocs.contentMd,
      version: bookDocs.version,
      meta: bookDocs.meta,
    })
    .from(bookDocs)
    .where(eq(bookDocs.bookId, bookId));

  const docsJsonb: ChapterSnapshotDoc[] = docs.map((d) => ({
    kind: d.kind,
    slug: d.slug,
    title: d.title,
    contentMd: d.contentMd,
    version: d.version,
    meta: d.meta,
  }));

  const [row] = await db
    .insert(chapterSnapshots)
    .values({
      bookId,
      chapterIdx,
      kind,
      batchId: batchId ?? null,
      stateJsonb,
      docsJsonb,
      noteMd,
    })
    .onConflictDoUpdate({
      target: [chapterSnapshots.bookId, chapterSnapshots.chapterIdx],
      set: {
        kind,
        batchId: batchId ?? null,
        stateJsonb,
        docsJsonb,
        noteMd,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('snapshotAfterChapter: 写入失败');
  return row;
}

export async function listSnapshots(bookId: string): Promise<ChapterSnapshot[]> {
  return await db
    .select()
    .from(chapterSnapshots)
    .where(eq(chapterSnapshots.bookId, bookId))
    .orderBy(desc(chapterSnapshots.chapterIdx));
}

export async function getSnapshot(opts: {
  bookId: string;
  chapterIdx: number;
}): Promise<ChapterSnapshot | null> {
  const [row] = await db
    .select()
    .from(chapterSnapshots)
    .where(
      and(
        eq(chapterSnapshots.bookId, opts.bookId),
        eq(chapterSnapshots.chapterIdx, opts.chapterIdx),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * 把 book 还原到 chapterIdx 对应的快照点。返回回退影响的统计。
 * - book_states 中 chapter_idx > N 的行硬删
 * - book_docs 全量替换为快照中的 (kind, slug) 集合（snapshot 内升版，外的删）
 * - chapters 中 idx > N 的行 status='killed'（软删，保留 revisions）
 * - outline_nodes 中 idx > N 的行 status='planned'，clear chapter_id（让 planner 复用）
 * - chapter_snapshots 中 idx > N 的行硬删（不留未来快照）
 */
export async function restoreToChapter(opts: {
  bookId: string;
  chapterIdx: number;
  /** 用 audit 调用方传入的 runId 标记本次还原产生的 doc 修订 */
  runId?: string;
}): Promise<{
  killedChapters: number;
  deletedStates: number;
  restoredDocs: number;
  deletedDocs: number;
  resetOutlineNodes: number;
  deletedFutureSnapshots: number;
}> {
  const snap = await getSnapshot({ bookId: opts.bookId, chapterIdx: opts.chapterIdx });
  if (!snap) throw new Error(`restoreToChapter: 找不到 ch${opts.chapterIdx} 的快照`);

  // 1) book_states：删 idx > N 的，保证 getLatestState 拿到 N 这条
  const deletedStates = await db
    .delete(bookStates)
    .where(
      and(eq(bookStates.bookId, opts.bookId), gt(bookStates.chapterIdx, opts.chapterIdx)),
    )
    .returning({ idx: bookStates.chapterIdx });

  // 2) book_docs：用 snapshot 全量替换。
  //    a) snapshot 里的每份 doc → upsertDoc 升版（保留版本链，不丢历史）
  //    b) 当前 DB 里有但 snapshot 里没有的 → 直接删（这些是快照后新建的）
  const snapKeys = new Set(snap.docsJsonb.map((d) => `${d.kind}/${d.slug}`));
  const currentDocs = await db
    .select({ id: bookDocs.id, kind: bookDocs.kind, slug: bookDocs.slug })
    .from(bookDocs)
    .where(eq(bookDocs.bookId, opts.bookId));

  let restoredDocs = 0;
  for (const d of snap.docsJsonb) {
    await upsertDoc({
      bookId: opts.bookId,
      kind: d.kind,
      slug: d.slug,
      title: d.title,
      contentMd: d.contentMd,
      editor: 'human',
      reasonMd: `回退到 ch${opts.chapterIdx} 快照`,
      runId: opts.runId,
      generatedByRunId: opts.runId,
      meta: d.meta,
    });
    restoredDocs++;
  }

  let deletedDocs = 0;
  for (const c of currentDocs) {
    if (!snapKeys.has(`${c.kind}/${c.slug}`)) {
      await db.delete(bookDocs).where(eq(bookDocs.id, c.id));
      deletedDocs++;
    }
  }

  // 3) chapters：idx > N → status='killed'
  const killed = await db
    .update(chapters)
    .set({ status: 'killed' })
    .where(and(eq(chapters.bookId, opts.bookId), gt(chapters.idx, opts.chapterIdx)))
    .returning({ idx: chapters.idx });

  // 4) outline_nodes：idx > N 的 chapter 节点回到 planned，便于 planner 复用槽位
  const reset = await db
    .update(outlineNodes)
    .set({ status: 'planned', chapterId: null })
    .where(
      and(
        eq(outlineNodes.bookId, opts.bookId),
        eq(outlineNodes.level, 'chapter'),
        gt(outlineNodes.idx, opts.chapterIdx),
      ),
    )
    .returning({ idx: outlineNodes.idx });

  // 5) chapter_snapshots：删 idx > N（未来快照不留）
  const deletedFutureSnapshots = await db
    .delete(chapterSnapshots)
    .where(
      and(
        eq(chapterSnapshots.bookId, opts.bookId),
        gt(chapterSnapshots.chapterIdx, opts.chapterIdx),
      ),
    )
    .returning({ idx: chapterSnapshots.chapterIdx });

  return {
    killedChapters: killed.length,
    deletedStates: deletedStates.length,
    restoredDocs,
    deletedDocs,
    resetOutlineNodes: reset.length,
    deletedFutureSnapshots: deletedFutureSnapshots.length,
  };
}

/** 用于 UI 列表场景的 lightweight 视图（不发 docs_jsonb 全量给前端）。 */
export async function listSnapshotsLite(bookId: string): Promise<
  Array<{
    id: string;
    chapterIdx: number;
    kind: string;
    batchId: string | null;
    noteMd: string;
    docCount: number;
    arcStage: string;
    lastEventSummaryMd: string;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select({
      id: chapterSnapshots.id,
      chapterIdx: chapterSnapshots.chapterIdx,
      kind: chapterSnapshots.kind,
      batchId: chapterSnapshots.batchId,
      noteMd: chapterSnapshots.noteMd,
      stateJsonb: chapterSnapshots.stateJsonb,
      docCount: sql<number>`jsonb_array_length(${chapterSnapshots.docsJsonb})::int`,
      createdAt: chapterSnapshots.createdAt,
    })
    .from(chapterSnapshots)
    .where(eq(chapterSnapshots.bookId, bookId))
    .orderBy(asc(chapterSnapshots.chapterIdx));
  return rows.map((r) => ({
    id: r.id,
    chapterIdx: r.chapterIdx,
    kind: r.kind,
    batchId: r.batchId,
    noteMd: r.noteMd,
    docCount: r.docCount,
    arcStage: r.stateJsonb.arcStage,
    lastEventSummaryMd: r.stateJsonb.lastEventSummaryMd,
    createdAt: r.createdAt,
  }));
}

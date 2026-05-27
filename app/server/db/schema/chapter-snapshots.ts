import {
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { batches } from './batches.ts';
import { books } from './books.ts';

/**
 * 章节快照：pilot 跑批时每写完一章打一份。回退 = 选中某章快照 →
 * 还原 state_jsonb / docs_jsonb，软删 chapters.idx > snapshot.chapterIdx。
 *
 * 设计点：
 * - state_jsonb 装 book_states 行的关键字段（arcStage / activeCharacters /
 *   lastEventSummaryMd / nextChapterIntentMd），不存 generatedByRunId 这类 trace
 * - docs_jsonb 装当时所有 book_docs 的全量内容数组，回退时按 (kind, slug) 还原
 *   每份 doc.contentMd / title / meta；快照不带版本（回退时直接 upsertDoc 增版）
 * - (book_id, chapter_idx) unique：每个章节点最多一份快照，重跑时 ON CONFLICT 覆盖
 * - kind 标记 'pilot' / 'manual'；目前只 pilot 模式自动写
 */
export interface ChapterSnapshotState {
  arcStage: string;
  activeCharacters: Array<{ name: string; status: string }>;
  lastEventSummaryMd: string;
  nextChapterIntentMd: string;
}

export interface ChapterSnapshotDoc {
  kind: string;
  slug: string;
  title: string;
  contentMd: string;
  /** 快照时刻的 version，便于排查 */
  version: number;
  meta: Record<string, unknown>;
}

export const chapterSnapshots = pgTable(
  'chapter_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapterIdx: integer('chapter_idx').notNull(),
    kind: text('kind').notNull().default('pilot'),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    stateJsonb: jsonb('state_jsonb')
      .$type<ChapterSnapshotState>()
      .notNull()
      .default({
        arcStage: '',
        activeCharacters: [],
        lastEventSummaryMd: '',
        nextChapterIntentMd: '',
      }),
    docsJsonb: jsonb('docs_jsonb')
      .$type<ChapterSnapshotDoc[]>()
      .notNull()
      .default([]),
    noteMd: text('note_md').notNull().default(''),
    ...timestamps,
  },
  (t) => [unique('chapter_snapshots_book_idx_unique').on(t.bookId, t.chapterIdx)],
);

export type ChapterSnapshot = typeof chapterSnapshots.$inferSelect;
export type ChapterSnapshotInsert = typeof chapterSnapshots.$inferInsert;

import { sql } from 'drizzle-orm';
import { integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

/**
 * 卷级摘要：与 arc_summaries 同构，高一级。
 * 每写完一卷触发：合并该卷的 arc_summaries → 一份 200-600 字的卷推进总结。
 *
 * styleDriftNotesMd 记录本卷写作期间的风格漂移观察，作为 style-merger 的输入。
 */
export const volumeSummaries = pgTable(
  'volume_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    volumeIdx: integer('volume_idx').notNull(),
    volumeName: text('volume_name').notNull().default(''),
    rangeStart: integer('range_start').notNull(),
    rangeEnd: integer('range_end').notNull(),
    summaryMd: text('summary_md').notNull(),
    pivotsMd: text('pivots_md').notNull().default(''),
    styleDriftNotesMd: text('style_drift_notes_md').notNull().default(''),
    arcIdsCovered: uuid('arc_ids_covered')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    generatedByRunId: uuid('generated_by_run_id'),
    ...timestamps,
  },
  (t) => [unique('volume_summaries_book_idx_unique').on(t.bookId, t.volumeIdx)],
);

export type VolumeSummary = typeof volumeSummaries.$inferSelect;
export type VolumeSummaryInsert = typeof volumeSummaries.$inferInsert;

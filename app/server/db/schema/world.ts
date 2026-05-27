import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

/**
 * Arc 级摘要：跨多章的"剧情段落"摘要。
 * 由 arc-summarizer 周期生成（每 K 章一次或剧情阶段切换时）。
 */
export const arcSummaries = pgTable(
  'arc_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    arcIdx: integer('arc_idx').notNull(),
    arcName: text('arc_name').notNull().default(''),
    rangeStart: integer('range_start').notNull(),
    rangeEnd: integer('range_end').notNull(),
    summaryMd: text('summary_md').notNull(),
    pivotsMd: text('pivots_md').notNull().default(''),
    openThreads: text('open_threads')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedByRunId: uuid('generated_by_run_id'),
    ...timestamps,
  },
  (t) => [unique('arc_summaries_book_idx_unique').on(t.bookId, t.arcIdx)],
);

export type ArcSummary = typeof arcSummaries.$inferSelect;
export type ArcSummaryInsert = typeof arcSummaries.$inferInsert;

/**
 * 每次大纲被改写一次都新增一行；books.outlineMd 永远是当前最新版。
 * 用于 plan-reviser 自动改大纲、人工干预、回滚审计。
 */
export const outlineRevisions = pgTable(
  'outline_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    outlineMd: text('outline_md').notNull(),
    chapterPlan: jsonb('chapter_plan')
      .$type<Array<{ idx: number; title: string; summaryMd: string; intent: string }>>()
      .notNull()
      .default([]),
    reasonMd: text('reason_md').notNull().default(''),
    triggeredAtChapterIdx: integer('triggered_at_chapter_idx'),
    generatedByRunId: uuid('generated_by_run_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('outline_revisions_book_version_unique').on(t.bookId, t.version)],
);

export type OutlineRevision = typeof outlineRevisions.$inferSelect;
export type OutlineRevisionInsert = typeof outlineRevisions.$inferInsert;

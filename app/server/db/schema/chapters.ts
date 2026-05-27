import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

export const chapterStatusEnum = pgEnum('chapter_status', [
  'planned',
  'drafting',
  'hooking',
  'polishing',
  'guarding',
  'final',
  'killed',
]);

/**
 * 章节正稿。content_md 是当前 final 版本；历史版本去 chapter_revisions 找。
 * char_count 单独存方便筛选 "字数不达标" 的章节。
 */
export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title').notNull().default(''),
    contentMd: text('content_md').notNull().default(''),
    charCount: integer('char_count').notNull().default(0),
    status: chapterStatusEnum('status').notNull().default('planned'),
    scores: jsonb('scores').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('chapters_book_idx_unique').on(t.bookId, t.idx)],
);

export type Chapter = typeof chapters.$inferSelect;
export type ChapterInsert = typeof chapters.$inferInsert;

export const revisionKindEnum = pgEnum('revision_kind', [
  'raw',
  'hooked',
  'polished',
  'guard_fixed',
  'gate_rejected',
  'manual',
]);

/**
 * 每一步的产物都存一份。回放/对比/数据集导出都靠它。
 */
export const chapterRevisions = pgTable('chapter_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  kind: revisionKindEnum('kind').notNull(),
  contentMd: text('content_md').notNull(),
  charCount: integer('char_count').notNull().default(0),
  runId: uuid('run_id'),
  notesMd: text('notes_md').notNull().default(''),
  ...timestamps,
});

export type ChapterRevision = typeof chapterRevisions.$inferSelect;
export type ChapterRevisionInsert = typeof chapterRevisions.$inferInsert;

import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';
import { chapters } from './chapters.ts';

export const outlineNodeLevelEnum = pgEnum('outline_node_level', ['volume', 'arc', 'chapter']);

export const outlineNodeStatusEnum = pgEnum('outline_node_status', [
  'planned',
  'writing',
  'done',
  'revised',
  'skipped',
]);

/**
 * 分层大纲节点：自引用树。
 *
 * level=volume → parentId=null（卷是顶层）
 * level=arc    → parentId=某个 volume
 * level=chapter→ parentId=某个 arc（兼容老数据时也允许=null，整本无层级）
 *
 * 唯一约束 (book_id, parent_id, idx) 在迁移文件里通过两条 partial unique index 实现
 * （drizzle 0.39 还不支持 nullsNotDistinct）：
 *   1. WHERE parent_id IS NOT NULL —— 同父节点下 idx 唯一
 *   2. WHERE parent_id IS NULL     —— 同书的顶层 idx 唯一
 *
 * chapterId 可空：章节拍可在写出 chapters 行后回填关联。
 *
 * expectedThreadEvents 是软关联：本节预计触发哪些伏笔事件，给 chapter-writer 当线索。
 * 不做外键，因为 thread 可能尚未创建。
 */
export const outlineNodes = pgTable('outline_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => outlineNodes.id, {
    onDelete: 'cascade',
  }),
  level: outlineNodeLevelEnum('level').notNull(),
  idx: integer('idx').notNull(),
  title: text('title').notNull().default(''),
  summaryMd: text('summary_md').notNull().default(''),
  intent: text('intent').notNull().default(''),
  pacingPhase: text('pacing_phase').notNull().default(''),
  status: outlineNodeStatusEnum('status').notNull().default('planned'),
  chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  expectedThreadEvents: jsonb('expected_thread_events')
    .$type<Array<{ threadSlug?: string; threadTitle?: string; kind: string }>>()
    .notNull()
    .default([]),
  generatedByRunId: uuid('generated_by_run_id'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export type OutlineNode = typeof outlineNodes.$inferSelect;
export type OutlineNodeInsert = typeof outlineNodes.$inferInsert;

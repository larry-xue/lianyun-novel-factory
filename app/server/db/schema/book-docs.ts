import { boolean, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

export const docEditorEnum = pgEnum('doc_editor', ['agent', 'human']);

/**
 * book_docs 的分类注册表（kind 走 text + 旁路 lookup，非 pgEnum）。
 * 让 agent 可以引入新 kind 时先 upsert 这里再写 doc。
 */
export const bookDocKinds = pgTable('book_doc_kinds', {
  slug: text('slug').primaryKey(),
  zh: text('zh').notNull(),
  descriptionMd: text('description_md').notNull().default(''),
  introducedBy: docEditorEnum('introduced_by').notNull().default('human'),
  ...timestamps,
});

export type BookDocKind = typeof bookDocKinds.$inferSelect;
export type BookDocKindInsert = typeof bookDocKinds.$inferInsert;

/**
 * 通用「活文档」：地图、人物关系、时间线、设定、主编笔记，以及 AI 自创的新 kind。
 *
 * 设计点：
 * - kind 是 text（不是 pgEnum），允许 AI 引入新分类 —— P8 原则
 * - contentMd 内部不强制结构（P7），整篇覆盖；旧版本去 book_doc_revisions 找
 * - lastEditedBy 区分 agent/human，UI 可显示
 */
export const bookDocs = pgTable(
  'book_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    version: integer('version').notNull().default(1),
    lastEditedBy: docEditorEnum('last_edited_by').notNull().default('agent'),
    generatedByRunId: uuid('generated_by_run_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * 用户在 chapter-scout chat 钦点的内容（如 chapter-plan）。
     * chapter-writer 优先消费 pinned 的 chapter-plan；plan-reviser 看到
     * pinned=true 就跳过它不重排。
     */
    pinnedByUser: boolean('pinned_by_user').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('book_docs_book_kind_slug_unique').on(t.bookId, t.kind, t.slug)],
);

export type BookDoc = typeof bookDocs.$inferSelect;
export type BookDocInsert = typeof bookDocs.$inferInsert;

/**
 * 编辑历史。每次 contentMd 变更都新增一行（agent 或 human 编辑都记）。
 */
export const bookDocRevisions = pgTable('book_doc_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id')
    .notNull()
    .references(() => bookDocs.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  contentMd: text('content_md').notNull(),
  editedBy: docEditorEnum('edited_by').notNull(),
  reasonMd: text('reason_md').notNull().default(''),
  runId: uuid('run_id'),
  ...timestamps,
});

export type BookDocRevision = typeof bookDocRevisions.$inferSelect;
export type BookDocRevisionInsert = typeof bookDocRevisions.$inferInsert;

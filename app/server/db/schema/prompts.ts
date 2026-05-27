import { boolean, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { docEditorEnum } from './book-docs.ts';

export const promptRoleEnum = pgEnum('prompt_role', ['system', 'user']);

/**
 * 所有 agent 的 prompt 模板都进这张表，UI 可改 / 看历史 / 回滚（P9）。
 * slug 命名规范：<agent>.<role>(.<variant>) 如 'chapter-writer.system' / 'chapter-writer.user.rewrite'
 *
 * templateMd 含 {{var}} 占位符；用 renderPrompt(slug, vars) 渲染。
 * variables 字段自描述，UI 编辑器据此提示哪些占位符可用。
 */
export const prompts = pgTable('prompts', {
  slug: text('slug').primaryKey(),
  agentId: text('agent_id').notNull(),
  role: promptRoleEnum('role').notNull(),
  title: text('title').notNull(),
  templateMd: text('template_md').notNull(),
  variables: jsonb('variables')
    .$type<Array<{ name: string; description: string; example?: string }>>()
    .notNull()
    .default([]),
  notesMd: text('notes_md').notNull().default(''),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export type Prompt = typeof prompts.$inferSelect;
export type PromptInsert = typeof prompts.$inferInsert;

export const promptRevisions = pgTable(
  'prompt_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    version: integer('version').notNull(),
    templateMd: text('template_md').notNull(),
    editedBy: docEditorEnum('edited_by').notNull(),
    reasonMd: text('reason_md').notNull().default(''),
    ...timestamps,
  },
  (t) => [unique('prompt_revisions_slug_version_unique').on(t.slug, t.version)],
);

export type PromptRevision = typeof promptRevisions.$inferSelect;
export type PromptRevisionInsert = typeof promptRevisions.$inferInsert;

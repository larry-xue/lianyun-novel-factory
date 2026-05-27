import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const hookKindEnum = pgEnum('hook_kind', ['open', 'close', 'cliff', 'reveal']);

/**
 * Hook 模板库：开篇钩子、章末钩子、悬念升级、信息差揭穿等。
 * scenarios 标注适配的品类/场景（自由文本），方便检索。
 */
export const hooks = pgTable('hooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: hookKindEnum('kind').notNull(),
  templateMd: text('template_md').notNull(),
  scenarios: text('scenarios')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps,
});

export type Hook = typeof hooks.$inferSelect;
export type HookInsert = typeof hooks.$inferInsert;

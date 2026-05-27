import { sql } from 'drizzle-orm';
import { real, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const elements = pgTable('elements', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  zh: text('zh').notNull(),
  category: text('category').notNull(),
  hotScore: real('hot_score').notNull().default(0),
  definitionMd: text('definition_md').notNull().default(''),
  comboFriendly: text('combo_friendly')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  comboAvoid: text('combo_avoid')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps,
});

export type Element = typeof elements.$inferSelect;
export type ElementInsert = typeof elements.$inferInsert;

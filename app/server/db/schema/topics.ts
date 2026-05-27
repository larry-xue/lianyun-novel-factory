import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const topicStatusEnum = pgEnum('topic_status', [
  'draft',
  'approved',
  'launched',
  'shelved',
]);

/**
 * 选题卡：一个候选 idea，记录元素组合 + hook + 目标读者 + 自评分。
 * 通过 topic_scout 生成，人工 review 后进入 launched 状态变成 book。
 */
export const topicCards = pgTable('topic_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  hook: text('hook').notNull().default(''),
  elementSlugs: text('element_slugs')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  targetAudience: text('target_audience').notNull().default(''),
  mainCategory: text('main_category').notNull().default(''),
  themes: text('themes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  characterTypes: text('character_types')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  plotElements: text('plot_elements')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  status: topicStatusEnum('status').notNull().default('draft'),
  score: jsonb('score').$type<Record<string, unknown>>().notNull().default({}),
  scoreOverall: real('score_overall').notNull().default(0),
  notesMd: text('notes_md').notNull().default(''),
  ...timestamps,
});

export type TopicCard = typeof topicCards.$inferSelect;
export type TopicCardInsert = typeof topicCards.$inferInsert;

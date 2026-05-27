import { sql } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

/**
 * 范文：采集到的优秀小说原文片段。立项时 scout agent 摘抄、给 chapter-writer
 * 当参考；不再走"蒸馏成风格指纹"那条路（已删）。
 */
export const styleSamples = pgTable('style_samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  author: text('author').notNull(),
  title: text('title').notNull(),
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  contentMd: text('content_md').notNull(),
  sourceUrl: text('source_url'),
  ...timestamps,
});

export type StyleSample = typeof styleSamples.$inferSelect;
export type StyleSampleInsert = typeof styleSamples.$inferInsert;

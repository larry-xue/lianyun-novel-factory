import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

/**
 * 反例库：扑街选题、踩雷桥段、风格翻车样本。
 * 喂给 consistency-guard 和 style-polisher 当 negative few-shot。
 */
export const antiPatterns = pgTable('anti_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  contentMd: text('content_md').notNull(),
  sourceRunId: uuid('source_run_id'),
  ...timestamps,
});

export type AntiPattern = typeof antiPatterns.$inferSelect;
export type AntiPatternInsert = typeof antiPatterns.$inferInsert;

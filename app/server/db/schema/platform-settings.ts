import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().default({}),
  ...timestamps,
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
export type PlatformSettingInsert = typeof platformSettings.$inferInsert;

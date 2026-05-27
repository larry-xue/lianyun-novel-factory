import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { llmCalls, runs } from './runs.ts';

/**
 * harness 模式下，agent 在一次 run 内可能多轮 model turn + 多次工具调用。
 * 每个工具调用在这里记一行，便于 /runs/$id 时间序回放：
 * - 哪个 model turn 触发的
 * - 哪个工具、什么参数
 * - 返回了什么（result_md 是已经 format 好喂回模型的文本）
 * - 多久
 *
 * tool_name 形如 list / read / grep / update_doc / mark_thread / submit_chapter。
 */
export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  parentLlmCallId: uuid('parent_llm_call_id').references(() => llmCalls.id, {
    onDelete: 'set null',
  }),
  seq: integer('seq').notNull(),
  toolName: text('tool_name').notNull(),
  argsJson: jsonb('args_json').$type<Record<string, unknown>>().notNull().default({}),
  resultMd: text('result_md').notNull().default(''),
  errorMd: text('error_md'),
  durationMs: integer('duration_ms'),
  ...timestamps,
});

export type ToolCall = typeof toolCalls.$inferSelect;
export type ToolCallInsert = typeof toolCalls.$inferInsert;

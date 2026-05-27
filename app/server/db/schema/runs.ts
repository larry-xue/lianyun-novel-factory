import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const runStatusEnum = pgEnum('run_status', [
  'pending',
  'running',
  'success',
  'failure',
  'cancelled',
]);

/**
 * 一次 Skill / workflow 执行的审计记录。
 * parent_id 形成 tree，可以把 batch-prospect 这种宏任务下面挂多次 chapter-write。
 * input/output 是 jsonb，便于回放/导出数据集。
 */
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  status: runStatusEnum('status').notNull().default('pending'),
  parentId: uuid('parent_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
  bookId: uuid('book_id'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>().notNull().default({}),
  errorMd: text('error_md'),
  model: text('model'),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ...timestamps,
});

export type Run = typeof runs.$inferSelect;
export type RunInsert = typeof runs.$inferInsert;

/**
 * 每一次 LLM 调用 = 一行。挂在 run 上做 trace 树。
 * cache_hit 给提示缓存观察；prompt/response 全文留底（早期能 debug）。
 */
export const llmCalls = pgTable('llm_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  prompt: jsonb('prompt').$type<unknown>().notNull(),
  response: text('response'),
  responseJson: jsonb('response_json').$type<unknown>(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  cacheHit: boolean('cache_hit').notNull().default(false),
  latencyMs: integer('latency_ms'),
  errorMd: text('error_md'),
  ...timestamps,
});

export type LlmCall = typeof llmCalls.$inferSelect;
export type LlmCallInsert = typeof llmCalls.$inferInsert;

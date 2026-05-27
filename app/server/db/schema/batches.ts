import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const batchStatusEnum = pgEnum('batch_status', [
  'queued',
  'running',
  'completed',
  'cancelled',
]);

/**
 * 一次铺量批次。N 个 produce-book job 挂在一个 batch 下。
 * 选题数组里每条对应一次 produceBook 入参；早期淘汰由 produceBook 自己负责。
 */
export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: batchStatusEnum('status').notNull().default('queued'),
  concurrency: integer('concurrency').notNull().default(2),
  earlyKillBelowChars: integer('early_kill_below_chars').notNull().default(2200),
  jobsTotal: integer('jobs_total').notNull().default(0),
  jobsCompleted: integer('jobs_completed').notNull().default(0),
  jobsKilled: integer('jobs_killed').notNull().default(0),
  jobsFailed: integer('jobs_failed').notNull().default(0),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export type Batch = typeof batches.$inferSelect;
export type BatchInsert = typeof batches.$inferInsert;

export const batchJobStatusEnum = pgEnum('batch_job_status', [
  'pending',
  'running',
  'success',
  'killed',
  'failure',
]);

export const batchJobs = pgTable('batch_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  status: batchJobStatusEnum('status').notNull().default('pending'),
  topicTitle: text('topic_title').notNull(),
  pitch: text('pitch').notNull(),
  elementSlugs: text('element_slugs')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  bookId: uuid('book_id'),
  rootRunId: uuid('root_run_id'),
  pgBossJobId: text('pg_boss_job_id'),
  errorMd: text('error_md'),
  resultMeta: jsonb('result_meta').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export type BatchJob = typeof batchJobs.$inferSelect;
export type BatchJobInsert = typeof batchJobs.$inferInsert;

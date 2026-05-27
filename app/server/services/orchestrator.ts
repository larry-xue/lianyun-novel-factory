import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import PgBoss from 'pg-boss';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { batchJobs, batches } from '../db/schema/index.ts';
import { produceBook, runPilotChapters } from './book-producer.ts';
import { startTimeoutSweeper, stopTimeoutSweeper } from './timeout-sweeper.ts';

export const QUEUE_PRODUCE_BOOK = 'produce-book';
export const QUEUE_PILOT_EXTEND = 'pilot-extend';

export const BatchJobInputSchema = z
  .object({
    topicTitle: z.string().min(2).max(40),
    pitch: z.string().min(10),
    elementSlugs: z.array(z.string().min(1)).min(1).max(10),
    totalChapters: z.number().int().min(1).max(40).default(1),
    charsPerChapter: z.number().int().min(800).max(6000).default(3000),
    /**
     * Pilot 模式：每章写完后打 chapter_snapshots 全量快照，便于 UI 一键回退。
     * 与「单章 chapter-scout chat」互斥（不阻止 chat 创建，但 pilot 跑批进行
     * 中前端会提示用户先取消 batch 才能 chat）。
     */
    pilot: z.boolean().default(false),
  })
  .refine((v) => !v.pilot || v.totalChapters <= 20, {
    message: 'pilot 模式下 totalChapters 不能超过 20',
    path: ['totalChapters'],
  });
export type BatchJobInput = z.infer<typeof BatchJobInputSchema>;

export const BatchInputSchema = z.object({
  name: z.string().min(2).max(80),
  concurrency: z.number().int().min(1).max(8).default(2),
  earlyKillBelowChars: z.number().int().min(0).max(6000).default(2200),
  jobs: z.array(BatchJobInputSchema).min(1).max(50),
});
export type BatchInput = z.infer<typeof BatchInputSchema>;

interface JobPayload {
  batchId: string;
  batchJobId: string;
  earlyKillBelowChars: number;
  ownerId?: string | null;
  input: BatchJobInput;
}

/** Pilot 续写：在已有 book 上跑 N 章（≤20），每章打 chapter_snapshots。 */
interface PilotExtendPayload {
  bookId: string;
  chapterCount: number;
  batchId: string;
  batchJobId: string;
  ownerId?: string | null;
}

let bossSingleton: PgBoss | undefined;

/**
 * 全局并发：N 本书可以同时进 produceBook。从 env BATCH_CONCURRENCY 读。
 * mvp 是全局值（不是 per-batch）：每个 batch row 上的 concurrency 字段
 * 当前作为「用户期望值」记录，实际调度由这里的 teamSize 控制。
 *
 * 想 per-batch 并发需要动态 worker pool，复杂；先 env 配 + 重启切。
 */
export function parseGlobalConcurrency(raw: string | number | undefined): number {
  const n = Number(raw ?? 2);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 16) return 16; // 上限：LLM rate limit + db connections
  return Math.floor(n);
}

function readGlobalConcurrency(): number {
  return parseGlobalConcurrency(process.env.BATCH_CONCURRENCY);
}

/**
 * 拿到一个全局 pg-boss 实例。复用 DATABASE_URL，用独立 schema `pgboss` 隔离。
 * 第一次拿到时启动 + 注册 worker（含 teamSize 并发）。
 */
export async function getBoss(): Promise<PgBoss> {
  if (bossSingleton) return bossSingleton;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const concurrency = readGlobalConcurrency();
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',
    retentionDays: 7,
  });
  await boss.start();
  await boss.createQueue(QUEUE_PRODUCE_BOOK);
  await boss.createQueue(QUEUE_PILOT_EXTEND);
  await boss.work<JobPayload>(
    QUEUE_PRODUCE_BOOK,
    {
      // pg-boss v10.x 用 batchSize + Promise.all 表示并发（没有独立的
      // teamSize）。一次 fetch N 个 job，handler 里 Promise.all 并发处理。
      batchSize: concurrency,
      pollingIntervalSeconds: 2,
    },
    async (jobs) => {
      await Promise.all(jobs.map((job) => runBatchJob(job.id, job.data)));
    },
  );
  await boss.work<PilotExtendPayload>(
    QUEUE_PILOT_EXTEND,
    { batchSize: concurrency, pollingIntervalSeconds: 2 },
    async (jobs) => {
      await Promise.all(jobs.map((job) => runPilotExtendJob(job.id, job.data)));
    },
  );
  console.log(`[orchestrator] pg-boss workers started: produce-book + pilot-extend, 并发=${concurrency}`);
  startTimeoutSweeper();
  bossSingleton = boss;
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (!bossSingleton) return;
  stopTimeoutSweeper();
  await bossSingleton.stop({ graceful: true });
  bossSingleton = undefined;
}

/**
 * 创建一个 batch + 派发 N 个 produce-book job。
 * jobs 共享一个 batchId，可在 /batches/$id 看进度。
 */
export async function enqueueBatch(
  input: unknown,
): Promise<{
  batchId: string;
  jobsTotal: number;
}> {
  const raw = input as { ownerId?: string | null } & Record<string, unknown>;
  const cfg = BatchInputSchema.parse(raw);
  const ownerId = typeof raw?.ownerId === 'string' ? raw.ownerId : null;
  const boss = await getBoss();

  const anyPilot = cfg.jobs.some((j) => j.pilot);
  const [batch] = await db
    .insert(batches)
    .values({
      name: cfg.name,
      status: 'running',
      concurrency: cfg.concurrency,
      earlyKillBelowChars: cfg.earlyKillBelowChars,
      jobsTotal: cfg.jobs.length,
      meta: {
        defaults: { totalChapters: 20, charsPerChapter: 3000 },
        pilot: anyPilot,
      },
    })
    .returning();
  if (!batch) throw new Error('failed to insert batch');

  for (const j of cfg.jobs) {
    const [row] = await db
      .insert(batchJobs)
      .values({
        batchId: batch.id,
        topicTitle: j.topicTitle,
        pitch: j.pitch,
        elementSlugs: j.elementSlugs,
        status: 'pending',
      })
      .returning();
    if (!row) throw new Error('failed to insert batch_job');

    const jobId = await boss.send(
      QUEUE_PRODUCE_BOOK,
      {
        batchId: batch.id,
        batchJobId: row.id,
        earlyKillBelowChars: cfg.earlyKillBelowChars,
        ownerId,
        input: j,
      } satisfies JobPayload,
      { retryLimit: 0, expireInSeconds: 3600 * 6 },
    );

    if (jobId) {
      await db
        .update(batchJobs)
        .set({ pgBossJobId: jobId })
        .where(eq(batchJobs.id, row.id));
    }
  }

  return { batchId: batch.id, jobsTotal: cfg.jobs.length };
}

async function runBatchJob(pgBossJobId: string, payload: JobPayload): Promise<void> {
  await db
    .update(batchJobs)
    .set({ status: 'running', pgBossJobId })
    .where(eq(batchJobs.id, payload.batchJobId));

  try {
    const result = await produceBook({
      ...payload.input,
      earlyKillBelowChars: payload.earlyKillBelowChars,
      ownerId: payload.ownerId ?? null,
      // pilot/batchId 从 BatchJobInput / payload 透传，让 runChapterLoop
      // 每章写完后打 chapter_snapshots（kind='pilot', batch_id=本 batch）。
      batchId: payload.batchId,
    });
    await db
      .update(batchJobs)
      .set({
        status: result.killed ? 'killed' : 'success',
        bookId: result.bookId,
        rootRunId: result.rootRunId,
        resultMeta: {
          chaptersWritten: result.chaptersWritten,
          totalCharCount: result.totalCharCount,
          averageCharCount: result.averageCharCount,
          killReason: result.killReason,
        },
      })
      .where(eq(batchJobs.id, payload.batchJobId));

    await db
      .update(batches)
      .set(
        result.killed
          ? { jobsKilled: sql`${batches.jobsKilled} + 1` }
          : { jobsCompleted: sql`${batches.jobsCompleted} + 1` },
      )
      .where(eq(batches.id, payload.batchId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(batchJobs)
      .set({ status: 'failure', errorMd: message })
      .where(eq(batchJobs.id, payload.batchJobId));
    await db
      .update(batches)
      .set({ jobsFailed: sql`${batches.jobsFailed} + 1` })
      .where(eq(batches.id, payload.batchId));
    throw err;
  } finally {
    await maybeFinalizeBatch(payload.batchId);
  }
}

/**
 * 在已有 book 上排一个 pilot 续写 job（最多 20 章，每章打快照）。
 * 复用 batches/batchJobs 行做进度展示。
 */
export async function enqueuePilotExtend(input: {
  bookId: string;
  chapterCount: number;
  topicTitle: string;
  ownerId?: string | null;
}): Promise<{ batchId: string; batchJobId: string }> {
  const chapterCount = Math.min(20, Math.max(1, Math.floor(input.chapterCount)));
  const boss = await getBoss();

  const [batch] = await db
    .insert(batches)
    .values({
      name: `pilot · ${input.topicTitle.slice(0, 60)}`,
      status: 'running',
      concurrency: 1,
      earlyKillBelowChars: 0,
      jobsTotal: 1,
      meta: { pilot: true, chapterCount, bookId: input.bookId },
    })
    .returning();
  if (!batch) throw new Error('enqueuePilotExtend: 创建 batch 失败');

  const [job] = await db
    .insert(batchJobs)
    .values({
      batchId: batch.id,
      topicTitle: input.topicTitle,
      pitch: '（pilot 续写：复用已有 book 配置）',
      elementSlugs: [],
      status: 'pending',
      bookId: input.bookId,
    })
    .returning();
  if (!job) throw new Error('enqueuePilotExtend: 创建 batch_job 失败');

  const pgBossId = await boss.send(
    QUEUE_PILOT_EXTEND,
    {
      bookId: input.bookId,
      chapterCount,
      batchId: batch.id,
      batchJobId: job.id,
      ownerId: input.ownerId ?? null,
    } satisfies PilotExtendPayload,
    { retryLimit: 0, expireInSeconds: 3600 * 6 },
  );
  if (pgBossId) {
    await db.update(batchJobs).set({ pgBossJobId: pgBossId }).where(eq(batchJobs.id, job.id));
  }

  return { batchId: batch.id, batchJobId: job.id };
}

async function runPilotExtendJob(pgBossJobId: string, payload: PilotExtendPayload): Promise<void> {
  await db
    .update(batchJobs)
    .set({ status: 'running', pgBossJobId })
    .where(eq(batchJobs.id, payload.batchJobId));

  try {
    const r = await runPilotChapters({
      bookId: payload.bookId,
      chapterCount: payload.chapterCount,
      batchId: payload.batchId,
    });
    await db
      .update(batchJobs)
      .set({
        status: r.killed ? 'killed' : 'success',
        resultMeta: {
          chaptersWritten: r.written,
          killReason: r.killReason,
        },
      })
      .where(eq(batchJobs.id, payload.batchJobId));
    await db
      .update(batches)
      .set(
        r.killed
          ? { jobsKilled: sql`${batches.jobsKilled} + 1` }
          : { jobsCompleted: sql`${batches.jobsCompleted} + 1` },
      )
      .where(eq(batches.id, payload.batchId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(batchJobs)
      .set({ status: 'failure', errorMd: message })
      .where(eq(batchJobs.id, payload.batchJobId));
    await db
      .update(batches)
      .set({ jobsFailed: sql`${batches.jobsFailed} + 1` })
      .where(eq(batches.id, payload.batchId));
    throw err;
  } finally {
    await maybeFinalizeBatch(payload.batchId);
  }
}

async function maybeFinalizeBatch(batchId: string): Promise<void> {
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  if (!b) return;
  const finished = b.jobsCompleted + b.jobsKilled + b.jobsFailed;
  if (finished >= b.jobsTotal && b.status !== 'completed') {
    await db
      .update(batches)
      .set({ status: 'completed' })
      .where(eq(batches.id, batchId));
  }
}

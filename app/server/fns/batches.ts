import { createServerFn } from '@tanstack/react-start';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { batchJobs, batches } from '../db/schema/index.ts';
import { BatchInputSchema, enqueueBatch, enqueuePilotExtend } from '../services/orchestrator.ts';
import { requireBookOwner, requireUser } from '../auth/session.ts';
import { books } from '../db/schema/index.ts';
import { logAudit } from '../services/audit.ts';
import { assertBookNotBusy } from '../services/book-busy.ts';
import type { JsonObject } from './_serializable.ts';

interface SerializedBatch {
  id: string;
  name: string;
  status: string;
  concurrency: number;
  earlyKillBelowChars: number;
  jobsTotal: number;
  jobsCompleted: number;
  jobsKilled: number;
  jobsFailed: number;
  meta: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedBatchJob {
  id: string;
  batchId: string;
  status: string;
  topicTitle: string;
  pitch: string;
  elementSlugs: string[];
  bookId: string | null;
  rootRunId: string | null;
  pgBossJobId: string | null;
  errorMd: string | null;
  resultMeta: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

export const listBatchesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await db
    .select()
    .from(batches)
    .orderBy(desc(batches.createdAt))
    .limit(50);
  return rows as unknown as SerializedBatch[];
});

export const fetchBatchFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const [batch] = await db.select().from(batches).where(eq(batches.id, data.id));
    if (!batch) throw new Error('batch not found');
    const jobs = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.batchId, data.id))
      .orderBy(batchJobs.createdAt);
    return {
      batch: batch as unknown as SerializedBatch,
      jobs: jobs as unknown as SerializedBatchJob[],
    };
  });

export const enqueueBatchFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => BatchInputSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireUser();
    const r = await enqueueBatch({ ...data, ownerId: me.id });
    await logAudit({
      user: me,
      action: 'batches.enqueue',
      targetType: 'batch',
      targetId: r.batchId ?? null,
      summary: `提交批量任务`,
    });
    return r;
  });

/**
 * 在已有 book 上启动 pilot 续写：跑 N 章（≤20），每章打 chapter_snapshots。
 */
export const enqueuePilotForBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        chapterCount: z.number().int().min(1).max(20),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const [book] = await db
      .select({ title: books.title })
      .from(books)
      .where(eq(books.id, data.bookId));
    if (!book) throw new Error('book not found');
    const r = await enqueuePilotExtend({
      bookId: data.bookId,
      chapterCount: data.chapterCount,
      topicTitle: book.title,
      ownerId: me.id,
    });
    await logAudit({
      user: me,
      action: 'batches.pilot_enqueue',
      targetType: 'book',
      targetId: data.bookId,
      summary: `启动 pilot 续写 ${data.chapterCount} 章`,
      diff: { batchId: r.batchId },
    });
    return r;
  });

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { batchJobs, batches, books, runs } from '../db/schema/index.ts';
import {
  _isSweeperRunningForTests,
  startTimeoutSweeper,
  stopTimeoutSweeper,
  sweepStaleRuns,
} from './timeout-sweeper.ts';
import {
  _resetCancellationForTests,
  getCurrentSignal,
  withCancellation,
} from './cancellation.ts';

const createdRunIds: string[] = [];
const createdBookIds: string[] = [];
const createdBatchIds: string[] = [];
const createdBatchJobIds: string[] = [];

// dev DB 里可能有历史遗留的 running/pending 老行（之前 dev server 跑着跑着断了），
// 它们会污染全局 runsCancelled / batchJobsFailed 计数断言。先把它们标终态再跑测试。
beforeAll(async () => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  await db
    .update(runs)
    .set({ status: 'cancelled', finishedAt: new Date(), errorMd: '__sweeper-test pre-cleanup' })
    .where(
      and(
        inArray(runs.status, ['running', 'pending']),
        or(
          lt(runs.startedAt, cutoff),
          and(isNull(runs.startedAt), lt(runs.createdAt, cutoff)),
        ),
      ),
    );
  await db
    .update(batchJobs)
    .set({ status: 'failure', errorMd: '__sweeper-test pre-cleanup' })
    .where(
      and(
        inArray(batchJobs.status, ['running', 'pending']),
        lt(batchJobs.createdAt, cutoff),
      ),
    );
});

afterEach(async () => {
  if (createdRunIds.length) {
    await db.delete(runs).where(inArray(runs.id, createdRunIds));
    createdRunIds.length = 0;
  }
  if (createdBatchJobIds.length) {
    await db.delete(batchJobs).where(inArray(batchJobs.id, createdBatchJobIds));
    createdBatchJobIds.length = 0;
  }
  if (createdBatchIds.length) {
    await db.delete(batches).where(inArray(batches.id, createdBatchIds));
    createdBatchIds.length = 0;
  }
  if (createdBookIds.length) {
    await db.delete(books).where(inArray(books.id, createdBookIds));
    createdBookIds.length = 0;
  }
  stopTimeoutSweeper();
  _resetCancellationForTests();
});

async function newBook(status: 'planning' | 'writing' | 'paused' = 'writing'): Promise<string> {
  const [b] = await db
    .insert(books)
    .values({ title: '__sweeper-test', status })
    .returning({ id: books.id });
  createdBookIds.push(b!.id);
  return b!.id;
}

async function newRun(opts: {
  kind?: string;
  status: 'running' | 'pending' | 'success' | 'failure' | 'cancelled';
  parentId?: string;
  bookId?: string;
  startedAtMinAgo?: number;
  createdAtMinAgo?: number;
}): Promise<string> {
  const ago = (m?: number) => (m == null ? undefined : new Date(Date.now() - m * 60 * 1000));
  const [r] = await db
    .insert(runs)
    .values({
      kind: opts.kind ?? '__sweeper-test',
      status: opts.status,
      parentId: opts.parentId,
      bookId: opts.bookId,
      startedAt: ago(opts.startedAtMinAgo),
      createdAt: ago(opts.createdAtMinAgo) ?? new Date(),
    })
    .returning({ id: runs.id });
  createdRunIds.push(r!.id);
  return r!.id;
}

async function newBatchWithJob(jobOpts: {
  status: 'pending' | 'running' | 'success' | 'killed' | 'failure';
  createdAtMinAgo?: number;
  bookId?: string;
}): Promise<{ batchId: string; jobId: string }> {
  const [batch] = await db
    .insert(batches)
    .values({ name: '__sweeper-test', jobsTotal: 1 })
    .returning({ id: batches.id });
  createdBatchIds.push(batch!.id);
  const ago = jobOpts.createdAtMinAgo
    ? new Date(Date.now() - jobOpts.createdAtMinAgo * 60 * 1000)
    : new Date();
  const [job] = await db
    .insert(batchJobs)
    .values({
      batchId: batch!.id,
      status: jobOpts.status,
      topicTitle: 't',
      pitch: 'p',
      bookId: jobOpts.bookId,
      createdAt: ago,
    })
    .returning({ id: batchJobs.id });
  createdBatchJobIds.push(job!.id);
  return { batchId: batch!.id, jobId: job!.id };
}

describe('sweepStaleRuns', () => {
  it('cancels running runs whose started_at is older than the cutoff', async () => {
    const fresh = await newRun({ status: 'running', startedAtMinAgo: 5 });
    const stale = await newRun({ status: 'running', startedAtMinAgo: 45 });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.runsCancelled).toBe(1);
    expect(r.rootRunsCancelled).toBe(1);

    const [freshRow] = await db.select().from(runs).where(eq(runs.id, fresh));
    const [staleRow] = await db.select().from(runs).where(eq(runs.id, stale));
    expect(freshRow!.status).toBe('running');
    expect(staleRow!.status).toBe('cancelled');
    expect(staleRow!.finishedAt).toBeTruthy();
    expect(staleRow!.errorMd).toMatch(/30 分钟/);
  });

  it('falls back to created_at when started_at is null (pending runs)', async () => {
    const stalePending = await newRun({ status: 'pending', createdAtMinAgo: 60 });
    const freshPending = await newRun({ status: 'pending', createdAtMinAgo: 10 });

    await sweepStaleRuns({ timeoutMin: 30 });
    const [s] = await db.select().from(runs).where(eq(runs.id, stalePending));
    const [f] = await db.select().from(runs).where(eq(runs.id, freshPending));
    expect(s!.status).toBe('cancelled');
    expect(f!.status).toBe('pending');
  });

  it('also sweeps child runs (parent_id set)', async () => {
    const parent = await newRun({ status: 'running', startedAtMinAgo: 60 });
    const child = await newRun({
      status: 'running',
      startedAtMinAgo: 45,
      parentId: parent,
    });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.runsCancelled).toBe(2);
    expect(r.rootRunsCancelled).toBe(1);

    for (const id of [parent, child]) {
      const [row] = await db.select().from(runs).where(eq(runs.id, id));
      expect(row!.status).toBe('cancelled');
    }
  });

  it('pauses books linked to stale root runs (only when planning/writing)', async () => {
    const writingBook = await newBook('writing');
    const pausedBook = await newBook('paused');
    await newRun({ status: 'running', startedAtMinAgo: 60, bookId: writingBook });
    await newRun({ status: 'running', startedAtMinAgo: 60, bookId: pausedBook });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.booksPaused).toBe(1);
    const [w] = await db.select().from(books).where(eq(books.id, writingBook));
    const [p] = await db.select().from(books).where(eq(books.id, pausedBook));
    expect(w!.status).toBe('paused');
    expect(p!.status).toBe('paused');
  });

  it('does not pause book when only a child run is stale (root may still be alive)', async () => {
    const bookId = await newBook('writing');
    const root = await newRun({ status: 'running', startedAtMinAgo: 5, bookId });
    await newRun({
      status: 'running',
      startedAtMinAgo: 45,
      bookId,
      parentId: root,
    });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.booksPaused).toBe(0);
    const [b] = await db.select().from(books).where(eq(books.id, bookId));
    expect(b!.status).toBe('writing');
  });

  it('marks stale batch_jobs as failure and increments batches.jobsFailed', async () => {
    const { batchId, jobId } = await newBatchWithJob({
      status: 'running',
      createdAtMinAgo: 60,
    });
    const fresh = await newBatchWithJob({ status: 'running', createdAtMinAgo: 5 });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.batchJobsFailed).toBe(1);

    const [staleJob] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId));
    const [freshJob] = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.id, fresh.jobId));
    expect(staleJob!.status).toBe('failure');
    expect(staleJob!.errorMd).toMatch(/30 分钟/);
    expect(freshJob!.status).toBe('running');

    const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(batch!.jobsFailed).toBe(1);
  });

  it('also sweeps stale pending batch_jobs (worker died before pickup)', async () => {
    const { jobId } = await newBatchWithJob({
      status: 'pending',
      createdAtMinAgo: 60,
    });
    await sweepStaleRuns({ timeoutMin: 30 });
    const [j] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId));
    expect(j!.status).toBe('failure');
  });

  it('ignores already-terminal runs (success / failure / cancelled)', async () => {
    const ok = await newRun({ status: 'success', startedAtMinAgo: 60 });
    const fail = await newRun({ status: 'failure', startedAtMinAgo: 60 });
    const cancel = await newRun({ status: 'cancelled', startedAtMinAgo: 60 });

    const r = await sweepStaleRuns({ timeoutMin: 30 });
    expect(r.runsCancelled).toBe(0);
    for (const id of [ok, fail, cancel]) {
      const [row] = await db.select().from(runs).where(eq(runs.id, id));
      expect(['success', 'failure', 'cancelled']).toContain(row!.status);
    }
  });

  it('repeated sweeps are idempotent', async () => {
    await newRun({ status: 'running', startedAtMinAgo: 60 });
    const first = await sweepStaleRuns({ timeoutMin: 30 });
    const second = await sweepStaleRuns({ timeoutMin: 30 });
    expect(first.runsCancelled).toBe(1);
    expect(second.runsCancelled).toBe(0);
  });

  it('aborts in-process AbortController via requestCancel for stale root runs', async () => {
    // 模拟 worker 进程里持有 controller：用 withCancellation 把 root 注册进 ALS
    const [r] = await db
      .insert(runs)
      .values({
        kind: '__sweeper-test',
        status: 'running',
        startedAt: new Date(Date.now() - 45 * 60 * 1000),
      })
      .returning({ id: runs.id });
    createdRunIds.push(r!.id);

    let signal: AbortSignal | undefined;
    const work = withCancellation(r!.id, async () => {
      signal = getCurrentSignal();
      // 让外层 sweep 跑完再退出
      await new Promise<void>((resolve) => {
        signal!.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    // 等 ALS 注册完
    await Promise.resolve();

    const res = await sweepStaleRuns({ timeoutMin: 30 });
    expect(res.rootRunsAbortedInProcess).toBe(1);
    await work;
    expect(signal?.aborted).toBe(true);
  });
});

describe('startTimeoutSweeper / stopTimeoutSweeper', () => {
  it('starts and stops cleanly; double-start is a no-op', () => {
    expect(_isSweeperRunningForTests()).toBe(false);
    startTimeoutSweeper({ intervalMs: 60_000 });
    expect(_isSweeperRunningForTests()).toBe(true);
    startTimeoutSweeper({ intervalMs: 60_000 });
    expect(_isSweeperRunningForTests()).toBe(true);
    stopTimeoutSweeper();
    expect(_isSweeperRunningForTests()).toBe(false);
  });
});

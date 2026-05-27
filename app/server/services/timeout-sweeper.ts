import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { batchJobs, batches, books, runs } from '../db/schema/index.ts';
import { requestCancel } from './cancellation.ts';

export const DEFAULT_TIMEOUT_MIN = 30;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface SweepResult {
  runsCancelled: number;
  rootRunsCancelled: number;
  rootRunsAbortedInProcess: number;
  batchJobsFailed: number;
  booksPaused: number;
}

/**
 * 一次性扫描：把超时未完成的 runs / batch_jobs 标终态。
 * - runs：status ∈ {running, pending} 且 now - coalesce(started_at, created_at) > timeoutMin → cancelled
 *   - 子 run 也标（用户要求口径），父 run 在下一个 checkpoint 自然失败
 *   - 根 run 还会调 requestCancel(rootId) 尝试 abort 本进程内 in-flight LLM fetch
 *   - 根 run 关联的 book 若处于 planning/writing 则 → paused
 * - batch_jobs：status ∈ {running, pending} 且 created_at 老于 cutoff → failure，并累计 batches.jobs_failed
 * 多次重复调用安全：已是终态的行不会被再扫到。
 */
export async function sweepStaleRuns(opts: {
  now?: Date;
  timeoutMin?: number;
} = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const timeoutMin = opts.timeoutMin ?? DEFAULT_TIMEOUT_MIN;
  const cutoff = new Date(now.getTime() - timeoutMin * 60 * 1000);
  const errMd = `${timeoutMin} 分钟未完成，被超时清理任务标记`;

  const stale = await db
    .select({ id: runs.id, parentId: runs.parentId, bookId: runs.bookId })
    .from(runs)
    .where(
      and(
        inArray(runs.status, ['running', 'pending']),
        or(
          lt(runs.startedAt, cutoff),
          and(isNull(runs.startedAt), lt(runs.createdAt, cutoff)),
        ),
      ),
    );

  if (stale.length) {
    await db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: now, errorMd: errMd })
      .where(inArray(runs.id, stale.map((r) => r.id)));
  }

  const staleRoots = stale.filter((r) => !r.parentId);
  let rootRunsAbortedInProcess = 0;
  for (const r of staleRoots) {
    if (requestCancel(r.id)) rootRunsAbortedInProcess += 1;
  }

  const rootBookIds = Array.from(
    new Set(staleRoots.map((r) => r.bookId).filter((x): x is string => !!x)),
  );
  let booksPaused = 0;
  if (rootBookIds.length) {
    const updated = await db
      .update(books)
      .set({ status: 'paused' })
      .where(
        and(
          inArray(books.id, rootBookIds),
          inArray(books.status, ['planning', 'writing']),
        ),
      )
      .returning({ id: books.id });
    booksPaused = updated.length;
  }

  const staleJobs = await db
    .select({ id: batchJobs.id, batchId: batchJobs.batchId })
    .from(batchJobs)
    .where(
      and(
        inArray(batchJobs.status, ['running', 'pending']),
        lt(batchJobs.createdAt, cutoff),
      ),
    );
  if (staleJobs.length) {
    await db
      .update(batchJobs)
      .set({ status: 'failure', errorMd: errMd })
      .where(inArray(batchJobs.id, staleJobs.map((j) => j.id)));

    const counts = new Map<string, number>();
    for (const j of staleJobs) counts.set(j.batchId, (counts.get(j.batchId) ?? 0) + 1);
    for (const [batchId, n] of counts) {
      await db
        .update(batches)
        .set({ jobsFailed: sql`${batches.jobsFailed} + ${n}` })
        .where(eq(batches.id, batchId));
    }
  }

  return {
    runsCancelled: stale.length,
    rootRunsCancelled: staleRoots.length,
    rootRunsAbortedInProcess,
    batchJobsFailed: staleJobs.length,
    booksPaused,
  };
}

let sweeperHandle: NodeJS.Timeout | undefined;

export function startTimeoutSweeper(opts: {
  intervalMs?: number;
  timeoutMin?: number;
} = {}): void {
  if (sweeperHandle) return;
  const intervalMs = opts.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const timeoutMin = opts.timeoutMin ?? DEFAULT_TIMEOUT_MIN;
  sweeperHandle = setInterval(() => {
    void sweepStaleRuns({ timeoutMin })
      .then((r) => {
        if (r.runsCancelled || r.batchJobsFailed) {
          console.log(
            `[timeout-sweeper] cleaned: runs=${r.runsCancelled} (root=${r.rootRunsCancelled}, aborted-in-process=${r.rootRunsAbortedInProcess}) batch_jobs=${r.batchJobsFailed} books_paused=${r.booksPaused}`,
          );
        }
      })
      .catch((err) => {
        console.error('[timeout-sweeper] sweep failed', err);
      });
  }, intervalMs);
  // 不让定时器阻塞进程退出（dev 重启 / Ctrl+C）
  if (typeof sweeperHandle.unref === 'function') sweeperHandle.unref();
  console.log(
    `[timeout-sweeper] started: interval=${intervalMs}ms timeout=${timeoutMin}min`,
  );
}

export function stopTimeoutSweeper(): void {
  if (!sweeperHandle) return;
  clearInterval(sweeperHandle);
  sweeperHandle = undefined;
}

export function _isSweeperRunningForTests(): boolean {
  return sweeperHandle !== undefined;
}

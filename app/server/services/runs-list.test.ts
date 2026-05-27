import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { runs } from '../db/schema/index.ts';
import { listRuns } from './runs-list.ts';

const createdRunIds: string[] = [];

afterEach(async () => {
  if (createdRunIds.length === 0) return;
  await db.delete(runs).where(inArray(runs.id, createdRunIds));
  createdRunIds.length = 0;
});

async function insertRun(
  kind: string,
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled',
) {
  const [r] = await db.insert(runs).values({ kind, status }).returning({ id: runs.id });
  createdRunIds.push(r!.id);
  return r!.id;
}

describe('listRuns status filter & ordering', () => {
  it('floats running rows to the top by default, even when newer non-running rows exist', async () => {
    const oldRunningId = await insertRun('__listruns-test', 'running');
    // 后插入的 success 比 running 更新；没有过滤时，running 仍应排在前面
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newSuccessId = await insertRun('__listruns-test', 'success');

    const res = await listRuns({ rootsOnly: true, limit: 200, offset: 0 });
    const ids = res.rows.map((r) => r.id);
    const runningIdx = ids.indexOf(oldRunningId);
    const successIdx = ids.indexOf(newSuccessId);
    expect(runningIdx).toBeGreaterThanOrEqual(0);
    expect(successIdx).toBeGreaterThanOrEqual(0);
    expect(runningIdx).toBeLessThan(successIdx);
  });

  it('filters to only the requested status', async () => {
    const runningId = await insertRun('__listruns-test', 'running');
    const successId = await insertRun('__listruns-test', 'success');
    const failureId = await insertRun('__listruns-test', 'failure');

    const res = await listRuns({ rootsOnly: true, status: 'success', limit: 200, offset: 0 });
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(successId);
    expect(ids).not.toContain(runningId);
    expect(ids).not.toContain(failureId);
    // 只保留过滤后的状态
    for (const row of res.rows) {
      expect(row.status).toBe('success');
    }
  });
});

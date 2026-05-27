import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { batchJobs, batches, books, gateRequests, runs } from '../db/schema/index.ts';
import { loadBookBusyState } from './book-busy.ts';

const createdBookIds: string[] = [];
const createdBatchIds: string[] = [];

afterEach(async () => {
  if (createdBookIds.length) {
    // batch_jobs / runs / gate_requests 都没有 FK 到 books 的反向级联以外的依赖，
    // 显式按子→父顺序清，避免 FK 冲突（gate_requests.book_id 走级联，runs/batch_jobs 是裸 uuid）
    await db.delete(gateRequests).where(inArray(gateRequests.bookId, createdBookIds));
    await db.delete(runs).where(inArray(runs.bookId, createdBookIds));
    await db.delete(batchJobs).where(inArray(batchJobs.bookId, createdBookIds));
    await db.delete(books).where(inArray(books.id, createdBookIds));
    createdBookIds.length = 0;
  }
  if (createdBatchIds.length) {
    await db.delete(batches).where(inArray(batches.id, createdBatchIds));
    createdBatchIds.length = 0;
  }
});

async function newBook(): Promise<string> {
  const [b] = await db.insert(books).values({ title: '__busy-test' }).returning({ id: books.id });
  createdBookIds.push(b!.id);
  return b!.id;
}

describe('loadBookBusyState', () => {
  it('reports idle when no runs exist', async () => {
    const bookId = await newBook();
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(false);
    expect(s.brainstorm).toBe(false);
    expect(s.design).toBe(false);
    expect(s.pendingBatchJobs).toBe(0);
  });

  it('classifies a running write-next-chapter root run as writing', async () => {
    const bookId = await newBook();
    await db.insert(runs).values({ kind: 'write-next-chapter', status: 'running', bookId });
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(true);
    expect(s.brainstorm).toBe(false);
    expect(s.design).toBe(false);
    expect(s.activeKinds.writing).toEqual(['write-next-chapter']);
  });

  it('classifies brainstorm-harness as brainstorm', async () => {
    const bookId = await newBook();
    await db.insert(runs).values({ kind: 'brainstorm-harness', status: 'pending', bookId });
    const s = await loadBookBusyState(bookId);
    expect(s.brainstorm).toBe(true);
    expect(s.writing).toBe(false);
  });

  it('classifies design-book as design', async () => {
    const bookId = await newBook();
    await db.insert(runs).values({ kind: 'design-book', status: 'running', bookId });
    const s = await loadBookBusyState(bookId);
    expect(s.design).toBe(true);
    expect(s.writing).toBe(false);
  });

  it('ignores child runs (parent_id set)', async () => {
    const bookId = await newBook();
    const [parent] = await db
      .insert(runs)
      .values({ kind: 'something-else', status: 'success', bookId })
      .returning({ id: runs.id });
    await db.insert(runs).values({
      kind: 'write-next-chapter',
      status: 'running',
      bookId,
      parentId: parent!.id,
    });
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(false);
  });

  it('ignores maintenance kinds (arc-summarizer / book-summarizer / living-doc-updater)', async () => {
    const bookId = await newBook();
    await db.insert(runs).values([
      { kind: 'arc-summarizer', status: 'running', bookId },
      { kind: 'book-summarizer', status: 'pending', bookId },
      { kind: 'living-doc-updater', status: 'running', bookId },
    ]);
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(false);
    expect(s.brainstorm).toBe(false);
    expect(s.design).toBe(false);
  });

  it('ignores finished runs (success / failure / cancelled)', async () => {
    const bookId = await newBook();
    await db.insert(runs).values([
      { kind: 'write-next-chapter', status: 'success', bookId },
      { kind: 'design-book', status: 'failure', bookId },
      { kind: 'brainstorm-harness', status: 'cancelled', bookId },
    ]);
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(false);
    expect(s.brainstorm).toBe(false);
    expect(s.design).toBe(false);
  });

  it('counts pending batch_jobs as writing busy', async () => {
    const bookId = await newBook();
    const [batch] = await db
      .insert(batches)
      .values({ name: '__busy-test-batch', jobsTotal: 1 })
      .returning({ id: batches.id });
    createdBatchIds.push(batch!.id);
    await db.insert(batchJobs).values({
      batchId: batch!.id,
      bookId,
      status: 'pending',
      topicTitle: 't',
      pitch: 'p',
    });
    const s = await loadBookBusyState(bookId);
    expect(s.writing).toBe(true);
    expect(s.pendingBatchJobs).toBe(1);
  });

  it('does not leak busy state across books', async () => {
    const a = await newBook();
    const b = await newBook();
    await db.insert(runs).values({ kind: 'write-next-chapter', status: 'running', bookId: a });
    expect((await loadBookBusyState(a)).writing).toBe(true);
    expect((await loadBookBusyState(b)).writing).toBe(false);
  });

  it('reports awaitingGate (FIFO) when a pending gate exists', async () => {
    const bookId = await newBook();
    expect((await loadBookBusyState(bookId)).awaitingGate).toBeNull();

    const [g1] = await db
      .insert(gateRequests)
      .values({ bookId, kind: 'gate-1', noteMd: '等设计确认' })
      .returning({ id: gateRequests.id });
    // 老一点的 gate 先到，新一点的 gate-2 后来——FIFO 应该返回 gate-1
    await new Promise((r) => setTimeout(r, 5));
    await db
      .insert(gateRequests)
      .values({ bookId, kind: 'gate-2', noteMd: '更晚的卷确认' });

    const s = await loadBookBusyState(bookId);
    expect(s.awaitingGate).toEqual({ gateId: g1!.id, kind: 'gate-1' });
  });

  it('ignores resolved gates (approved / rejected / cancelled)', async () => {
    const bookId = await newBook();
    await db.insert(gateRequests).values([
      { bookId, kind: 'gate-1', status: 'approved', noteMd: '' },
      { bookId, kind: 'gate-2', status: 'rejected', noteMd: '' },
      { bookId, kind: 'gate-3', status: 'cancelled', noteMd: '' },
    ]);
    const s = await loadBookBusyState(bookId);
    expect(s.awaitingGate).toBeNull();
  });
});

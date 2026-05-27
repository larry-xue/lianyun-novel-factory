import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, gateRequests } from '../db/schema/index.ts';
import {
  approveGate,
  createGateRequest,
  getGateById,
  listAllForBook,
  listPendingForBook,
  rejectGate,
} from './gates.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__gates-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

describe('gates service', () => {
  it('createGateRequest creates pending gate with payload + noteMd', async () => {
    const g = await createGateRequest({
      bookId,
      kind: 'gate-1',
      noteMd: '立项 gate 测试',
      payload: { chapterCount: 20 },
    });
    expect(g.kind).toBe('gate-1');
    expect(g.status).toBe('pending');
    expect((g.payload as { chapterCount: number }).chapterCount).toBe(20);
  });

  it('listPendingForBook excludes resolved gates', async () => {
    const g1 = await createGateRequest({ bookId, kind: 'gate-2', noteMd: 'pending one' });
    const g2 = await createGateRequest({ bookId, kind: 'gate-2', noteMd: 'will approve' });
    await approveGate({ gateId: g2.id });

    const pending = await listPendingForBook(bookId);
    const ids = pending.map((g) => g.id);
    expect(ids).toContain(g1.id);
    expect(ids).not.toContain(g2.id);
  });

  it('approveGate sets status + resolvedAt; rejects double-approve', async () => {
    const g = await createGateRequest({ bookId, kind: 'gate-3', noteMd: '单章 gate' });
    const approved = await approveGate({ gateId: g.id, resolvedNoteMd: '看着不错' });
    expect(approved.status).toBe('approved');
    expect(approved.resolvedAt).not.toBeNull();
    expect(approved.resolvedNoteMd).toBe('看着不错');

    await expect(approveGate({ gateId: g.id })).rejects.toThrow();
  });

  it('rejectGate sets status to rejected', async () => {
    const g = await createGateRequest({ bookId, kind: 'gate-3', noteMd: '会被拒' });
    const rejected = await rejectGate({ gateId: g.id, resolvedNoteMd: '风格漂了' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.resolvedNoteMd).toBe('风格漂了');
  });

  it('listAllForBook returns all gates regardless of status', async () => {
    const all = await listAllForBook(bookId);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const statuses = new Set(all.map((g) => g.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('cascades: deleting book removes gates', async () => {
    const [b] = await db
      .insert(books)
      .values({ title: `__gates-cascade-${Date.now()}` })
      .returning();
    await createGateRequest({ bookId: b!.id, kind: 'gate-1', noteMd: 'will cascade' });
    await db.delete(books).where(eq(books.id, b!.id));
    const remaining = await db
      .select()
      .from(gateRequests)
      .where(eq(gateRequests.bookId, b!.id));
    expect(remaining).toHaveLength(0);
  });

  it('getGateById returns null when not found', async () => {
    const g = await getGateById('00000000-0000-0000-0000-000000000000');
    expect(g).toBeNull();
  });
});

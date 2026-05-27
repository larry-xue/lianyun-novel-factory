import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { gateRequests, type GateRequest } from '../db/schema/index.ts';

/**
 * gate 暂停业务层。S8。
 *
 * pg-boss 任务卡到这里：创建一行 gate_requests(status='pending')，return；
 * UI 轮询 list → 看到 pending → 用户点 approve → 触发 resume 函数。
 */

export type GateKind = 'gate-1' | 'gate-2' | 'gate-3';

export async function createGateRequest(input: {
  bookId: string;
  kind: GateKind;
  payload?: Record<string, unknown>;
  noteMd?: string;
  triggeredByRunId?: string;
}): Promise<GateRequest> {
  const [row] = await db
    .insert(gateRequests)
    .values({
      bookId: input.bookId,
      kind: input.kind,
      status: 'pending',
      payload: input.payload ?? {},
      noteMd: input.noteMd ?? '',
      triggeredByRunId: input.triggeredByRunId,
    })
    .returning();
  return row!;
}

export async function listPendingForBook(bookId: string): Promise<GateRequest[]> {
  return await db
    .select()
    .from(gateRequests)
    .where(and(eq(gateRequests.bookId, bookId), eq(gateRequests.status, 'pending')))
    .orderBy(asc(gateRequests.createdAt));
}

export async function listAllForBook(bookId: string): Promise<GateRequest[]> {
  return await db
    .select()
    .from(gateRequests)
    .where(eq(gateRequests.bookId, bookId))
    .orderBy(asc(gateRequests.createdAt));
}

export async function approveGate(input: {
  gateId: string;
  resolvedNoteMd?: string;
}): Promise<GateRequest> {
  const [row] = await db
    .update(gateRequests)
    .set({
      status: 'approved',
      resolvedAt: new Date(),
      resolvedNoteMd: input.resolvedNoteMd ?? '',
    })
    .where(and(eq(gateRequests.id, input.gateId), eq(gateRequests.status, 'pending')))
    .returning();
  if (!row) throw new Error(`approveGate: ${input.gateId} 不在 pending 状态`);
  return row;
}

export async function rejectGate(input: {
  gateId: string;
  resolvedNoteMd?: string;
}): Promise<GateRequest> {
  const [row] = await db
    .update(gateRequests)
    .set({
      status: 'rejected',
      resolvedAt: new Date(),
      resolvedNoteMd: input.resolvedNoteMd ?? '',
    })
    .where(and(eq(gateRequests.id, input.gateId), eq(gateRequests.status, 'pending')))
    .returning();
  if (!row) throw new Error(`rejectGate: ${input.gateId} 不在 pending 状态`);
  return row;
}

export async function getGateById(gateId: string): Promise<GateRequest | null> {
  const [row] = await db.select().from(gateRequests).where(eq(gateRequests.id, gateId)).limit(1);
  return row ?? null;
}

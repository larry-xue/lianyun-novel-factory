import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  approveGate,
  getGateById,
  listAllForBook,
  listPendingForBook,
  rejectGate,
} from '../services/gates.ts';
import { resumeAfterGate1 } from '../services/book-producer.ts';
import { requireBookOwner } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import type { JsonObject } from './_serializable.ts';

export const listGatesForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const all = await listAllForBook(data.bookId);
    return all.map((g) => ({
      id: g.id,
      bookId: g.bookId,
      kind: g.kind,
      status: g.status,
      noteMd: g.noteMd,
      payload: g.payload as JsonObject,
      resolvedAt: g.resolvedAt,
      resolvedNoteMd: g.resolvedNoteMd,
      createdAt: g.createdAt,
    })) as Array<{
      id: string;
      bookId: string;
      kind: 'gate-1' | 'gate-2' | 'gate-3';
      status: 'pending' | 'approved' | 'rejected' | 'cancelled';
      noteMd: string;
      payload: JsonObject;
      resolvedAt: Date | null;
      resolvedNoteMd: string;
      createdAt: Date;
    }>;
  });

export const listPendingGatesFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const rows = await listPendingForBook(data.bookId);
    return rows.map((g) => ({
      id: g.id,
      bookId: g.bookId,
      kind: g.kind,
      status: g.status,
      noteMd: g.noteMd,
      payload: g.payload as JsonObject,
      createdAt: g.createdAt,
    }));
  });

/**
 * 通用 approve：对所有 gate kind 都标 approved；如果是 gate-1 自动 trigger resumeAfterGate1。
 * resumeAfterGate1 是长任务（要跑章节循环），UI fire-and-forget，UI 自己轮询 chapters 表看进度。
 */
export const approveGateFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        gateId: z.string().uuid(),
        resolvedNoteMd: z.string().max(400).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const gate = await getGateById(data.gateId);
    if (!gate) throw new Error(`approveGate: gate ${data.gateId} 不存在`);
    const me = await requireBookOwner(gate.bookId);
    await approveGate(data);
    await logAudit({
      user: me,
      action: 'gates.approve',
      targetType: 'gate',
      targetId: data.gateId,
      summary: `通过 ${gate.kind}`,
    });

    if (gate.kind === 'gate-1') {
      // 异步 fire-and-forget：UI 立刻收到 ok，章节循环在后台跑
      resumeAfterGate1(gate.bookId).catch((e) => {
        console.warn(
          `[approveGateFn] resumeAfterGate1(book=${gate.bookId}) 失败：${
            e instanceof Error ? e.message : e
          }`,
        );
      });
    }
    return { ok: true, kind: gate.kind };
  });

export const rejectGateFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        gateId: z.string().uuid(),
        resolvedNoteMd: z.string().max(400).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const gate = await getGateById(data.gateId);
    if (!gate) throw new Error(`rejectGate: gate ${data.gateId} 不存在`);
    const me = await requireBookOwner(gate.bookId);
    await rejectGate(data);
    await logAudit({
      user: me,
      action: 'gates.reject',
      targetType: 'gate',
      targetId: data.gateId,
      summary: `驳回 ${gate.kind}`,
    });
    return { ok: true };
  });

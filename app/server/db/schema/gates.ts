import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

/**
 * gate 三档：
 * - gate-1: 立项后，outline + 角色 + 世界规则就绪 → 等人确认开始写作
 * - gate-2: 进入新卷前 → 等人确认本卷规划
 * - gate-3: 单章生成后 → 等人确认入库（默认开但 fully-auto 跳过）
 */
export const gateKindEnum = pgEnum('gate_kind', ['gate-1', 'gate-2', 'gate-3']);

export const gateStatusEnum = pgEnum('gate_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);

/**
 * 暂停的 gate 请求。pg-boss 任务挂起到这一行被 approve 才继续。
 * UI 通过 server-fn polling 这个表（每 3-5s）。
 */
export const gateRequests = pgTable('gate_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  kind: gateKindEnum('kind').notNull(),
  status: gateStatusEnum('status').notNull().default('pending'),
  /** 比如 gate-2 携带 volumeIdx；gate-3 携带 chapterIdx */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  /** 给 UI 显示的人类可读说明 */
  noteMd: text('note_md').notNull().default(''),
  /** 关联触发它的 run（哪轮 produce 卡在这里） */
  triggeredByRunId: uuid('triggered_by_run_id'),
  /** approved/rejected 后填谁批的 + 备注 */
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedNoteMd: text('resolved_note_md').notNull().default(''),
  ...timestamps,
});

export type GateRequest = typeof gateRequests.$inferSelect;
export type GateRequestInsert = typeof gateRequests.$inferInsert;

import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { getRequestIP } from '@tanstack/react-start/server';
import { db } from '../db/client.ts';
import { auditLogs } from '../db/schema/index.ts';
import type { CurrentUser } from '../auth/session.ts';

export interface LogAuditInput {
  user: CurrentUser | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  summary?: string;
  diff?: Record<string, unknown>;
}

/**
 * 写一条审计日志。失败不抛（审计写不进去不应阻断业务）。
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch {
      // 脚本调用 / 非请求上下文：忽略
    }
    await db.insert(auditLogs).values({
      userId: input.user?.id ?? null,
      username: input.user?.username ?? '',
      action: input.action,
      targetType: input.targetType ?? '',
      targetId: input.targetId ?? null,
      summary: input.summary ?? '',
      diff: input.diff ?? {},
      ip,
    });
  } catch (e) {
    console.warn('[audit] failed to write log:', e instanceof Error ? e.message : e);
  }
}

/**
 * 比较前后两个对象，返回只含差异字段的 { before, after } diff。
 * 超过 max 字段时截断（避免存巨型 jsonb）。
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  opts: { keys?: (keyof T)[]; max?: number } = {},
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const max = opts.max ?? 30;
  const keys = (opts.keys ?? (Object.keys(after) as (keyof T)[])).slice(0, max);
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const bv = before[k];
    const av = after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k as string] = bv;
      a[k as string] = av;
    }
  }
  return { before: b, after: a };
}

export interface AuditQuery {
  userId?: string;
  /** 子串匹配（ILIKE %x%），不区分大小写。用于在前端按动作前缀/关键字筛选 */
  actionLike?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(q: AuditQuery = {}) {
  const conditions = [];
  if (q.userId) conditions.push(eq(auditLogs.userId, q.userId));
  if (q.actionLike) conditions.push(ilike(auditLogs.action, `%${q.actionLike}%`));
  if (q.targetType) conditions.push(eq(auditLogs.targetType, q.targetType));

  const where = conditions.length === 1 ? conditions[0] : conditions.length > 1 ? and(...conditions) : undefined;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);

  const [rows, totalRow] = await Promise.all([
    where
      ? db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset)
      : db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
    where
      ? db.select({ c: sql<number>`count(*)::int` }).from(auditLogs).where(where)
      : db.select({ c: sql<number>`count(*)::int` }).from(auditLogs),
  ]);

  return { rows, total: totalRow[0]?.c ?? 0 };
}

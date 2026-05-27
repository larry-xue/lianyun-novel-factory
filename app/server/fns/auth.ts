import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { users } from '../db/schema/index.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import {
  createSession,
  destroyCurrentSession,
  getCurrentUser,
  requireAdmin,
  requireUser,
  type CurrentUser,
} from '../auth/session.ts';
import { listAuditLogs, logAudit } from '../services/audit.ts';

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const loginFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => LoginSchema.parse(raw))
  .handler(async ({ data }) => {
    const [u] = await db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
        role: users.role,
      })
      .from(users)
      .where(eq(users.username, data.username))
      .limit(1);

    if (!u) {
      throw new Error('账号或密码错误');
    }
    const ok = await verifyPassword(data.password, u.passwordHash);
    if (!ok) {
      await logAudit({
        user: null,
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: u.id,
        summary: `账号 ${u.username} 登录失败（密码错误）`,
      });
      throw new Error('账号或密码错误');
    }
    await createSession(u.id);
    const me: CurrentUser = {
      id: u.id,
      username: u.username,
      role: u.role,
      sessionId: '',
    };
    await logAudit({
      user: me,
      action: 'auth.login',
      targetType: 'user',
      targetId: u.id,
      summary: `${u.username} 登录`,
    });
    return { id: u.id, username: u.username, role: u.role };
  });

export const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const me = await getCurrentUser();
  await destroyCurrentSession();
  if (me) {
    await logAudit({
      user: me,
      action: 'auth.logout',
      targetType: 'user',
      targetId: me.id,
      summary: `${me.username} 登出`,
    });
  }
  return { ok: true };
});

export const fetchMeFn = createServerFn({ method: 'GET' }).handler(async () => {
  const me = await getCurrentUser();
  if (!me) return null;
  return { id: me.id, username: me.username, role: me.role };
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6).max(200),
});

export const changePasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => ChangePasswordSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireUser();
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!row) throw new Error('用户不存在');
    const ok = await verifyPassword(data.oldPassword, row.passwordHash);
    if (!ok) throw new Error('原密码错误');
    const hash = await hashPassword(data.newPassword);
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, me.id));
    await logAudit({
      user: me,
      action: 'users.change_password',
      targetType: 'user',
      targetId: me.id,
      summary: `${me.username} 修改密码`,
    });
    return { ok: true };
  });

export const listUsersFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin();
  return await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);
});

const AuditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  actionLike: z.string().min(1).max(80).optional(),
  targetType: z.string().min(1).max(40).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export interface AuditLogView {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  /** JSON-serialized diff (server stores jsonb; we stringify for transport safety) */
  diffJson: string;
  ip: string | null;
  createdAt: Date;
}

export const fetchAuditLogsFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => AuditQuerySchema.parse(raw ?? {}))
  .handler(async ({ data }): Promise<{ total: number; rows: AuditLogView[] }> => {
    await requireAdmin();
    const { rows, total } = await listAuditLogs(data);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        username: r.username,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: r.summary,
        diffJson: JSON.stringify(r.diff ?? {}),
        ip: r.ip,
        createdAt: r.createdAt,
      })),
    };
  });

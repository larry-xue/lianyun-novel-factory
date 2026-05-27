import { and, eq, gt } from 'drizzle-orm';
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server';
import { db } from '../db/client.ts';
import { sessions, users } from '../db/schema/index.ts';

export const SESSION_COOKIE = 'fq_session';
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
/** 还剩 < 7 天才滑动续期，避免每次请求都 update */
const RENEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface CurrentUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  sessionId: string;
}

function clientIp(): string | undefined {
  try {
    return getRequestIP({ xForwardedFor: true });
  } catch {
    return undefined;
  }
}

function clientUa(): string | undefined {
  try {
    return getRequestHeader('user-agent');
  } catch {
    return undefined;
  }
}

function setSessionCookie(sessionId: string) {
  setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      expiresAt,
      ip: clientIp() ?? null,
      userAgent: clientUa()?.slice(0, 500) ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('failed to create session');
  setSessionCookie(row.id);
  return row.id;
}

export async function destroyCurrentSession(): Promise<void> {
  const sid = getCookie(SESSION_COOKIE);
  if (sid) {
    await db.delete(sessions).where(eq(sessions.id, sid));
  }
  deleteCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * 读取当前用户。无 session / 已过期 / 用户已删 → null。
 * 命中且剩余 < 7 天会顺手续期。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sid = getCookie(SESSION_COOKIE);
  if (!sid) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      username: users.username,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) {
    deleteCookie(SESSION_COOKIE, { path: '/' });
    return null;
  }

  const remaining = row.expiresAt.getTime() - Date.now();
  if (remaining < RENEW_THRESHOLD_MS) {
    const newExp = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt: newExp }).where(eq(sessions.id, row.sessionId));
    setSessionCookie(row.sessionId);
  }

  return {
    id: row.userId,
    username: row.username,
    role: row.role,
    sessionId: row.sessionId,
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError('未登录', 401);
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new AuthError('需要管理员权限', 403);
  return u;
}

/**
 * 书的所有者或 admin 才能继续。owner_id 为 NULL 的历史书只允许 admin。
 */
export async function requireBookOwner(bookId: string): Promise<CurrentUser> {
  const u = await requireUser();
  const { books } = await import('../db/schema/index.ts');
  const [row] = await db
    .select({ ownerId: books.ownerId })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (!row) throw new AuthError('书不存在', 404);
  if (u.role === 'admin') return u;
  if (!row.ownerId) throw new AuthError('该书归系统所有，仅管理员可操作', 403);
  if (row.ownerId !== u.id) throw new AuthError('只能操作自己创建的书', 403);
  return u;
}

import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';

export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);

/**
 * 平台用户。无注册流程，账号由脚本 `pnpm tsx scripts/create-user.ts` 创建。
 * password_hash = bcrypt(plaintext)
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('user'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_username_key').on(t.username)],
);

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

/**
 * 服务端 session：cookie 里只放 session id (uuid)，DB 里查 user / 校期。
 * 改密 / 显式登出可立即吊销。30 天滑动窗口由 server fn 续期。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;

/**
 * 审计日志。哪个用户、对什么对象、做了什么、改了什么字段。
 * action 用 dot-separated 命名（books.delete / settings.llm.update / users.create 等）。
 * target_type + target_id 唯一定位被改对象；target_id 可为空（全局动作如登录）。
 * diff 存改动前后或自由结构（小心不要存敏感字段如 password_hash）。
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').notNull().default(''),
    action: text('action').notNull(),
    targetType: text('target_type').notNull().default(''),
    targetId: text('target_id'),
    summary: text('summary').notNull().default(''),
    diff: jsonb('diff').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_user_idx').on(t.userId),
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type AuditLogInsert = typeof auditLogs.$inferInsert;

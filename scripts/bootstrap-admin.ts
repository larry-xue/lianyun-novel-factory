/**
 * 一次性 bootstrap：
 * 1. 如果还没有 admin 用户，新建一个 username=admin 的 admin，强随机密码（打印到控制台）。
 * 2. 把所有 owner_id 为 NULL 的 books 归属到（最早的）admin 用户。
 *
 * 重复运行幂等：admin 已存在时不动密码，仅做 backfill。
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import { books, users } from '../app/server/db/schema/index.ts';
import { hashPassword } from '../app/server/auth/password.ts';

/** 24 字节 → 32 字符 base64url：高熵随机密码，可直接复制粘贴。 */
function strongPassword(): string {
  return randomBytes(24).toString('base64url');
}

async function main() {
  // 找现有 admin（取创建最早的一个，避免每次切目标）
  const existingAdmins = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.createdAt);

  let adminId: string;
  let adminUsername: string;
  let createdNew = false;
  let plaintextPassword: string | null = null;

  if (existingAdmins.length > 0) {
    adminId = existingAdmins[0]!.id;
    adminUsername = existingAdmins[0]!.username;
    console.log(`✓ 已有 admin 用户: ${adminUsername} (id=${adminId})`);
  } else {
    plaintextPassword = strongPassword();
    const hash = await hashPassword(plaintextPassword);
    const [row] = await db
      .insert(users)
      .values({ username: 'admin', passwordHash: hash, role: 'admin' })
      .returning({ id: users.id, username: users.username });
    if (!row) throw new Error('创建 admin 失败');
    adminId = row.id;
    adminUsername = row.username;
    createdNew = true;
  }

  // 回填：所有 owner_id IS NULL 的 books 归到 adminId
  const backfillResult = await db
    .update(books)
    .set({ ownerId: adminId })
    .where(isNull(books.ownerId))
    .returning({ id: books.id });

  const totalRows = (await db
    .select({ totalBooks: sql<number>`count(*)::int` })
    .from(books)) as Array<{ totalBooks: number }>;
  const totalBooks = totalRows[0]?.totalBooks ?? 0;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  bootstrap-admin 完成');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  admin 用户  : ${adminUsername} (id=${adminId})`);
  console.log(`  归属书籍    : ${backfillResult.length} 本（共 ${totalBooks} 本）`);
  if (createdNew) {
    console.log('');
    console.log('  ⚠ 新建 admin 账号，请立即记录密码（仅此一次显示）：');
    console.log('');
    console.log(`     用户名: admin`);
    console.log(`     密码  : ${plaintextPassword}`);
    console.log('');
    console.log('  登录后建议在 /settings 旁的修改密码入口换成你自己的密码。');
  }
  console.log('═══════════════════════════════════════════════════════');

  process.exit(0);
}

main().catch((e) => {
  console.error('bootstrap-admin 失败:', e);
  process.exit(1);
});

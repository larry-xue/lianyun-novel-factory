/**
 * 新增账号。
 *
 *   pnpm tsx scripts/create-user.ts <username> <password> [--role admin|user]
 *
 * 没有交互式 prompt：参数都从 argv 拿，方便脚本化。
 * 同名用户会被拒绝（users.username 唯一约束）。
 */
import 'dotenv/config';
import { db } from '../app/server/db/client.ts';
import { users } from '../app/server/db/schema/index.ts';
import { hashPassword } from '../app/server/auth/password.ts';

function usage(): never {
  console.error('用法: pnpm tsx scripts/create-user.ts <username> <password> [--role admin|user]');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const [username, password, ...rest] = args;
  if (!username || !password) usage();

  let role: 'admin' | 'user' = 'user';
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--role') {
      const v = rest[i + 1];
      if (v !== 'admin' && v !== 'user') {
        console.error(`非法 --role 值：${v}（仅 admin / user）`);
        process.exit(1);
      }
      role = v;
      i++;
    }
  }

  if (username.length < 1 || username.length > 80) {
    console.error('username 长度需 1-80');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('password 长度至少 6 个字符');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  try {
    const [row] = await db
      .insert(users)
      .values({ username, passwordHash: hash, role })
      .returning({ id: users.id, username: users.username, role: users.role });
    console.log('✓ 创建成功:', row);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      console.error(`✗ 用户名 ${username} 已存在`);
      process.exit(2);
    }
    throw e;
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('脚本失败:', e);
  process.exit(1);
});

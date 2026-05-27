import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < 6) {
    throw new Error('密码至少 6 个字符');
  }
  return bcrypt.hash(plaintext, ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

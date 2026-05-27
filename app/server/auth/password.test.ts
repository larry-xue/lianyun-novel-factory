import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

describe('password', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2-strong');
    expect(hash).not.toBe('hunter2-strong');
    expect(await verifyPassword('hunter2-strong', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('hunter2-strong');
    expect(await verifyPassword('hunter3', hash)).toBe(false);
  });

  it('rejects too-short password', async () => {
    await expect(hashPassword('abc')).rejects.toThrow();
  });
});

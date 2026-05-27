import { describe, expect, it } from 'vitest';
import { HookEnhanceResultSchema, hookSmith } from './hook-smith.ts';

describe('hook-smith agent', () => {
  it('exposes a Mastra agent with id, name', () => {
    expect(hookSmith.id).toBe('hook-smith');
    expect(hookSmith.name).toBe('Hook 锻造');
  });

  it('HookEnhanceResultSchema accepts a typical result', () => {
    const ok = HookEnhanceResultSchema.parse({
      replacementTailMd: 'x'.repeat(220),
      hookMd: '门把手转动了——但屋里只有他一个人。',
      technique: 'cliff',
      notesMd: '把原结尾的对话淡出改为门把手特写，制造身份未明的危机感。',
    });
    expect(ok.technique).toBe('cliff');
  });

  it('HookEnhanceResultSchema rejects unknown technique', () => {
    expect(() =>
      HookEnhanceResultSchema.parse({
        replacementTailMd: 'x'.repeat(120),
        hookMd: 'x'.repeat(20),
        technique: 'twist',
        notesMd: 'x'.repeat(20),
      }),
    ).toThrow();
  });
});


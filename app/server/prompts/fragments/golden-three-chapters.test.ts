import { describe, expect, it } from 'vitest';
import { GOLDEN_THREE_CHAPTERS_FRAGMENT } from './golden-three-chapters.ts';

describe('GOLDEN_THREE_CHAPTERS_FRAGMENT', () => {
  it('non-empty', () => {
    expect(GOLDEN_THREE_CHAPTERS_FRAGMENT.length).toBeGreaterThan(200);
  });

  it('要包含三章共同硬约束的核心关键词', () => {
    const t = GOLDEN_THREE_CHAPTERS_FRAGMENT;
    expect(t).toMatch(/爆点\s*≥/);
    expect(t).toMatch(/反直觉/);
    expect(t).toMatch(/数字具体化/);
    expect(t).toMatch(/章末钩子.*具体|具体.*章末钩子|空气钩子/);
    expect(t).toMatch(/配角/);
  });

  it('要分别给出三章的特定约束', () => {
    const t = GOLDEN_THREE_CHAPTERS_FRAGMENT;
    expect(t).toMatch(/第\s*1\s*章/);
    expect(t).toMatch(/第\s*2\s*章/);
    expect(t).toMatch(/第\s*3\s*章/);
    // 1 章必须建立长线悬念 + 即时爽点引擎
    expect(t).toMatch(/长线悬念/);
    expect(t).toMatch(/爽点引擎/);
    // 2 章必须回应 1 章末钩子
    expect(t).toMatch(/回应.*钩子|钩子.*回应/);
    // 3 章必须爽点兑现
    expect(t).toMatch(/兑现|落地/);
  });

  it('要规定 beat 输出格式（爆点列表 + 黄金3章标记）', () => {
    const t = GOLDEN_THREE_CHAPTERS_FRAGMENT;
    expect(t).toMatch(/爆点：/);
    expect(t).toMatch(/\[黄金3章\]/);
  });

  it('要列出反例避免 LLM 重复套路', () => {
    const t = GOLDEN_THREE_CHAPTERS_FRAGMENT;
    expect(t).toMatch(/反例/);
  });
});

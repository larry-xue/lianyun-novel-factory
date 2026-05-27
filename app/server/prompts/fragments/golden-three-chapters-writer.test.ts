import { describe, expect, it } from 'vitest';
import { GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT } from './golden-three-chapters-writer.ts';

describe('GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT', () => {
  it('non-empty', () => {
    expect(GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT.length).toBeGreaterThan(200);
  });

  it('要明确告诉 writer 不要生成爆点而是交付 planner 已列的爆点', () => {
    const t = GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT;
    expect(t).toMatch(/爆点：/);
    expect(t).toMatch(/不是再生成|交付/);
  });

  it('要包含句子层规则（第一句即冲突 / 短句独立成段 / 数字具体化 / 现代词违和）', () => {
    const t = GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT;
    expect(t).toMatch(/第一句/);
    expect(t).toMatch(/短句|独立成段/);
    expect(t).toMatch(/数字具体化/);
    expect(t).toMatch(/现代词/);
  });

  it('要规定章末钩子打磨与禁止空气钩子', () => {
    const t = GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT;
    expect(t).toMatch(/章末/);
    expect(t).toMatch(/空气钩子|具体画面|具体可视化/);
  });

  it('要列出反例避免 writer 重复套路', () => {
    const t = GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT;
    expect(t).toMatch(/反例/);
  });

  it('要禁止信息倾倒', () => {
    const t = GOLDEN_THREE_CHAPTERS_WRITER_FRAGMENT;
    expect(t).toMatch(/信息倾倒|节奏杀手/);
  });
});

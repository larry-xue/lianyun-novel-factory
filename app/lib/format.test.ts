import { describe, expect, it } from 'vitest';
import { fmtTokens } from './format.ts';

describe('fmtTokens', () => {
  it('non-positive / non-finite → "0 tok"', () => {
    expect(fmtTokens(0)).toBe('0 tok');
    expect(fmtTokens(-1)).toBe('0 tok');
    expect(fmtTokens(NaN)).toBe('0 tok');
    expect(fmtTokens(Infinity)).toBe('0 tok');
  });

  it('< 1000 → 原样', () => {
    expect(fmtTokens(1)).toBe('1 tok');
    expect(fmtTokens(123)).toBe('123 tok');
    expect(fmtTokens(999)).toBe('999 tok');
  });

  it('1k–10k → 一位小数 k', () => {
    expect(fmtTokens(1000)).toBe('1.0k tok');
    expect(fmtTokens(1234)).toBe('1.2k tok');
    expect(fmtTokens(9999)).toBe('10.0k tok');
  });

  it('10k–1M → 整数 k', () => {
    expect(fmtTokens(10_000)).toBe('10k tok');
    expect(fmtTokens(123_456)).toBe('123k tok');
    expect(fmtTokens(999_999)).toBe('1000k tok');
  });

  it('≥ 1M → 一位小数 M', () => {
    expect(fmtTokens(1_000_000)).toBe('1.0M tok');
    expect(fmtTokens(1_234_567)).toBe('1.2M tok');
    expect(fmtTokens(12_345_678)).toBe('12.3M tok');
  });
});

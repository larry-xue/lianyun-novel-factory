import { describe, expect, it } from 'vitest';
import { BatchInputSchema, BatchJobInputSchema, parseGlobalConcurrency } from './orchestrator.ts';

describe('BatchInputSchema', () => {
  it('rejects empty jobs array', () => {
    expect(() =>
      BatchInputSchema.parse({ name: '夜跑', concurrency: 2, jobs: [] }),
    ).toThrow();
  });

  it('rejects more than 50 jobs', () => {
    expect(() =>
      BatchInputSchema.parse({
        name: '海量',
        jobs: Array.from({ length: 51 }, () => ({
          topicTitle: '试',
          pitch: '足够长的描述',
          elementSlugs: ['a'],
        })),
      }),
    ).toThrow();
  });

  it('accepts a small valid batch', () => {
    const ok = BatchInputSchema.parse({
      name: '夜跑',
      jobs: [
        {
          topicTitle: '末世',
          pitch: '社畜重生末世前 7 天',
          elementSlugs: ['post-apocalypse'],
        },
      ],
    });
    expect(ok.concurrency).toBe(2);
    expect(ok.earlyKillBelowChars).toBe(2200);
  });
});

describe('BatchJobInputSchema', () => {
  it('rejects empty pitch', () => {
    expect(() =>
      BatchJobInputSchema.parse({
        topicTitle: '试',
        pitch: '',
        elementSlugs: ['a'],
      }),
    ).toThrow();
  });

  it('defaults totalChapters/charsPerChapter', () => {
    const ok = BatchJobInputSchema.parse({
      topicTitle: '试题',
      pitch: '一段足够长的描述测试占位',
      elementSlugs: ['a'],
    });
    expect(ok.totalChapters).toBe(1);
    expect(ok.charsPerChapter).toBe(3000);
  });
});

describe('parseGlobalConcurrency', () => {
  it('defaults to 2 when undefined / NaN', () => {
    expect(parseGlobalConcurrency(undefined)).toBe(2);
    expect(parseGlobalConcurrency('not-a-number')).toBe(1); // Number('not-a-number') = NaN → fall to 1
  });

  it('parses valid integer strings', () => {
    expect(parseGlobalConcurrency('1')).toBe(1);
    expect(parseGlobalConcurrency('4')).toBe(4);
    expect(parseGlobalConcurrency(8)).toBe(8);
  });

  it('clamps to [1, 16]', () => {
    expect(parseGlobalConcurrency(0)).toBe(1);
    expect(parseGlobalConcurrency(-5)).toBe(1);
    expect(parseGlobalConcurrency(20)).toBe(16);
    expect(parseGlobalConcurrency(100)).toBe(16);
  });

  it('floors fractional values', () => {
    expect(parseGlobalConcurrency(3.7)).toBe(3);
    expect(parseGlobalConcurrency('2.4')).toBe(2);
  });
});

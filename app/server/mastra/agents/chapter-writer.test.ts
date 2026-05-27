import { describe, expect, it } from 'vitest';
import {
  ChapterWriteResultSchema,
  ThreadActionSchema,
  chapterWriter,
} from './chapter-writer.ts';

describe('chapter-writer agent', () => {
  it('exposes a Mastra agent with id, name, and instructions', () => {
    expect(chapterWriter.id).toBe('chapter-writer');
    expect(chapterWriter.name).toBe('章节写手');
  });
});

describe('ThreadActionSchema', () => {
  it('accepts a pay action with slug + noteMd', () => {
    const a = ThreadActionSchema.parse({
      kind: 'pay',
      slug: 'auto-abc1234567890def',
      noteMd: '主角在密室里揭开信件来源',
    });
    expect(a.kind).toBe('pay');
    expect(a.slug).toBe('auto-abc1234567890def');
  });

  it('accepts an introduce action with title + weight', () => {
    const a = ThreadActionSchema.parse({
      kind: 'introduce',
      title: '神秘老者赠书',
      weight: 'arc',
      payoffTriggerMd: '主角第一次离开新手村',
      noteMd: '老者临别赠送一本残缺手札',
    });
    expect(a.kind).toBe('introduce');
    expect(a.title).toBe('神秘老者赠书');
    expect(a.weight).toBe('arc');
  });

  it('rejects unknown kind', () => {
    expect(() =>
      ThreadActionSchema.parse({ kind: 'postpone', slug: 'x', noteMd: 'y' }),
    ).toThrow();
  });

  it('requires non-empty noteMd', () => {
    expect(() =>
      ThreadActionSchema.parse({ kind: 'hint', slug: 'auto-x', noteMd: '' }),
    ).toThrow();
  });
});

describe('ChapterWriteResultSchema (S2 threadActions)', () => {
  const baseResult = {
    title: '第一章',
    contentMd: 'x'.repeat(600),
    hookMd: '末尾一句钩子',
    newState: {
      arcStage: '开篇',
      activeCharacters: [{ name: '主角', status: '在场' }],
      openThreads: ['老者赠书未解'],
      lastEventSummaryMd: '主角入门拜师',
      nextChapterIntentMd: '下章被同门刁难',
    },
  };

  it('parses a chapter result with threadActions populated', () => {
    const r = ChapterWriteResultSchema.parse({
      ...baseResult,
      newState: {
        ...baseResult.newState,
        threadActions: [
          { kind: 'introduce', title: '神秘老者赠书', noteMd: '老者临别赠书' },
          { kind: 'hint', slug: 'auto-existing-001', noteMd: '主角想起了表哥' },
        ],
      },
    });
    expect(r.newState.threadActions).toHaveLength(2);
    expect(r.newState.threadActions[0]!.kind).toBe('introduce');
  });

  it('lenient: missing threadActions field defaults to []', () => {
    // 老 prompt 输出没这个字段，必须不报错
    const r = ChapterWriteResultSchema.parse(baseResult);
    expect(r.newState.threadActions).toEqual([]);
  });

  it('lenient: malformed threadActions falls back to []', () => {
    // LLM 把 threadActions 输出成 null 或对象时不应炸
    const r = ChapterWriteResultSchema.parse({
      ...baseResult,
      newState: { ...baseResult.newState, threadActions: null },
    });
    expect(r.newState.threadActions).toEqual([]);
  });
});

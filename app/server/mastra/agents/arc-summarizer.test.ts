import { describe, expect, it } from 'vitest';
import {
  ArcSummaryResultSchema,
  BookSummaryResultSchema,
  arcSummarizer,
  bookSummarizer,
} from './arc-summarizer.ts';
import { PlanReviseResultSchema, planReviser } from './plan-reviser.ts';

describe('arc-summarizer & book-summarizer', () => {
  it('agents expose ids', () => {
    expect(arcSummarizer.id).toBe('arc-summarizer');
    expect(bookSummarizer.id).toBe('book-summarizer');
  });

  it('ArcSummaryResultSchema requires summaryMd ≥ 80 chars', () => {
    expect(() =>
      ArcSummaryResultSchema.parse({
        arcName: '末世第一周',
        summaryMd: '太短',
        pivotsMd: 'x'.repeat(40),
      }),
    ).toThrow();

    const ok = ArcSummaryResultSchema.parse({
      arcName: '末世第一周',
      summaryMd: 'x'.repeat(120),
      pivotsMd: 'x'.repeat(40),
      openThreads: ['前世兄弟还没找到', '系统最高奖励待解锁'],
    });
    expect(ok.openThreads).toHaveLength(2);
  });

  it('BookSummaryResultSchema requires summaryMd ≥ 120 chars', () => {
    expect(() =>
      BookSummaryResultSchema.parse({ summaryMd: 'x'.repeat(20) }),
    ).toThrow();
    const ok = BookSummaryResultSchema.parse({ summaryMd: 'x'.repeat(150) });
    expect(ok.summaryMd.length).toBeGreaterThanOrEqual(120);
  });
});

describe('plan-reviser', () => {
  it('agent exposes id', () => {
    expect(planReviser.id).toBe('plan-reviser');
  });

  it('PlanReviseResultSchema accepts keep with empty plan', () => {
    const ok = PlanReviseResultSchema.parse({
      decision: 'keep',
      reasonMd: '主线推进与原大纲一致，前 5 章伏笔均按计划埋设。',
    });
    expect(ok.decision).toBe('keep');
    expect(ok.chapterPlan).toEqual([]);
  });

  it('PlanReviseResultSchema accepts revise with chapter plan', () => {
    const ok = PlanReviseResultSchema.parse({
      decision: 'revise',
      reasonMd:
        '原大纲第 8 章本应主角下副本，实际线已经把主角推到都市线，需要调整后续 3 章节奏。',
      chapterPlan: [
        {
          idx: 8,
          title: '城中暗访',
          summaryMd: '主角在都市暗访目标公司，并发现关键证据。'.padEnd(40, '。'),
          intent: '把目标转向都市线主反派的暗布局',
        },
      ],
    });
    expect(ok.chapterPlan).toHaveLength(1);
  });
});

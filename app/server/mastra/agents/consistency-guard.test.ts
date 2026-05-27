import { describe, expect, it } from 'vitest';
import {
  ConsistencyReportSchema,
  consistencyGuard,
} from './consistency-guard.ts';

describe('consistency-guard agent', () => {
  it('exposes a Mastra agent with id, name, and instructions', () => {
    expect(consistencyGuard.id).toBe('consistency-guard');
    expect(consistencyGuard.name).toBe('一致性守门员');
    expect(typeof consistencyGuard.getInstructions).toBe('function');
  });

  it('ConsistencyReportSchema accepts a passed report with no issues', () => {
    const ok = ConsistencyReportSchema.parse({
      passed: true,
      summaryMd: '无明显问题，主线推进自然。',
      issues: [],
      rewriteHintMd: '',
    });
    expect(ok.passed).toBe(true);
    expect(ok.issues).toHaveLength(0);
  });

  it('ConsistencyReportSchema accepts a failed report with issues + rewrite hint', () => {
    const report = ConsistencyReportSchema.parse({
      passed: false,
      summaryMd: '主角能力漂移，伏笔丢失。',
      issues: [
        {
          severity: 'blocker',
          kind: 'character-drift',
          evidenceMd: '第二段写主角左臂被废，第六段又用左手挥剑。',
          fixMd: '保持主角左臂残废，让他用右手或剑器辅助迎敌。',
        },
        {
          severity: 'major',
          kind: 'foreshadow-lost',
          evidenceMd: '上一章埋的"神秘老者赠书"线索在本章彻底没提。',
          fixMd: '在结尾让主角再次想起赠书一事，或让老者短暂出场。',
        },
      ],
      rewriteHintMd: '重写时务必：保留主角左臂残疾，且至少用一段回顾老者赠书的伏笔。',
    });
    expect(report.passed).toBe(false);
    expect(report.issues).toHaveLength(2);
    expect(report.rewriteHintMd.length).toBeGreaterThan(0);
  });

  it('rejects unknown severity / kind', () => {
    expect(() =>
      ConsistencyReportSchema.parse({
        passed: false,
        summaryMd: 'x'.repeat(20),
        issues: [
          {
            severity: 'critical',
            kind: 'character-drift',
            evidenceMd: 'xx',
            fixMd: 'xxxx',
          },
        ],
        rewriteHintMd: '',
      }),
    ).toThrow();

    expect(() =>
      ConsistencyReportSchema.parse({
        passed: false,
        summaryMd: 'x'.repeat(20),
        issues: [
          {
            severity: 'blocker',
            kind: 'plot-hole',
            evidenceMd: 'xx',
            fixMd: 'xxxx',
          },
        ],
        rewriteHintMd: '',
      }),
    ).toThrow();
  });
});

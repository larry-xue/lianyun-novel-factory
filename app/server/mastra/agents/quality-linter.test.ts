import { describe, expect, it } from 'vitest';
import { QualityLintReportSchema, qualityLinter } from './quality-linter.ts';

describe('quality-linter agent', () => {
  it('exposes a Mastra agent with id, name, instructions', () => {
    expect(qualityLinter.id).toBe('quality-linter');
    expect(qualityLinter.name).toBe('质检守门员');
    expect(typeof qualityLinter.getInstructions).toBe('function');
  });

  it('QualityLintReportSchema accepts a passed report', () => {
    const ok = QualityLintReportSchema.parse({
      passed: true,
      summaryMd: '语义层无明显问题。',
      issues: [],
      rewriteHintMd: '',
    });
    expect(ok.passed).toBe(true);
    expect(ok.issues).toHaveLength(0);
  });

  it('QualityLintReportSchema accepts failed report with issues', () => {
    const report = QualityLintReportSchema.parse({
      passed: false,
      summaryMd: '视角越界 + 心理空洞。',
      issues: [
        {
          kind: 'pov-violation',
          severity: 'blocker',
          evidenceMd: '"敌人在屋顶冷笑"——聚焦角色在屋内，没有上帝视角。',
          fixMd: '改为聚焦角色听到屋顶传来动静，不要直接交代敌人表情。',
        },
        {
          kind: 'psychology-empty',
          severity: 'major',
          evidenceMd: '"他很伤心"这种直白概括出现 3 次。',
          fixMd: '用具体身体反应（手指收紧/喉咙发紧）和环境感知体现情绪。',
        },
      ],
      rewriteHintMd: '重写时务必：所有他人内心活动改为聚焦角色的感知；删除所有"很X"的情绪概括。',
    });
    expect(report.passed).toBe(false);
    expect(report.issues).toHaveLength(2);
    expect(report.rewriteHintMd.length).toBeGreaterThan(0);
  });

  it('rejects unknown kind', () => {
    expect(() =>
      QualityLintReportSchema.parse({
        passed: false,
        summaryMd: 'xx',
        issues: [
          {
            kind: 'random-thing',
            severity: 'blocker',
            evidenceMd: 'xx',
            fixMd: 'xxxx',
          },
        ],
        rewriteHintMd: '',
      }),
    ).toThrow();
  });

  it('accepts new contract-layer kinds (genre/canonical/last-hook)', () => {
    const r = QualityLintReportSchema.parse({
      passed: false,
      summaryMd: '契约层 3 项命中。',
      issues: [
        {
          kind: 'genre-trope-violation',
          severity: 'blocker',
          evidenceMd: '本章引入"上古血脉觉醒"剧情，明显属于本书 prohibited_tropes 红线。',
          fixMd: '删除上古血脉相关情节，回到种田仕途主线。',
        },
        {
          kind: 'canonical-number-drift',
          severity: 'blocker',
          evidenceMd: '本章写"十二根锁链"，canonical-numbers 文档记载为 4 根。',
          fixMd: '改为 4 根锁链或先在 canonical-numbers 里更新数字。',
        },
        {
          kind: 'last-hook-broken',
          severity: 'blocker',
          evidenceMd: '上一章末"佝偻人影持斧滴血"，本章开头一片祥和未提及。',
          fixMd: '本章前 1/3 显式接续上一章末尾的人影/斧头细节。',
        },
      ],
      rewriteHintMd: '依次修复 3 项 blocker。',
    });
    expect(r.issues).toHaveLength(3);
    expect(r.issues.map((i) => i.kind)).toEqual([
      'genre-trope-violation',
      'canonical-number-drift',
      'last-hook-broken',
    ]);
  });

  it('rewriteHintMd 缺失时被 lenient 默认为空串', () => {
    const r = QualityLintReportSchema.parse({
      passed: true,
      summaryMd: 'ok',
      issues: [],
    });
    expect(r.rewriteHintMd).toBe('');
  });
});

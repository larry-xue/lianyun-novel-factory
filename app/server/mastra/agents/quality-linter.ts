import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';
import { lenientString } from './_zod-helpers.ts';
import { QUALITY_LINTER_SYSTEM } from '../../prompts/quality-linter.system.ts';
import { loadPromptOrFallback } from '../../services/prompts.ts';

/**
 * quality-linter LLM 层：检查 deterministic 正则覆盖不到的语义层问题。
 *
 * 在 chapter-writer 之后、consistency-guard 之前调用。
 * deterministic 层失败时不调用此 agent（直接返工，省 token）。
 */

export const QualityLintIssueSchema = z.object({
  kind: z.enum([
    // 语义层
    'pov-violation',
    'psychology-empty',
    'dialogue-homogenized',
    'motive-unclear',
    'theme-forced',
    'plot-template',
    'scene-transition-broken',
    // 契约 / 接续层（长篇不漂移的核心维度）
    'genre-trope-violation', // 踩 books.prohibited_tropes 任一红线
    'canonical-number-drift', // 本章引用数字与 canonical-numbers 文档不一致
    'last-hook-broken', // 本章开头未接续上一章 lastHookMd 的人物/事件/异象
    'other',
  ]),
  severity: z.enum(['blocker', 'major', 'minor']),
  evidenceMd: z.string().min(2),
  fixMd: z.string().min(4),
});
export type QualityLintIssue = z.infer<typeof QualityLintIssueSchema>;

export const QualityLintReportSchema = z.object({
  passed: z.boolean(),
  summaryMd: z.string().min(2),
  issues: z.array(QualityLintIssueSchema).default([]),
  rewriteHintMd: lenientString(''),
});
export type QualityLintReport = z.infer<typeof QualityLintReportSchema>;

const SYSTEM = QUALITY_LINTER_SYSTEM;

export const qualityLinter = new Agent({
  id: 'quality-linter',
  name: '质检守门员',
  instructions: () => loadPromptOrFallback('quality-linter.system', SYSTEM),
  model: sharedModel,
});

export const QUALITY_LINTER_PROMPT = SYSTEM;

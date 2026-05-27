import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';

/**
 * consistency-guard 输出。
 * - passed: 该章是否过关
 * - issues: 严重度 + 类型 + 位置 + 证据 + 建议改法
 * - rewriteHintMd: 给 chapter-writer 的"重写指令"，命中重写时塞进下一次 prompt
 */
export const ConsistencyIssueSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor']),
  kind: z.enum([
    'foreshadow-lost',
    'foreshadow-contradiction',
    'character-drift',
    'world-rule-violation',
    'timeline-conflict',
    'continuity-break',
    'thread-action-incoherent',
    'other',
  ]),
  evidenceMd: z.string().min(2),
  fixMd: z.string().min(4),
  refersTo: z.string().optional(),
});
export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;

import { lenientString } from './_zod-helpers.ts';

export const ConsistencyReportSchema = z.object({
  passed: z.boolean(),
  summaryMd: z.string().min(4),
  issues: z.array(ConsistencyIssueSchema).default([]),
  rewriteHintMd: lenientString(''),
});
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

import { CONSISTENCY_GUARD_SYSTEM } from '../../prompts/consistency-guard.system.ts';
import { loadPromptOrFallback } from '../../services/prompts.ts';

const SYSTEM = CONSISTENCY_GUARD_SYSTEM;

export const consistencyGuard = new Agent({
  id: 'consistency-guard',
  name: '一致性守门员',
  instructions: () => loadPromptOrFallback('consistency-guard.system', SYSTEM),
  model: sharedModel,
});

export const CONSISTENCY_GUARD_PROMPT = SYSTEM;

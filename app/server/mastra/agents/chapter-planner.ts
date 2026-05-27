import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';
import { lenientString } from './_zod-helpers.ts';

/**
 * chapter-planner 输出：milestone（弧目标） + 5-10 章具体 beat。
 *
 * 输入 = 设计文档 + 弧摘要 + 最近 3 章 + 开放伏笔 + 已写章数
 * 输出 = 下一段 milestone（推进目标 + 必须触达的剧情锚点 + 节拍阶段）
 *        + milestone 内的 5-10 章 beat（按 milestone 拆分，但单章自由发挥）
 *
 * 抬层设计：milestone 给方向，beat 给具体节拍编号；writer 在 milestone 内
 * 自由战术，不必死守 beat 描述。pacingPhase 挂 milestone（一个 milestone 一种节奏），
 * 不挂 beat。
 */

export const PACING_PHASES = ['开端', '上升', '中段反转', '高潮', '收尾'] as const;
export type PacingPhase = typeof PACING_PHASES[number];

const pacingPhaseField = z
  .enum(PACING_PHASES)
  .optional()
  .catch('上升')
  .transform((v) => v ?? '上升');

export const MilestoneSchema = z.object({
  name: z.string().min(2).max(40),
  goalMd: z.string().min(20).max(400),
  keyAnchors: z.array(z.string().min(4)).min(2).max(5),
  pacingPhase: pacingPhaseField,
  /**
   * POV 锁：本 milestone 的视角角色，必须等于 books.protagonist。
   * 防止跨弧规划时把视角从主角切给配角；长篇里这是最常见的题材漂移之一。
   */
  povCharacter: z.string().min(1).max(40),
  /**
   * 设定预算：本 milestone 引入的全新世界观/系统/势力概念，最多 1 个。
   * 防止长篇里每段规划都新增 3-5 个设定，到中后期堆出几十个互相牵扯的概念。
   * 引用既有设定不算（不需要列出）；空数组表示完全靠既有设定推进。
   */
  newConcepts: z.array(z.string().min(2).max(40)).max(1).default([]),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ChapterBeatSchema = z.object({
  idx: z.number().int().positive(),
  title: lenientString(''),
  summaryMd: z.string().min(4),
  intent: lenientString(''),
});
export type ChapterBeat = z.infer<typeof ChapterBeatSchema>;

export const BatchChapterPlanResultSchema = z.object({
  milestone: MilestoneSchema,
  chapterBeats: z.array(ChapterBeatSchema).min(1).max(15),
});
export type BatchChapterPlanResult = z.infer<typeof BatchChapterPlanResultSchema>;

// Backward compat: single-chapter plan used by old code paths
export const ChapterPlanResultSchema = z.object({
  title: z.string().min(1).max(60),
  keyBeats: z.array(z.string().min(4)).min(1).max(8),
  threadPlan: z
    .array(
      z.object({
        slug: z.string(),
        action: z.enum(['hint', 'pay', 'skip']),
        reasonMd: z.string().min(2),
      }),
    )
    .optional()
    .catch([])
    .transform((v) => v ?? []),
  pacingGuidance: lenientString(''),
  intent: z.string().min(4).max(200),
  estimatedArcStage: lenientString(''),
});
export type ChapterPlanResult = z.infer<typeof ChapterPlanResultSchema>;

import { CHAPTER_PLANNER_SYSTEM } from '../../prompts/chapter-planner.system.ts';
import { loadPromptOrFallback } from '../../services/prompts.ts';

const SYSTEM = CHAPTER_PLANNER_SYSTEM;

export const chapterPlanner = new Agent({
  id: 'chapter-planner',
  name: '章节策划师',
  instructions: () => loadPromptOrFallback('chapter-planner.system', SYSTEM),
  model: sharedModel,
});

export const CHAPTER_PLANNER_PROMPT = SYSTEM;

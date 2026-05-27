import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';
import { lenientString } from './_zod-helpers.ts';

/**
 * 本章对单条伏笔的动作。
 * - introduce: 引入新坑（必填 title；slug 可省，由后端自动生成）
 * - hint: 暗示/推进已有坑（必填 slug）
 * - pay: 回收已有坑（必填 slug）
 *
 * postpone（跳过 P0 坑）不进表，写在 noteMd 里给 consistency-guard 看就行。
 */
export const ThreadActionSchema = z.object({
  kind: z.enum(['introduce', 'hint', 'pay']),
  slug: z.string().optional(),
  title: z.string().optional(),
  weight: z.enum(['small', 'arc', 'book']).optional(),
  payoffWindowChapters: z.number().int().positive().optional(),
  payoffTriggerMd: z.string().optional(),
  noteMd: z.string().min(1),
});
export type ThreadAction = z.infer<typeof ThreadActionSchema>;

const lenientThreadActions = () =>
  z
    .array(ThreadActionSchema)
    .optional()
    .catch([])
    .transform((v) => v ?? []);

/**
 * chapter-writer 输出：
 * - 章节标题 + 正文（~3000 中文字）
 * - 新的 book_state 快照供下一章读取
 * - threadActions：本章对各伏笔做了什么（S2 加；老响应缺这字段会被 lenient 默认成 []）
 *
 * char_count 不让模型自填，写库时由后端统计。
 */
export const ChapterWriteResultSchema = z.object({
  title: z.string().min(1).max(60),
  contentMd: z.string().min(500),
  hookMd: z.string().min(4),
  newState: z.object({
    arcStage: lenientString(''),
    activeCharacters: z
      .array(
        z.object({
          name: z.string().min(1),
          status: lenientString(''),
        }),
      )
      .default([]),
    threadActions: lenientThreadActions(),
    lastEventSummaryMd: lenientString(''),
    nextChapterIntentMd: lenientString(''),
  }),
});
export type ChapterWriteResult = z.infer<typeof ChapterWriteResultSchema>;

import { CHAPTER_WRITER_SYSTEM } from '../../prompts/chapter-writer.system.ts';
import { loadPromptOrFallback } from '../../services/prompts.ts';

const SYSTEM = CHAPTER_WRITER_SYSTEM;

export const chapterWriter = new Agent({
  id: 'chapter-writer',
  name: '章节写手',
  instructions: () => loadPromptOrFallback('chapter-writer.system', SYSTEM),
  model: sharedModel,
});

export const CHAPTER_WRITER_PROMPT = SYSTEM;

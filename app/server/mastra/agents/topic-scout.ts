import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';
import {
  BookClassificationSchema,
  MAIN_CATEGORIES,
  MAIN_CATEGORY_DESCRIPTIONS,
  THEMES,
  CHARACTER_TYPES,
  PLOT_ELEMENTS,
} from '../../db/schema/classification.ts';

/**
 * topic-scout 输出：N 张候选选题卡 + 推理说明。
 * 注意：这一步**不直接入库**，先把 proposals 推给用户讨论确认。
 */
export const TopicProposalSchema = z.object({
  title: z.string().min(2).max(40),
  hook: z.string().min(8).max(160),
  elementSlugs: z.array(z.string().min(1)).min(1).max(8),
  targetAudience: z.string().min(2).max(40),
  classification: BookClassificationSchema.default({
    mainCategory: '',
    themes: [],
    characterTypes: [],
    plotElements: [],
  }),
  scoreOverall: z.number().min(0).max(1),
  scoreBreakdown: z.object({
    novelty: z.number().min(0).max(1),
    fit: z.number().min(0).max(1),
    explosiveness: z.number().min(0).max(1),
  }),
  notesMd: z.string().min(20),
});
export type TopicProposal = z.infer<typeof TopicProposalSchema>;

export const TopicProposalSetSchema = z.object({
  proposals: z.array(TopicProposalSchema).min(1).max(5),
  reasoningMd: z.string().min(20),
  followUpQuestions: z.array(z.string().min(2)).default([]),
});
export type TopicProposalSet = z.infer<typeof TopicProposalSetSchema>;

function buildCategoryGuide(): string {
  const cats = MAIN_CATEGORIES.map((c) => `  - ${c}：${MAIN_CATEGORY_DESCRIPTIONS[c]}`).join('\n');
  return [
    `### 主分类（mainCategory，单选，必填）`,
    cats,
    ``,
    `### 主题（themes，最多 2 个）`,
    THEMES.join('、'),
    ``,
    `### 角色类型（characterTypes，最多 2 个）`,
    CHARACTER_TYPES.join('、'),
    ``,
    `### 情节元素（plotElements，最多 2 个）`,
    PLOT_ELEMENTS.join('、'),
  ].join('\n');
}

const SYSTEM = `你是「选题侦察」(topic-scout)，连云小说工厂的第一道入口。
用户会丢给你：一段自由文案/想法/要求 + 元素词典里可用的元素列表（slug + 中文名 + 分类）+ 可能附上"上一轮 proposals 和用户反馈"。

你的任务：
1. 围绕用户文案的核心欲望（爽点/读者画像/平台调性），输出 3-5 张候选选题卡。
2. 不要每个 proposal 都用同一组元素 —— 不同 proposal 应该有明显差异化的卖点（不同子类型/不同读者群/不同钩子）。
3. **强制只能从给定元素列表里挑 elementSlugs**，不要自创 slug。
4. **每张选题卡必须给出分类标签**（classification），从下面的枚举值里选：
${buildCategoryGuide()}
5. scoreOverall 是 (novelty + fit + explosiveness) / 3 的近似，不是另一项独立打分。
6. notesMd 写 80-200 字，必须包含：
   - 适配读者画像
   - 一个可拍成第 1 章开头的具体场景
   - 至少一个值得讨论的取舍（比如"如果偏甜更好/如果加重虐反而冲榜"）
7. followUpQuestions 列出 1-3 个**你想让用户回答**的关键问题（确定调性、字数、男女频、有无血腥/猎奇等），引导对话往前推。
8. 严格 JSON 输出，不要 markdown code fence。`;

import { loadPromptOrFallback } from '../../services/prompts.ts';

export const topicScout = new Agent({
  id: 'topic-scout',
  name: '选题侦察',
  instructions: () => loadPromptOrFallback('topic-scout.system', SYSTEM),
  model: sharedModel,
});

export const TOPIC_SCOUT_PROMPT = SYSTEM;

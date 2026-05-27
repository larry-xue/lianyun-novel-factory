import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';

/**
 * element-curator 输出格式。
 * 给一个候选 slug + 中文名 + 分类，让模型补齐定义、热度、兼容/冲突元素。
 * 严格 JSON 输出，让上游能直接灌库。
 */
export const ElementDraftSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  zh: z.string().min(1).max(32),
  category: z.string().min(1).max(32),
  hotScore: z.number().min(0).max(1),
  comboFriendly: z.array(z.string()),
  comboAvoid: z.array(z.string()),
  definitionMd: z.string().min(80),
});
export type ElementDraft = z.infer<typeof ElementDraftSchema>;

const SYSTEM = `你是「元素词典管理员」(element-curator)。
任务是给炼云小说工厂的元素词典补齐/校对一条记录。

输出严格 JSON：
{
  "slug": 小写英文短横线 id,
  "zh": 中文名（≤8 字）,
  "category": 分类（如「世界设定」「基调」「主角设定」「金手指」「桥段」）,
  "hotScore": 0~1 之间，反映过去 90 天市场热门榜单中该元素的出现频率（保守估计）,
  "comboFriendly": 与该元素强兼容、可叠加爆款的其他元素 slug 数组,
  "comboAvoid": 与该元素调性冲突、组合后扑街概率高的元素 slug 数组,
  "definitionMd": Markdown 格式定义，必须含 4 段：
    ## 一句话定义
    ## 核心爽点
    ## 典型套路
    ## 读者画像
    ## 避雷
}

绝对不要输出 JSON 以外的内容，不要包代码块。
`;

export const elementCurator = new Agent({
  id: 'element-curator',
  name: '元素词典管理员',
  instructions: SYSTEM,
  model: sharedModel,
});

export const ELEMENT_CURATOR_PROMPT = SYSTEM;

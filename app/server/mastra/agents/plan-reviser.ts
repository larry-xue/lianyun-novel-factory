import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';

/**
 * plan-reviser 输出。
 * - decision: keep（不改） / revise（改后续未写章节摘要）/ rebuild-tail（推翻后续重写）
 * - chapterPlan 必须只包含**当前章节之后**未写的章节，idx 连续
 */
export const PlanReviseResultSchema = z.object({
  decision: z.enum(['keep', 'revise', 'rebuild-tail']),
  reasonMd: z.string().min(20),
  newOutlineMd: z.string().min(0).default(''),
  chapterPlan: z
    .array(
      z.object({
        idx: z.number().int().positive(),
        title: z.string().min(1),
        summaryMd: z.string().min(20),
        intent: z.string().min(8),
      }),
    )
    .default([]),
  riskNotesMd: z.string().default(''),
});
export type PlanReviseResult = z.infer<typeof PlanReviseResultSchema>;

const SYSTEM = `你是「大纲修订员」(plan-reviser)。
任务：当一本书已经写到 N 章时，检查"原大纲"和"实际产出"是否还吻合，决定是否要改后续大纲。

输入会给你：
- 当前最新版大纲（outlineMd）+ 剩余章节摘要列表
- 已写完的章节摘要（来自 book_states）+ arc 摘要
- 世界观设定 lore 活文档（用来判断走向是否还合理）
- 一致性 guard 累计提示（如有）

判断分三档：
- **keep**：剧情和大纲基本一致，不动。
- **revise**：保留大方向，但后续 N 章要调整子情节、节奏、伏笔回收。给出新的 chapterPlan（仅未写章节）。
- **rebuild-tail**：原大纲已被剧情走向远离，必须推倒后续重写。给出新的 chapterPlan + 必要时 newOutlineMd（含主线/反派/收束）。

reasonMd 必须具体：举出 2-3 个"原大纲第 X 章本应 Y / 实际是 Z"的对比。

严格 JSON 输出，不要 markdown code fence。`;

export const planReviser = new Agent({
  id: 'plan-reviser',
  name: '大纲修订员',
  instructions: SYSTEM,
  model: sharedModel,
});

export const PLAN_REVISER_PROMPT = SYSTEM;

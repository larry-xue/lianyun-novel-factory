import { z } from 'zod';
import {
  ElementDraftSchema,
  elementCurator,
  type ElementDraft,
} from '../mastra/agents/element-curator.ts';
import { upsertElementBySlug } from './elements.ts';

const RefineInput = z.object({
  slug: z.string().optional(),
  zh: z.string().min(1),
  category: z.string().min(1),
  hint: z.string().optional(),
});
export type RefineInput = z.infer<typeof RefineInput>;

/**
 * 让 element-curator agent 给一条候选元素补齐字段。
 * 返回结构化 JSON（不写库），调用方决定要不要 upsert。
 */
export async function refineElementDraft(input: unknown): Promise<ElementDraft> {
  const data = RefineInput.parse(input);
  const userPrompt = [
    `请为下面这个候选元素补齐完整词典条目，严格 JSON 输出。`,
    `候选信息：`,
    `- 中文名：${data.zh}`,
    `- 分类：${data.category}`,
    data.slug ? `- slug：${data.slug}` : `- slug：你来给一个合规的英文短横线 slug`,
    data.hint ? `\n额外提示：${data.hint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = (await elementCurator.generate(
    [{ role: 'user', content: userPrompt }],
    { maxOutputTokens: 4096 } as never,
  )) as { object?: unknown; text?: string };

  const obj =
    result.object ??
    (typeof result.text === 'string' ? safeJsonParse(result.text) : undefined);
  if (obj === undefined) {
    throw new Error(`element-curator 返回空响应（text=${(result.text ?? '').slice(0, 200)}）`);
  }
  return ElementDraftSchema.parse(obj);
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export async function refineAndSaveElement(input: unknown) {
  const draft = await refineElementDraft(input);
  return await upsertElementBySlug(draft);
}

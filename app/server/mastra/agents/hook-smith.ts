import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';

/**
 * hook-smith 输出：把章末 200-400 字重写成更强钩子。
 * 不动前文主体，只替换尾段，避免破坏一致性。
 */
export const HookEnhanceResultSchema = z.object({
  /** 替换原章节末尾的新结尾段（200-450 中文字符） */
  replacementTailMd: z.string().min(60).max(1500),
  /** 一句话钩子摘要（落库到 chapters.scores.hookMd / book_states.next 引用） */
  hookMd: z.string().min(8).max(160),
  /** 用什么手法（cliff / reveal / reversal / question） */
  technique: z.enum(['cliff', 'reveal', 'reversal', 'question', 'mixed']),
  notesMd: z.string().min(10).max(400),
});
export type HookEnhanceResult = z.infer<typeof HookEnhanceResultSchema>;

const SYSTEM = `你是「Hook 锻造」(hook-smith)。
拿到一章正文（contentMd），你的任务是只替换它的**最后 200-400 字**，让章末钩子更强。

硬规则：
1. 不要重写主体！只输出"用来替换原章节末尾"的新结尾段（replacementTailMd）。
2. 替换段必须自然衔接前文：保留前文已经发生的事件、场景、人物状态，不要凭空加新人物或反转世界规则。
3. 钩子手法（technique）必须明确：
   - cliff: 危机突现，章末停在动作未完成的紧张点
   - reveal: 揭示一个让读者震惊的真相
   - reversal: 立场翻转（人物身份/敌我/事实）
   - question: 章末抛出一个会被下一章解答的关键问题
   - mixed: 多种叠加
4. hookMd 是一句话钩子摘要 + 用作下一章 chapter-writer 的衔接锚点。
5. 不要写"未完待续"、"下一章"、"敬请期待"等元话语。
6. 严格 JSON 输出，不要 markdown code fence。`;

export const hookSmith = new Agent({
  id: 'hook-smith',
  name: 'Hook 锻造',
  instructions: SYSTEM,
  model: sharedModel,
});

export const HOOK_SMITH_PROMPT = SYSTEM;

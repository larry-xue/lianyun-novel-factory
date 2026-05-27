import { z } from 'zod';

/**
 * LLM 在"可选字段"位置经常返回 null、空串、错类型或干脆省略。
 * 在 zod 4 里，需要 `.optional().catch(def).transform(v => v ?? def)` 三段套娃才能
 * 同时处理"键缺失"+"null"+"类型错误"三种情况。
 */
export const lenientString = (def = '') =>
  z
    .string()
    .optional()
    .catch(def)
    .transform((v) => v ?? def);

export const lenientStringArray = () =>
  z
    .array(z.string())
    .optional()
    .catch([])
    .transform((v) => v ?? []);

import 'dotenv/config';

const endpoint = process.env.LLM_API_ENDPOINT;
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

if (!endpoint && process.env.NODE_ENV !== 'test') {
  console.warn('[mastra] LLM_API_ENDPOINT not set; agents will fail at runtime');
}

/**
 * 所有 Mastra agent 共用的 model 配置。OpenAI 兼容端点由 env 注入：
 *   - LLM_API_ENDPOINT: 形如 https://api.openai.com/v1
 *   - LLM_API_KEY: bearer key
 *   - LLM_MODEL: 默认模型 id（例如 gpt-4o-mini）
 *
 * id 字段 Mastra 要求 `${provider}/${model}` 形式；我们用 openai/<model>，
 * 实际请求走的是 LLM_API_ENDPOINT。
 */
export const sharedModel = {
  id: `openai/${model}` as const,
  url: endpoint,
  apiKey: apiKey,
};

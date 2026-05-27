import { z } from 'zod';

const ChatMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  raw: unknown;
}

export interface LlmClientConfig {
  endpoint: string;
  apiKey: string;
  defaultModel: string;
  fetchFn?: typeof fetch;
}

export function createLlmClient(config: LlmClientConfig) {
  const baseUrl = config.endpoint.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
    'api-key': config.apiKey,
  };
  const fetchFn = config.fetchFn ?? fetch;

  async function chat(opts: ChatOptions): Promise<ChatResult> {
    const model = opts.model ?? config.defaultModel;
    const body = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxTokens
        ? isMimoRequest(config.endpoint, model)
          ? { max_completion_tokens: opts.maxTokens }
          : { max_tokens: opts.maxTokens }
        : {}),
      response_format:
        opts.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
      stream: false,
    };
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`LLM ${res.status}: ${text}`, res.status, text);
    }
    const json = (await res.json()) as OpenAiChatResponse;
    const choice = json.choices?.[0];
    if (!choice) throw new LlmError('LLM returned no choices', 502, JSON.stringify(json));
    return {
      content: choice.message?.content ?? '',
      finishReason: choice.finish_reason ?? 'stop',
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      model: json.model ?? model,
      raw: json,
    };
  }

  async function chatJson<T>(opts: ChatOptions, schema: z.ZodType<T>): Promise<T> {
    const result = await chat({ ...opts, responseFormat: 'json_object' });
    const parsed = JSON.parse(result.content);
    return schema.parse(parsed);
  }

  return { chat, chatJson, config };
}

export class LlmError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.body = body;
  }
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{
    message?: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface LlmRuntimeConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

let singleton: ReturnType<typeof createLlmClient> | undefined;
let currentConfig: LlmRuntimeConfig | undefined;
let initialDbSyncPromise: Promise<void> | null = null;

/**
 * 同步获取 client。第一次调用从 .env 读配置创建 singleton；
 * 之后 setLlmConfig 切换或 loadLlmConfigFromDb 加载会重建 singleton。
 */
export function getLlmClient(): ReturnType<typeof createLlmClient> {
  if (singleton) return singleton;
  setLlmConfig(loadConfigFromEnv());
  return singleton!;
}

/** 当前生效的 LLM 配置（不含 sync 调用前的 .env 兜底）。 */
export function getCurrentLlmConfig(): LlmRuntimeConfig | undefined {
  return currentConfig;
}

/** 显式切换配置：立即重建 singleton，下一次 chat() 用新配置。 */
export function setLlmConfig(cfg: LlmRuntimeConfig): void {
  if (!cfg.endpoint) throw new Error('LLM endpoint is required');
  if (!cfg.apiKey) throw new Error('LLM apiKey is required');
  currentConfig = cfg;
  singleton = createLlmClient({
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey,
    defaultModel: cfg.model,
  });
}

/**
 * 第一次调用时异步从 db 读 'llm-config' 并 setLlmConfig；后续调用复用同一个 promise。
 * caller 在 LLM 调用前 await 这个，无论 dev server 是否重启都能拿到最新 db 配置，
 * 不依赖用户主动访问 /settings 触发 sync。
 *
 * 失败 fallback 到 .env / 已有 singleton（不抛错）。
 */
export async function ensureLlmConfigReady(): Promise<void> {
  if (!initialDbSyncPromise) {
    initialDbSyncPromise = (async () => {
      try {
        await loadLlmConfigFromDb();
      } catch (e) {
        console.warn(
          '[llm-client] db config sync 失败，fallback 到 .env：',
          e instanceof Error ? e.message : e,
        );
      }
    })();
  }
  return initialDbSyncPromise;
}

/**
 * 从 platform_settings 表读 'llm-config'，存在则覆盖 .env / 已存配置。
 * 长跑进程（dev server / pg-boss worker）应该在启动时调一次；
 * web UI 写新配置后会自动调 setLlmConfig，不依赖这个函数。
 *
 * 用 dynamic import 避免 client.ts 反过来依赖 services 层（构建顺序友好）。
 */
export async function loadLlmConfigFromDb(): Promise<LlmRuntimeConfig | null> {
  const { getSetting } = await import('../services/platform-settings.ts');
  const saved = await getSetting('llm-config');
  if (!saved) return null;
  const endpoint = typeof saved.endpoint === 'string' ? saved.endpoint : '';
  const apiKey = typeof saved.apiKey === 'string' ? saved.apiKey : '';
  const model =
    typeof saved.model === 'string' && saved.model ? saved.model : 'gpt-4o-mini';
  if (!endpoint || !apiKey) return null;
  const cfg = { endpoint, apiKey, model };
  setLlmConfig(cfg);
  return cfg;
}

function loadConfigFromEnv(): LlmRuntimeConfig {
  const endpoint = process.env.LLM_API_ENDPOINT;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  if (!endpoint) throw new Error('LLM_API_ENDPOINT is not set');
  if (!apiKey) throw new Error('LLM_API_KEY is not set');
  return { endpoint, apiKey, model };
}

export function resetLlmClientForTests() {
  singleton = undefined;
  currentConfig = undefined;
  initialDbSyncPromise = null;
}

function isMimoRequest(endpoint: string, model: string): boolean {
  return /mimo|xiaomi/i.test(endpoint) || /mimo/i.test(model);
}

/** 中文字数 = 去掉空白后的中日韩 + 拉丁的总字符数。平台章节字数对应这个。 */
export function countChineseChars(s: string): number {
  return Array.from(s.replace(/\s/g, '')).length;
}

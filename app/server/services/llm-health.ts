import {
  ensureLlmConfigReady,
  getCurrentLlmConfig,
  type LlmRuntimeConfig,
} from '../llm/client.ts';
import type { JsonValue } from '../fns/_serializable.ts';

/**
 * LLM 健康探针：用当前配置打一次 json_object chat，**不写 runs / llm_calls**。
 *
 * 为什么直打 fetch 而不复用 client.chat()：
 * - 我们要原始 status code（client.chat 把 5xx 翻成 LlmError 字符串）
 * - 我们要严格的 timeout（client.chat 的 fetch 没有 timeout，正是这次问题根因）
 * - 探针不应该污染 llm_calls 审计表
 */

export type LlmProbeErrorCode =
  | 'no-config'
  | 'timeout'
  | 'no-choices'
  | 'unknown'
  | string; // HTTP status as string ("400" / "500" / ...)

export interface LlmProbeResult {
  ok: boolean;
  /** 端到端总耗时（ms），timeout 时也会写。 */
  latencyMs: number;
  /** 实际打过去的 model（no-config 时为空字符串）。 */
  model: string;
  /** 实际 endpoint。 */
  endpoint: string;
  /** 成功时解析出的 JSON 内容（或解析失败时的原始 string），便于 UI 直观显示。 */
  responseJson?: JsonValue;
  /** 失败时的错误码：'no-config' / 'timeout' / 'no-choices' / 'unknown' / HTTP status。 */
  errorCode?: LlmProbeErrorCode;
  /** 失败时的错误信息（截断到 ~600 字）。 */
  errorMessage?: string;
  /** 探测发起时间 ISO。 */
  probedAt: string;
}

export interface ProbeOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /** 测试用：注入 cfg loader，跳过 db/env 读取。 */
  loadConfigFn?: () => Promise<LlmRuntimeConfig | null>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function probeLlm(opts: ProbeOptions = {}): Promise<LlmProbeResult> {
  const probedAt = new Date().toISOString();
  const cfg = await (opts.loadConfigFn ?? defaultLoadConfig)();
  const t0 = Date.now();
  if (!cfg) {
    return {
      ok: false,
      latencyMs: 0,
      model: '',
      endpoint: '',
      errorCode: 'no-config',
      errorMessage: 'LLM 配置缺失（db 和 .env 都没有）',
      probedAt,
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetchFn ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`probe timeout after ${timeoutMs}ms`)), timeoutMs);

  try {
    const url = `${cfg.endpoint.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: '健康探测：返回 JSON {"ok":true}，不要任何其它字段或解释。',
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 16,
      stream: false,
    };
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'api-key': cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        model: cfg.model,
        endpoint: cfg.endpoint,
        errorCode: String(res.status),
        errorMessage: truncate(text || res.statusText || `HTTP ${res.status}`, 600),
        probedAt,
      };
    }
    const json = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
      | null;
    const choice = json?.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (!choice || !content) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        model: cfg.model,
        endpoint: cfg.endpoint,
        errorCode: 'no-choices',
        errorMessage: `LLM 返回无内容（body=${truncate(JSON.stringify(json), 200)}）`,
        probedAt,
      };
    }
    let parsed: JsonValue = content;
    try {
      parsed = JSON.parse(content) as JsonValue;
    } catch {
      // content 不是 JSON 也不算失败，json_object 是软约束
    }
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      model: cfg.model,
      endpoint: cfg.endpoint,
      responseJson: parsed,
      probedAt,
    };
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || /aborted|abort|timeout/i.test(err.message));
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      model: cfg.model,
      endpoint: cfg.endpoint,
      errorCode: isAbort ? 'timeout' : 'unknown',
      errorMessage: truncate(err instanceof Error ? err.message : String(err), 600),
      probedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultLoadConfig(): Promise<LlmRuntimeConfig | null> {
  try {
    await ensureLlmConfigReady();
  } catch {
    // ensureLlmConfigReady 内部已经吞错并打日志，这里再吃一次保平安
  }
  return getCurrentLlmConfig() ?? null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

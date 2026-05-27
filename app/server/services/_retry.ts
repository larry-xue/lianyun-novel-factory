import { ZodError } from 'zod';
import { LlmError } from '../llm/client.ts';
import { CancelledError } from './cancellation.ts';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void | Promise<void>;
  isRetriable?: (err: unknown) => boolean;
  signal?: AbortSignal;
  /** 注入随机源，便于测试。返回 [0, 1) */
  random?: () => number;
  /** 注入睡眠函数，便于测试跳过真实等待 */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * 带指数退避 + 全 jitter 的重试。
 * - attempt 从 0 开始；fn(0) 是首次调用
 * - 总调用次数 = maxRetries + 1
 * - 不可重试错误立即抛出
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const isRetriable = opts.isRetriable ?? defaultIsRetriable;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt === opts.maxRetries;
      if (isLast || !isRetriable(err)) throw err;
      const delayMs = computeBackoffMs(attempt, opts.baseDelayMs, opts.maxDelayMs, random);
      await opts.onRetry?.({ attempt: attempt + 1, error: err, delayMs });
      await sleepFn(delayMs, opts.signal);
    }
  }
  throw lastError;
}

export function computeBackoffMs(
  attempt: number,
  baseMs = 500,
  maxMs = 5000,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(exp * (0.5 + random() * 0.5));
}

/**
 * 默认重试判定：
 *   ✓ HTTP 5xx / 429 / 408
 *   ✓ Zod 校验错误（模型偶尔输出格式不对）
 *   ✓ JSON 解析失败 / 空响应
 *   ✓ Mastra 内置 STRUCTURED_OUTPUT 校验失败
 *   ✓ 网络层 TypeError（fetch 错误）
 *   ✗ 响应被截断（重试也无济于事，需要更大 maxTokens）
 *   ✗ AbortError（用户/上层主动取消）
 *   ✗ 其他未知错误（保守不重试）
 */
export function defaultIsRetriable(err: unknown): boolean {
  if (err instanceof CancelledError) return false;
  if (err instanceof LlmError) {
    return err.status >= 500 || err.status === 429 || err.status === 408;
  }
  if (err instanceof ZodError) return true;
  if (err instanceof Error) {
    if (/finish_reason=length|响应被截断/.test(err.message)) return false;
    if (err.name === 'AbortError') return false;
    if (/parse failed|schema validation failed|empty\/non-JSON|返回空响应|返回空\/非 JSON/.test(err.message)) return true;
    if (/STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED/.test(err.message)) return true;
    if (err.name === 'TypeError') return true;
  }
  return false;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmError } from '../llm/client.ts';
import { computeBackoffMs, defaultIsRetriable, withRetry } from './_retry.ts';

const noSleep = async () => {};
const fixedRandom = () => 0;

describe('defaultIsRetriable', () => {
  it('retries on LlmError 5xx and 429', () => {
    expect(defaultIsRetriable(new LlmError('boom', 500, ''))).toBe(true);
    expect(defaultIsRetriable(new LlmError('boom', 502, ''))).toBe(true);
    expect(defaultIsRetriable(new LlmError('rate', 429, ''))).toBe(true);
    expect(defaultIsRetriable(new LlmError('timeout', 408, ''))).toBe(true);
  });

  it('does not retry on 4xx auth/validation', () => {
    expect(defaultIsRetriable(new LlmError('bad req', 400, ''))).toBe(false);
    expect(defaultIsRetriable(new LlmError('unauth', 401, ''))).toBe(false);
    expect(defaultIsRetriable(new LlmError('forbidden', 403, ''))).toBe(false);
  });

  it('retries on Zod validation errors', () => {
    const schema = z.object({ x: z.string() });
    let zerr: unknown;
    try {
      schema.parse({ x: 1 });
    } catch (e) {
      zerr = e;
    }
    expect(defaultIsRetriable(zerr)).toBe(true);
  });

  it('retries on parse-failure and schema-validation messages', () => {
    expect(defaultIsRetriable(new Error('parse failed: empty/non-JSON response'))).toBe(true);
    expect(defaultIsRetriable(new Error('schema validation failed: foo'))).toBe(true);
    expect(defaultIsRetriable(new Error('agent x 返回空响应（text=...）'))).toBe(true);
    expect(
      defaultIsRetriable(new Error('STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED inner')),
    ).toBe(true);
    // harness callOneTurn 抛的中文错误消息 —— 必须能触发重试
    expect(
      defaultIsRetriable(new Error('harness turn 返回空/非 JSON：{"thought":"...')),
    ).toBe(true);
  });

  it('does NOT retry on truncation (length finish_reason)', () => {
    const err = new Error('agent x 响应被截断（finish_reason=length, maxTokens=1024）');
    expect(defaultIsRetriable(err)).toBe(false);
    expect(
      defaultIsRetriable(new Error('parse failed: response truncated (finish_reason=length, maxTokens=512)')),
    ).toBe(false);
  });

  it('does NOT retry on AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(defaultIsRetriable(err)).toBe(false);
  });

  it('retries on network TypeError', () => {
    const err = new TypeError('fetch failed');
    expect(defaultIsRetriable(err)).toBe(true);
  });

  it('does not retry unknown errors by default', () => {
    expect(defaultIsRetriable(new Error('weird'))).toBe(false);
    expect(defaultIsRetriable('string error')).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  it('grows exponentially capped by maxDelay', () => {
    const max = (a: number) => computeBackoffMs(a, 100, 1000, () => 1);
    expect(max(0)).toBe(100);
    expect(max(1)).toBe(200);
    expect(max(2)).toBe(400);
    expect(max(3)).toBe(800);
    expect(max(4)).toBe(1000); // capped
    expect(max(5)).toBe(1000);
  });

  it('applies full jitter in [exp/2, exp]', () => {
    expect(computeBackoffMs(2, 100, 5000, () => 0)).toBe(200); // 400 * 0.5
    expect(computeBackoffMs(2, 100, 5000, () => 0.999)).toBe(399); // 400 * ~1.0
  });
});

describe('withRetry', () => {
  it('returns first-attempt result without delay', async () => {
    const fn = vi.fn(async () => 'ok');
    const sleep = vi.fn(noSleep);
    const result = await withRetry(fn, { maxRetries: 3, sleepFn: sleep, random: fixedRandom });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on transient failure then succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new LlmError('flaky', 502, '');
      return 'ok';
    });
    const sleep = vi.fn(noSleep);
    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      maxRetries: 3,
      sleepFn: sleep,
      random: fixedRandom,
      onRetry,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ attempt: 2, error: expect.any(LlmError) }),
    );
  });

  it('throws original error after exhausting retries', async () => {
    const err = new LlmError('upstream-down', 503, '');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(
      withRetry(fn, { maxRetries: 2, sleepFn: noSleep, random: fixedRandom }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retriable errors', async () => {
    const err = new LlmError('bad request', 400, '');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(
      withRetry(fn, { maxRetries: 5, sleepFn: noSleep, random: fixedRandom }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes attempt index to fn (0-based)', async () => {
    const seen: number[] = [];
    let calls = 0;
    const fn = vi.fn(async (attempt: number) => {
      seen.push(attempt);
      calls++;
      if (calls < 3) throw new LlmError('x', 500, '');
      return 'ok';
    });
    await withRetry(fn, { maxRetries: 5, sleepFn: noSleep, random: fixedRandom });
    expect(seen).toEqual([0, 1, 2]);
  });

  it('aborts before next attempt when signal triggers', async () => {
    const ac = new AbortController();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        ac.abort(new Error('user-cancelled'));
        throw new LlmError('boom', 500, '');
      }
      return 'ok';
    });
    await expect(
      withRetry(fn, {
        maxRetries: 3,
        sleepFn: async (_ms, signal) => {
          if (signal?.aborted) throw signal.reason;
        },
        random: fixedRandom,
        signal: ac.signal,
      }),
    ).rejects.toThrow('user-cancelled');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeLlm } from './llm-health.ts';
import type { LlmRuntimeConfig } from '../llm/client.ts';

const cfg: LlmRuntimeConfig = {
  endpoint: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
};
const loadConfigFn = async () => cfg;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('probeLlm', () => {
  it('ok=true on 200 + valid choices', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const r = await probeLlm({ loadConfigFn, fetchFn });

    expect(r.ok).toBe(true);
    expect(r.model).toBe('test-model');
    expect(r.endpoint).toBe('https://example.test/v1');
    expect(r.responseJson).toEqual({ ok: true });
    expect(r.errorCode).toBeUndefined();
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('strips trailing slash from endpoint and posts to /chat/completions', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://example.test/v1/chat/completions');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await probeLlm({
      loadConfigFn: async () => ({ ...cfg, endpoint: 'https://example.test/v1/' }),
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('reports HTTP status as errorCode on 5xx', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('{"error":{"message":"Internal Server Error"}}', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    ) as unknown as typeof fetch;

    const r = await probeLlm({ loadConfigFn, fetchFn });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('500');
    expect(r.errorMessage).toContain('Internal Server Error');
  });

  it('reports 401 plainly', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    ) as unknown as typeof fetch;

    const r = await probeLlm({ loadConfigFn, fetchFn });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('401');
  });

  it('errorCode=no-choices when body has no choices', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('null', { status: 200 }),
    ) as unknown as typeof fetch;

    const r = await probeLlm({ loadConfigFn, fetchFn });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('no-choices');
  });

  it('errorCode=timeout when fetch hangs past timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const sig = init.signal;
        sig?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const promise = probeLlm({ loadConfigFn, fetchFn, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const r = await promise;

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('timeout');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('errorCode=no-config when loadConfigFn returns null', async () => {
    const r = await probeLlm({ loadConfigFn: async () => null });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('no-config');
    expect(r.endpoint).toBe('');
    expect(r.model).toBe('');
  });

  it('errorCode=unknown on generic fetch error (DNS / network)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const r = await probeLlm({ loadConfigFn, fetchFn });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('unknown');
    expect(r.errorMessage).toContain('fetch failed');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  LlmError,
  countChineseChars,
  createLlmClient,
  getCurrentLlmConfig,
  resetLlmClientForTests,
  setLlmConfig,
} from './client.ts';

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    return handler(req);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('createLlmClient.chat', () => {
  it('POSTs to /chat/completions with bearer auth and returns content + tokens', async () => {
    const fetchFn = mockFetch(async (req) => {
      expect(req.url).toBe('https://example.com/v1/chat/completions');
      expect(req.method).toBe('POST');
      expect(req.headers.get('authorization')).toBe('Bearer test-key');
      expect(req.headers.get('api-key')).toBe('test-key');
      const body = await req.json();
      expect(body).toMatchObject({
        model: 'gpt-test',
        temperature: 0.7,
        stream: false,
      });
      return jsonResponse({
        model: 'gpt-test',
        choices: [
          { message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    const client = createLlmClient({
      endpoint: 'https://example.com/v1/',
      apiKey: 'test-key',
      defaultModel: 'gpt-test',
      fetchFn,
    });
    const out = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.content).toBe('hello');
    expect(out.promptTokens).toBe(5);
    expect(out.completionTokens).toBe(1);
    expect(out.finishReason).toBe('stop');
  });

  it('throws LlmError on non-2xx', async () => {
    const fetchFn = mockFetch(() => new Response('boom', { status: 500 }));
    const client = createLlmClient({
      endpoint: 'https://example.com/v1',
      apiKey: 'test-key',
      defaultModel: 'm',
      fetchFn,
    });
    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('chatJson parses content with the given Zod schema', async () => {
    const fetchFn = mockFetch(async (req) => {
      const body = await req.json();
      expect(body.response_format).toEqual({ type: 'json_object' });
      return jsonResponse({
        model: 'm',
        choices: [
          {
            message: { role: 'assistant', content: '{"slug":"foo","zh":"测试"}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      });
    });
    const client = createLlmClient({
      endpoint: 'https://example.com/v1',
      apiKey: 'test-key',
      defaultModel: 'm',
      fetchFn,
    });
    const schema = z.object({ slug: z.string(), zh: z.string() });
    const result = await client.chatJson(
      { messages: [{ role: 'user', content: 'json please' }] },
      schema,
    );
    expect(result).toEqual({ slug: 'foo', zh: '测试' });
  });

  it('passes maxTokens as max_tokens', async () => {
    const fetchFn = mockFetch(async (req) => {
      const body = await req.json();
      expect(body.max_tokens).toBe(1234);
      return jsonResponse({
        choices: [
          { message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' },
        ],
      });
    });
    const client = createLlmClient({
      endpoint: 'https://example.com/v1',
      apiKey: 'test-key',
      defaultModel: 'm',
      fetchFn,
    });
    await client.chat({ messages: [{ role: 'user', content: '...' }], maxTokens: 1234 });
  });

  it('uses Mimo-compatible max_completion_tokens for Mimo endpoints', async () => {
    const fetchFn = mockFetch(async (req) => {
      const body = await req.json();
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(8192);
      expect(body.response_format).toEqual({ type: 'json_object' });
      return jsonResponse({
        model: 'mimo-v2.5-pro',
        choices: [
          { message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' },
        ],
      });
    });
    const client = createLlmClient({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      defaultModel: 'mimo-v2.5-pro',
      fetchFn,
    });
    const out = await client.chat({
      messages: [{ role: 'user', content: 'json please' }],
      maxTokens: 8192,
      responseFormat: 'json_object',
    });
    expect(out.content).toBe('{"ok":true}');
  });
});

describe('countChineseChars', () => {
  it('counts CJK + latin, excludes whitespace', () => {
    expect(countChineseChars('  hello 世界  ')).toBe(7);
    expect(countChineseChars('一二三')).toBe(3);
    expect(countChineseChars('')).toBe(0);
  });
});

describe('LLM config singleton', () => {
  afterEach(() => resetLlmClientForTests());

  it('setLlmConfig 更新 currentConfig 并使下次 getLlmClient 用新配置', () => {
    setLlmConfig({
      endpoint: 'https://a.example.com',
      apiKey: 'key-a',
      model: 'm-a',
    });
    expect(getCurrentLlmConfig()).toEqual({
      endpoint: 'https://a.example.com',
      apiKey: 'key-a',
      model: 'm-a',
    });

    setLlmConfig({
      endpoint: 'https://b.example.com',
      apiKey: 'key-b',
      model: 'm-b',
    });
    expect(getCurrentLlmConfig()?.endpoint).toBe('https://b.example.com');
  });

  it('setLlmConfig 缺 endpoint / apiKey 时抛错', () => {
    expect(() =>
      setLlmConfig({ endpoint: '', apiKey: 'k', model: 'm' }),
    ).toThrow(/endpoint/);
    expect(() =>
      setLlmConfig({ endpoint: 'https://x', apiKey: '', model: 'm' }),
    ).toThrow(/apiKey/);
  });

  it('resetLlmClientForTests 清掉 cache + currentConfig', () => {
    setLlmConfig({ endpoint: 'https://x', apiKey: 'k', model: 'm' });
    expect(getCurrentLlmConfig()).toBeDefined();
    resetLlmClientForTests();
    expect(getCurrentLlmConfig()).toBeUndefined();
  });
});

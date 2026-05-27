import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, llmCalls, runs, toolCalls } from '../db/schema/index.ts';
import { runHarnessedAgent } from './run-tracer.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import type { ToolDef } from './harness-tools.ts';

let bookId: string;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__harness-loop-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

beforeEach(() => {
  process.env.LLM_API_ENDPOINT = 'https://test.invalid/v1';
  process.env.LLM_API_KEY = 'fake-key';
  resetLlmClientForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(process.env, ORIG_ENV);
  resetLlmClientForTests();
});

function buildResponse(json: unknown) {
  return new Response(
    JSON.stringify({
      model: 'fake',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(json) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const PingArgs = z.object({ msg: z.string() });
const FinishArgs = z.object({ value: z.number() });

const tools: ToolDef[] = [
  {
    name: 'ping',
    description: 'echo back',
    argSchema: PingArgs,
    isTerminal: false,
    async execute(args) {
      const a = args as z.infer<typeof PingArgs>;
      return { resultMd: `pong: ${a.msg}` };
    },
  },
  {
    name: 'finish',
    description: 'terminal',
    argSchema: FinishArgs,
    isTerminal: true,
    async execute(args) {
      return { resultMd: 'done', terminalPayload: args };
    },
  },
];

describe('runHarnessedAgent', () => {
  it('drives a tool-use loop, persists tool_calls and llm_calls, exits on terminal', async () => {
    const responses = [
      buildResponse({ thought: '看一下', tool: 'ping', args: { msg: 'hi' } }),
      buildResponse({ thought: '再来一次', tool: 'ping', args: { msg: 'again' } }),
      buildResponse({ thought: '完成', tool: 'finish', args: { value: 42 } }),
    ];
    let idx = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const r = responses[idx++];
      if (!r) throw new Error('out of mock responses');
      return r;
    });

    const out = await runHarnessedAgent<{ value: number }>({
      kind: 'test-harness',
      bookId,
      input: { x: 1 },
      systemPrompt: 'you are a test agent',
      userPrompt: 'do the thing',
      tools,
      terminalToolNames: ['finish'],
      toolContext: { session: null },
      maxToolCalls: 10,
    });

    expect(out.result.value).toBe(42);
    expect(out.toolCallCount).toBe(3); // ping, ping, finish
    expect(out.turns).toBe(3);

    // 检查 DB 持久化
    const llmRows = await db.select().from(llmCalls).where(eq(llmCalls.runId, out.runId));
    expect(llmRows.length).toBe(3);

    const toolRows = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, out.runId))
      .orderBy(toolCalls.seq);
    expect(toolRows.length).toBe(3);
    expect(toolRows.map((r) => r.toolName)).toEqual(['ping', 'ping', 'finish']);
    expect(toolRows[0]!.resultMd).toBe('pong: hi');
    expect(toolRows[1]!.resultMd).toBe('pong: again');
    expect(toolRows[2]!.resultMd).toBe('done');

    // 每个 tool_call 都有 parent_llm_call_id 指向某个 llm_call
    for (const t of toolRows) {
      expect(t.parentLlmCallId).toBeTruthy();
      expect(llmRows.find((l) => l.id === t.parentLlmCallId)).toBeDefined();
    }

    const [run] = await db.select().from(runs).where(eq(runs.id, out.runId));
    expect(run!.status).toBe('success');
    expect(run!.finishedAt).not.toBeNull();
  });

  it('feeds back tool error to model and keeps looping (unknown tool)', async () => {
    const responses = [
      buildResponse({ thought: '试一下', tool: 'unknown-tool', args: {} }),
      buildResponse({ thought: '改正', tool: 'finish', args: { value: 7 } }),
    ];
    let idx = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const r = responses[idx++];
      if (!r) throw new Error('out of mock responses');
      return r;
    });

    const out = await runHarnessedAgent<{ value: number }>({
      kind: 'test-harness-err',
      bookId,
      input: {},
      systemPrompt: 'sys',
      userPrompt: 'do it',
      tools,
      terminalToolNames: ['finish'],
      toolContext: { session: null },
    });

    expect(out.result.value).toBe(7);
    expect(out.toolCallCount).toBe(2);
    const toolRows = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, out.runId))
      .orderBy(toolCalls.seq);
    expect(toolRows[0]!.toolName).toBe('unknown-tool');
    expect(toolRows[0]!.errorMd).toMatch(/未知工具/);
    expect(toolRows[1]!.toolName).toBe('finish');
  });

  it('throws when maxToolCalls is exceeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      buildResponse({ thought: 'loop', tool: 'ping', args: { msg: 'x' } }),
    );

    await expect(
      runHarnessedAgent({
        kind: 'test-harness-cap',
        bookId,
        input: {},
        systemPrompt: 'sys',
        userPrompt: 'go',
        tools,
        terminalToolNames: ['finish'],
        toolContext: { session: null },
        maxToolCalls: 3,
      }),
    ).rejects.toThrow(/maxToolCalls=3/);

    // run 应当 failure
    const recent = await db
      .select()
      .from(runs)
      .where(eq(runs.kind, 'test-harness-cap'))
      .orderBy(runs.createdAt);
    const last = recent[recent.length - 1];
    expect(last?.status).toBe('failure');
  });
});

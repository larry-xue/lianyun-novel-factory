import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import { runBrainstormHarness } from './brainstorm-harness.ts';

let bookId: string;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__brainstorm-test ${Date.now()}` })
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

function mockResponses(jsons: unknown[]) {
  let idx = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const j = jsons[idx++];
    if (j === undefined) throw new Error('out of mock responses');
    return new Response(
      JSON.stringify({
        model: 'fake',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(j) }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

describe('brainstorm-harness', () => {
  it('grep_kb → pin_decision → ask_user 三步走，返回 ask_user terminal', async () => {
    mockResponses([
      {
        thought: '看看分类清单',
        tool: 'read_kb',
        args: { path: '/classification/main.md' },
      },
      {
        thought: '用户提了都市重生，pin 主分类',
        tool: 'pin_decision',
        args: {
          key: 'mainCategory',
          value: '都市种田',
          reasonMd: '用户描述符合都市种田',
        },
      },
      {
        thought: '问下一个问题：每章字数偏好',
        tool: 'ask_user',
        args: {
          replyMd: '我把主分类先定在「都市种田」。下一个问题：你想要每章多少字？',
          widget: {
            kind: 'multi-choice',
            header: '字数偏好',
            question: '每章目标字数？',
            options: [
              { label: '2500 字', description: '更紧凑' },
              { label: '3000 字', description: '推荐' },
              { label: '3500 字', description: '更舒展' },
            ],
          },
        },
      },
    ]);

    const out = await runBrainstormHarness({
      bookId,
      decisions: {},
      history: [
        { role: 'user', contentMd: '想写一本社畜重生 + 末世囤货的书。' },
      ],
      systemPrompt: '你是 brainstorm scout。',
    });

    expect(out.terminal.kind).toBe('ask_user');
    if (out.terminal.kind === 'ask_user') {
      expect(out.terminal.payload.widget.kind).toBe('multi-choice');
      expect(out.terminal.payload.replyMd).toContain('都市种田');
    }
    expect(out.decisions.mainCategory).toBe('都市种田');
    expect(out.reasons.mainCategory).toContain('都市种田');
    expect(out.toolCallCount).toBe(3);
  });

  it('confirm_topic 终止时返回 brief 和 summaryMd', async () => {
    mockResponses([
      {
        thought: '决策都齐了，给最终 brief',
        tool: 'confirm_topic',
        args: {
          replyMd: '我整理了一份 brief，看看？',
          brief: {
            mainCategory: '都市种田',
            elementSlugs: ['rebirth', 'system'],
            themes: ['末日求生'],
            characterTypes: [],
            plotElements: ['囤物资'],
            targetAudience: '男频，25-35 岁',
            coreConflictMd: '社畜重生回末世前 7 天，囤货抢险。',
            synopsisMd:
              '社畜林岩重生回到末日丧尸潮爆发前 7 天，凭着前世记忆抢先囤物资、训队友、抢据点。' +
              '面对前世害死自己的小区物业 + 旧公司同事这两条暗线，他要把混乱的"前 7 天"做成自己上岸的跳板。' +
              '主线走囤货 → 立威 → 收编 → 反杀的爽文路线，节奏紧、爽点密。',
            totalChapters: 20,
            charsPerChapter: 3000,
            forbiddenMd: '不要血腥；不要恋爱主线',
            proposedTitle: '末世前的最后七天',
          },
          summaryMd: '## 书名\n《末世前的最后七天》\n\n## 主线\n...\n',
        },
      },
    ]);

    const initialDecisions = {
      mainCategory: '都市种田',
      elementSlugs: ['rebirth', 'system'],
      targetAudience: '男频',
      coreConflictMd: '社畜重生末世前',
      charsPerChapter: 3000,
      totalChapters: 20,
      proposedTitle: '末世前的最后七天',
    };

    const out = await runBrainstormHarness({
      bookId,
      decisions: initialDecisions,
      history: [
        { role: 'user', contentMd: '基本想法上面都聊过了。' },
      ],
      systemPrompt: '你是 brainstorm scout。',
    });

    expect(out.terminal.kind).toBe('confirm_topic');
    if (out.terminal.kind === 'confirm_topic') {
      expect(out.terminal.payload.brief.proposedTitle).toBe('末世前的最后七天');
      expect(out.terminal.payload.summaryMd).toContain('# ');
    }
  });

  it('未知 widget kind 时 schema 校验失败，agent 被反馈纠错继续', async () => {
    mockResponses([
      {
        thought: '试个错',
        tool: 'ask_user',
        args: {
          replyMd: '问个问题',
          widget: { kind: 'wrong-widget', header: 'h', question: 'q' },
        },
      },
      {
        thought: '改正',
        tool: 'ask_user',
        args: {
          replyMd: '换正确格式',
          widget: {
            kind: 'free-text',
            header: '冲突',
            question: '主角的核心痛点是什么？',
          },
        },
      },
    ]);

    const out = await runBrainstormHarness({
      bookId,
      decisions: {},
      history: [{ role: 'user', contentMd: 'go' }],
      systemPrompt: '你是 brainstorm scout。',
    });

    expect(out.terminal.kind).toBe('ask_user');
    expect(out.toolCallCount).toBe(2); // 第一个工具 schema 失败 + 第二个成功
  });

  it('pin / unpin 决策能正确累积和移除', async () => {
    mockResponses([
      {
        thought: '先 pin a',
        tool: 'pin_decision',
        args: { key: 'a', value: 'A', reasonMd: 'because' },
      },
      {
        thought: '再 pin b',
        tool: 'pin_decision',
        args: { key: 'b', value: 'B' },
      },
      {
        thought: 'unpin a',
        tool: 'unpin_decision',
        args: { key: 'a' },
      },
      {
        thought: '问下一个',
        tool: 'ask_user',
        args: {
          replyMd: '继续',
          widget: { kind: 'free-text', header: 'x', question: '下一题？' },
        },
      },
    ]);

    const out = await runBrainstormHarness({
      bookId,
      decisions: {},
      history: [{ role: 'user', contentMd: 'start' }],
      systemPrompt: '你是 brainstorm scout。',
    });

    expect(out.decisions).toEqual({ b: 'B' });
    expect(out.reasons.a).toBeUndefined();
  });
});

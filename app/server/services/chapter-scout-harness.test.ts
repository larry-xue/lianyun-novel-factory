import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import { runChapterScoutHarness } from './chapter-scout-harness.ts';

let bookId: string;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__chapter-scout-test ${Date.now()}` })
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

describe('chapter-scout-harness', () => {
  it('list → pin_decision → ask_user 三步走', async () => {
    mockResponses([
      {
        thought: '看看这本书都有什么资料',
        tool: 'list',
        args: { path: '' },
      },
      {
        thought: '用户说要走主线推进，pin intent',
        tool: 'pin_decision',
        args: {
          key: 'intent',
          value: '推进主线：揭露反派身份',
          reasonMd: '用户明确要求',
        },
      },
      {
        thought: '问一下章末钩子风格',
        tool: 'ask_user',
        args: {
          replyMd: '主线推进我先记下了。下一个问题：本章末钩子用哪种风格？',
          widget: {
            kind: 'multi-choice',
            header: '章末钩子',
            question: '本章末用哪种钩子？',
            options: [
              { label: '动作冲突', description: '反派现身打断' },
              { label: '信息揭露', description: '主角发现关键线索' },
              { label: '情感转折', description: '盟友倒戈' },
            ],
          },
        },
      },
    ]);

    const out = await runChapterScoutHarness({
      bookId,
      chapterIdx: 6,
      decisions: {},
      history: [{ role: 'user', contentMd: '本章我想推主线，揭穿反派。' }],
      systemPrompt: '你是 chapter-scout。',
    });

    expect(out.terminal.kind).toBe('ask_user');
    if (out.terminal.kind === 'ask_user') {
      expect(out.terminal.payload.widget.kind).toBe('multi-choice');
    }
    expect(out.decisions.intent).toBe('推进主线：揭露反派身份');
    expect(out.reasons.intent).toContain('用户');
    expect(out.toolCallCount).toBe(3);
  });

  it('confirm_beat 终止时返回 beat + summaryMd', async () => {
    mockResponses([
      {
        thought: '决策都齐了，给最终 beat',
        tool: 'confirm_beat',
        args: {
          replyMd: '我整理了一份本章规划，看看？',
          beat: {
            title: '反派现身',
            summaryMd:
              '主角在调查档案时遇上反派A的伏击；激战后被反派B救下，意识到反派阵营内部有分裂。' +
              '本章末反派A威胁要在三天内取主角性命。',
            intent: '把反派阵营从单一威胁拆成两条线，为后续阵营内斗埋线；同时让主角第一次正面接触反派B。',
            twist: '反派B出手救主角，暗示阵营内部有裂痕。',
            anchors: ['主角第一次正面接触反派B', '反派A威胁三天内动手'],
          },
          summaryMd: '## 本章规划\n《反派现身》\n\n## 主线\n阵营内斗的伏笔...\n',
        },
      },
    ]);

    const initialDecisions = {
      title: '反派现身',
      summaryMd: '反派A伏击主角',
      intent: '揭穿反派阵营内部有裂痕',
    };

    const out = await runChapterScoutHarness({
      bookId,
      chapterIdx: 6,
      decisions: initialDecisions,
      history: [{ role: 'user', contentMd: '基本想法上面都聊过了。' }],
      systemPrompt: '你是 chapter-scout。',
    });

    expect(out.terminal.kind).toBe('confirm_beat');
    if (out.terminal.kind === 'confirm_beat') {
      expect(out.terminal.payload.beat.title).toBe('反派现身');
      expect(out.terminal.payload.beat.anchors).toHaveLength(2);
      expect(out.terminal.payload.summaryMd).toContain('# ');
    }
  });

  it('pin / unpin 决策能正确累积和移除', async () => {
    mockResponses([
      { thought: '先 pin title', tool: 'pin_decision', args: { key: 'title', value: 'A' } },
      { thought: '再 pin summary', tool: 'pin_decision', args: { key: 'summaryMd', value: 'B 章节纲要' } },
      { thought: 'unpin title', tool: 'unpin_decision', args: { key: 'title' } },
      {
        thought: '问下一题',
        tool: 'ask_user',
        args: {
          replyMd: '继续',
          widget: { kind: 'free-text', header: '继续', question: '下一题？' },
        },
      },
    ]);

    const out = await runChapterScoutHarness({
      bookId,
      chapterIdx: 3,
      decisions: {},
      history: [{ role: 'user', contentMd: 'start' }],
      systemPrompt: '你是 chapter-scout。',
    });

    expect(out.decisions).toEqual({ summaryMd: 'B 章节纲要' });
    expect(out.reasons.title).toBeUndefined();
  });
});

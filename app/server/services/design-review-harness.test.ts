import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookDocs, books } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import { runDesignReviewHarness } from './design-review-harness.ts';
import { upsertDoc } from './book-docs.ts';

let bookId: string;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__design-review-test ${Date.now()}` })
    .returning();
  bookId = b!.id;

  // 预置 vault：模拟 story-designer 自由 fanout 出来的活文档
  // （kind 自由：character / world / style / relations，与生产环境真实落库 schema 一致）
  await upsertDoc({
    bookId,
    kind: 'character',
    slug: 'lin-an',
    title: '林岸 - 主角',
    contentMd:
      '# 林岸\n\n## 基本信息\n冷静务实的社畜，被裁员的程序员。\n\n## 核心动机\n靠囤货抢先翻盘。',
    editor: 'agent',
  });
  await upsertDoc({
    bookId,
    kind: 'world',
    slug: 'setting',
    title: '世界观设定',
    contentMd: '# 世界观设定\n\n## 时代背景\n近未来都市末世，三天后异变爆发。',
    editor: 'agent',
  });
  await upsertDoc({
    bookId,
    kind: 'style',
    slug: 'voice',
    title: '风格与叙事腔调',
    contentMd: '# 风格\n\n## 调性\n冷静中带紧张感，第三人称限知。',
    editor: 'agent',
  });
  await upsertDoc({
    bookId,
    kind: 'relations',
    slug: 'character-relations',
    title: '角色关系图',
    contentMd: '# 角色关系\n\n```mermaid\ngraph LR\n  LA[林岸] --> SN[苏宁]\n```',
    editor: 'agent',
  });
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

describe('design-review-harness', () => {
  it('list_doc → read_doc → ask_user 软终止；返回 widget', async () => {
    mockResponses([
      {
        thought: '先 list 看 vault 全貌',
        tool: 'list_doc',
        args: {},
      },
      {
        thought: '读主角',
        tool: 'read_doc',
        args: { path: 'docs/character/lin-an' },
      },
      {
        thought: '给摘要 + 问要不要改',
        tool: 'ask_user',
        args: {
          replyMd: '主角林岸，重生囤货爽文。哪里要改？',
          widget: {
            kind: 'multi-choice',
            header: 'review',
            question: '哪里要动？',
            options: [
              { label: '整体不错，开始写', description: '直接 start_writing' },
              { label: '改一下角色', description: 'update character' },
              { label: '改一下世界观', description: 'update world' },
              { label: '改一下风格', description: 'update style' },
            ],
          },
        },
      },
    ]);

    const out = await runDesignReviewHarness({
      bookId,
      history: [],
      systemPrompt: '你是 design-review。',
    });

    expect(out.terminal.kind).toBe('ask_user');
    if (out.terminal.kind === 'ask_user') {
      expect(out.terminal.payload.widget.kind).toBe('multi-choice');
      expect(out.terminal.payload.replyMd).toContain('林岸');
    }
    expect(out.toolCallCount).toBe(3);
  });

  it('list_doc 能列出真实 vault 的 path（不再依赖 kind=design）', async () => {
    mockResponses([
      {
        thought: '只看 character kind',
        tool: 'list_doc',
        args: { kind: 'character' },
      },
      {
        thought: '问下一题',
        tool: 'ask_user',
        args: {
          replyMd: '角色清单收到',
          widget: {
            kind: 'free-text',
            header: 'review',
            question: '想改哪？',
            placeholder: '说一句具体诉求…',
          },
        },
      },
    ]);

    const out = await runDesignReviewHarness({
      bookId,
      history: [],
      systemPrompt: '你是 design-review。',
    });

    expect(out.terminal.kind).toBe('ask_user');
    expect(out.toolCallCount).toBe(2);
  });

  it('update_doc 改 character/lin-an，落盘后 contentMd 真的换了', async () => {
    mockResponses([
      {
        thought: '先 read 一下原文',
        tool: 'read_doc',
        args: { path: 'docs/character/lin-an' },
      },
      {
        thought: '把主角性格改强势',
        tool: 'update_doc',
        args: {
          path: 'docs/character/lin-an',
          title: '林岸 - 主角',
          contentMd:
            '# 林岸\n\n## 基本信息\n强势果决的社畜，前世吃了软弱的亏，重生后心态完全变了——出手稳准狠。\n\n## 核心动机\n靠囤货抢先翻盘 + 报前世仇。',
          reasonMd: '用户说主角太软',
        },
      },
      {
        thought: '让用户看新版',
        tool: 'ask_user',
        args: {
          replyMd: '改完了，主角现在偏强势。还要再改吗？',
          widget: {
            kind: 'multi-choice',
            header: 'review',
            question: '满意吗？',
            options: [
              { label: 'OK，开写', description: '' },
              { label: '再调一下', description: '' },
            ],
          },
        },
      },
    ]);

    const out = await runDesignReviewHarness({
      bookId,
      history: [{ role: 'user', contentMd: '主角性格太软弱了，改成更强势的' }],
      systemPrompt: '你是 design-review。',
    });

    expect(out.terminal.kind).toBe('ask_user');

    const [doc] = await db
      .select({ contentMd: bookDocs.contentMd })
      .from(bookDocs)
      .where(
        and(
          eq(bookDocs.bookId, bookId),
          eq(bookDocs.kind, 'character'),
          eq(bookDocs.slug, 'lin-an'),
        ),
      );
    expect(doc!.contentMd).toContain('强势果决');
    expect(doc!.contentMd).not.toContain('冷静务实');
  });

  it('start_writing 硬终止，gateMode 透传', async () => {
    mockResponses([
      {
        thought: '用户说 OK，给 confirm 摘要',
        tool: 'start_writing',
        args: {
          replyMd: '那就按这个开写了',
          summaryMd:
            '## 即将开写\n- 主角：林岸（重生囤货）\n- 世界观：近未来末世\n- 风格：冷静紧张\n- 章数：20 章 × 3000 字\n- gateMode: auto-with-confirm',
          gateMode: 'auto-with-confirm',
        },
      },
    ]);

    const out = await runDesignReviewHarness({
      bookId,
      history: [{ role: 'user', contentMd: '看完了，可以开写' }],
      systemPrompt: '你是 design-review。',
    });

    expect(out.terminal.kind).toBe('start_writing');
    if (out.terminal.kind === 'start_writing') {
      expect(out.terminal.payload.gateMode).toBe('auto-with-confirm');
      expect(out.terminal.payload.summaryMd).toContain('林岸');
    }
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookDocs, books } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import { runStoryDesignerHarness } from './story-designer-harness.ts';

let bookId: string;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__story-designer-test ${Date.now()}` })
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
    if (j === undefined) throw new Error(`out of mock responses (idx=${idx - 1}, total=${jsons.length})`);
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

const validBrief = {
  loglineMd: '社畜林岸末日重生回三天前，靠记忆囤货抢先翻盘，最终带家人逃出生天。',
  audience: '都市末世重生流读者，喜欢冷静筹谋型主角和"先知优势"爽感。',
  mainArcMd:
    '开端：林岸末日中绝望被同事捅刀身死，意识穿回末日前三天。中段：他冷静利用前世记忆囤货并构建小圈子，与试图夺权的旧同事正面冲突；又遇到神秘组织。高潮：末日机制揭露——这不是天灾而是某势力的实验。收尾：林岸联合幸存者反向利用机制反推真相，建立长期生存据点。',
  protagonistName: '林岸',
  prohibitedTropes: [
    '不要引入修真飞升',
    '不要降智反派',
    '不要主角后宫',
    '不要主角无脑发疯',
  ],
};

const fourMinDocs = (path: string, title: string, idx: number) => ({
  thought: `写第 ${idx} 份 doc`,
  tool: 'update_doc',
  args: {
    path,
    title,
    contentMd: `# ${title}\n\n这是 ${title} 的初版内容（占位 40+ 字符以满足下限要求）。它包含足够的细节供下游 prompt 静态区消费。`,
    reasonMd: '立项',
  },
});

describe('story-designer-harness', () => {
  it('happy path: 4 硬底线 doc + submit_design 落 books + book_docs', async () => {
    mockResponses([
      fourMinDocs('docs/character/lin-an', '林岸 · 角色卡', 1),
      fourMinDocs('docs/world/setting', '世界观 · 背景', 2),
      fourMinDocs('docs/world/rules', '世界硬规则', 3),
      fourMinDocs('docs/relations/character-relations', '初版关系图', 4),
      {
        thought: '4 份硬底线就位，提交 brief',
        tool: 'submit_design',
        args: {
          brief: validBrief,
          summaryMd:
            '# 整本书速览\n\n- 主角：林岸\n- 主线：末日重生囤货 + 反向利用机制\n- 红线：不修真 / 不无脑发疯',
        },
      },
    ]);

    const out = await runStoryDesignerHarness({
      bookId,
      contextPrompt: '## 立项 brief\n书名：末日囤货指南\n钩子：重生回末日前三天',
      systemPrompt: '你是 story-designer harness。',
    });

    expect(out.docsCommitted).toHaveLength(4);
    expect(out.docsCommitted).toEqual(
      expect.arrayContaining([
        'character/lin-an',
        'world/setting',
        'world/rules',
        'relations/character-relations',
      ]),
    );
    expect(out.brief.protagonistName).toBe('林岸');

    const [b] = await db.select().from(books).where(eq(books.id, bookId));
    expect(b!.protagonist).toBe('林岸');
    expect(b!.loglineMd).toContain('林岸');
    expect(b!.audience).toContain('都市末世');
    expect(b!.mainArcMd).toContain('实验');
    expect(b!.prohibitedTropes).toContain('不要引入修真飞升');

    const docs = await db
      .select({ kind: bookDocs.kind, slug: bookDocs.slug })
      .from(bookDocs)
      .where(eq(bookDocs.bookId, bookId));
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => `${d.kind}/${d.slug}`).sort()).toEqual([
      'character/lin-an',
      'relations/character-relations',
      'world/rules',
      'world/setting',
    ]);
  });

  it('submit_design 拒绝硬底线缺失（缺 world/rules）', async () => {
    const longSummary =
      '## 速览\n本书设计已就绪：主角林岸，主线末日重生囤货反推真相。\n红线：不修真、不无脑、不降智反派、不主角后宫。\n章数 20 × 3000 字。';
    mockResponses([
      fourMinDocs('docs/character/proto', '主角', 1),
      fourMinDocs('docs/world/setting', '世界', 2),
      fourMinDocs('docs/relations/character-relations', '关系', 3),
      {
        thought: '我直接交吧（应被硬底线缺 world/rules 拒绝）',
        tool: 'submit_design',
        args: { brief: validBrief, summaryMd: longSummary },
      },
      // 被拒后续 turn 补齐 world/rules 再 submit
      fourMinDocs('docs/world/rules', '世界硬规则', 4),
      {
        thought: '4 份齐了再提交',
        tool: 'submit_design',
        args: { brief: validBrief, summaryMd: longSummary },
      },
    ]);

    const out = await runStoryDesignerHarness({
      bookId,
      contextPrompt: '## brief\n测试',
      systemPrompt: '你是 story-designer harness。',
    });
    expect(out.docsCommitted).toHaveLength(4);
    expect(out.docsCommitted).toEqual(
      expect.arrayContaining(['world/rules']),
    );
  });

  it('update_doc 拒绝禁止 kind（style/* / *-design/* / story-concept/*）', async () => {
    const longSummary =
      '## 速览\n禁止 kind 测试：style/* 应被拒。\n章数 20 × 3000 字测试。';
    mockResponses([
      // 1. agent 试图写 style/voice → 被禁
      {
        thought: '我试图写风格（应被禁）',
        tool: 'update_doc',
        args: {
          path: 'docs/style/voice',
          title: '风格',
          contentMd: '占位 40+ 字符占位 40+ 字符占位 40+ 字符占位 40+ 字符',
          reasonMd: 'oops',
        },
      },
      // 2. agent 试图写 character-design/* → 被禁
      {
        thought: '试 design 草稿层（应被禁）',
        tool: 'update_doc',
        args: {
          path: 'docs/character-design/blueprint',
          title: '蓝图',
          contentMd: '占位 40+ 字符占位 40+ 字符占位 40+ 字符占位 40+ 字符',
          reasonMd: 'oops',
        },
      },
      // 3. agent 试图写 story-concept → 被禁
      {
        thought: '试 story-concept（应被禁）',
        tool: 'update_doc',
        args: {
          path: 'docs/story-concept/core',
          title: '故事概念',
          contentMd: '占位 40+ 字符占位 40+ 字符占位 40+ 字符占位 40+ 字符',
          reasonMd: 'oops',
        },
      },
      // 4-7. 改为合法的 4 份硬底线
      fourMinDocs('docs/character/lin-er', '林二 · 角色卡', 1),
      fourMinDocs('docs/world/setting', '世界', 2),
      fourMinDocs('docs/world/rules', '世界规则', 3),
      fourMinDocs('docs/relations/character-relations', '关系', 4),
      {
        thought: '齐了',
        tool: 'submit_design',
        args: { brief: validBrief, summaryMd: longSummary },
      },
    ]);

    const out = await runStoryDesignerHarness({
      bookId,
      contextPrompt: '## brief\n禁止 kind 测试',
      systemPrompt: '你是 story-designer harness。',
    });
    expect(out.docsCommitted).toHaveLength(4);
    // 确认禁止 kind 的 doc 完全没有落库
    expect(out.docsCommitted).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^style\//),
        expect.stringMatching(/-design\//),
        expect.stringMatching(/^story-concept\//),
      ]),
    );
  });

  it('update_doc 拒绝 slug 末尾 /；嵌套 slug 通过', async () => {
    const longSummary =
      '## 速览\n含嵌套 slug 测试：character/lin-er + world/factions/tianhua-zong + world/rules + relations。\n章数 20 × 3000 字。';
    mockResponses([
      {
        thought: '不小心给了非法 path',
        tool: 'update_doc',
        args: {
          path: 'docs/world/factions/',
          title: 'x',
          contentMd: '占位 40+ 字符占位 40+ 字符占位 40+ 字符占位 40+ 字符',
          reasonMd: 'oops',
        },
      },
      fourMinDocs('docs/character/lin-er', '林二 · 角色卡', 1),
      fourMinDocs('docs/world/factions/tianhua-zong', '天华宗', 2),
      fourMinDocs('docs/world/setting', '世界', 3),
      fourMinDocs('docs/world/rules', '世界规则', 4),
      fourMinDocs('docs/relations/character-relations', '关系', 5),
      {
        thought: '齐了',
        tool: 'submit_design',
        args: { brief: validBrief, summaryMd: longSummary },
      },
    ]);

    const out = await runStoryDesignerHarness({
      bookId,
      contextPrompt: '## brief\n嵌套 slug 测试',
      systemPrompt: '你是 story-designer harness。',
    });
    expect(out.docsCommitted).toEqual(
      expect.arrayContaining(['world/factions/tianhua-zong']),
    );
  });
});

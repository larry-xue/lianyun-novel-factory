import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookBriefs, bookDocs, books, topicCards } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';
import { designForExistingBook, produceBook } from './book-producer.ts';

describe('produceBook input validation', () => {
  it('rejects empty pitch', async () => {
    await expect(
      produceBook({ topicTitle: '试', pitch: '', elementSlugs: ['post-apocalypse'] }),
    ).rejects.toThrow();
  });

  it('rejects empty elementSlugs', async () => {
    await expect(
      produceBook({ topicTitle: '试', pitch: '一段够长的描述', elementSlugs: [] }),
    ).rejects.toThrow();
  });

  it('rejects totalChapters out of range', async () => {
    await expect(
      produceBook({
        topicTitle: '试',
        pitch: '一段够长的描述',
        elementSlugs: ['post-apocalypse'],
        totalChapters: 9999,
      }),
    ).rejects.toThrow();
  });
});

describe('designForExistingBook', () => {
  const ORIG_ENV = { ...process.env };
  const created: { bookId?: string; topicCardId?: string } = {};

  beforeAll(async () => {
    const [tc] = await db
      .insert(topicCards)
      .values({
        title: `__design-test ${Date.now()}`,
        hook: '末世重生囤货爽文',
        elementSlugs: ['rebirth', 'post-apocalypse'],
        targetAudience: '都市男频',
        mainCategory: '都市种田',
        themes: [],
        characterTypes: [],
        plotElements: [],
        status: 'approved',
        score: {} as Record<string, unknown>,
        scoreOverall: 0,
        notesMd: '末世到来，社畜重生回三天前，靠记忆抢先囤货走上人生巅峰。',
      })
      .returning();
    created.topicCardId = tc!.id;

    const [b] = await db
      .insert(books)
      .values({
        title: `__design-test ${Date.now()}`,
        elementSlugs: ['rebirth', 'post-apocalypse'],
        mainCategory: '都市种田',
        themes: [],
        characterTypes: [],
        plotElements: [],
        topicCardId: tc!.id,
      })
      .returning();
    created.bookId = b!.id;

    await db.insert(bookBriefs).values({
      bookId: b!.id,
      briefIdeaMd: '末世重生爽文，主角靠记忆抢先囤货，节奏要快。',
      targetTotalChapters: 20,
      targetCharsPerChapter: 3000,
    });
  });

  afterAll(async () => {
    if (created.bookId) await db.delete(books).where(eq(books.id, created.bookId));
    if (created.topicCardId)
      await db.delete(topicCards).where(eq(topicCards.id, created.topicCardId));
  });

  beforeEach(() => {
    process.env.LLM_API_ENDPOINT = 'https://test.invalid/v1';
    process.env.LLM_API_KEY = 'fake-key';
    resetLlmClientForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(process.env, ORIG_ENV);
    resetLlmClientForTests();
    if (created.bookId) {
      await db.delete(bookDocs).where(eq(bookDocs.bookId, created.bookId));
    }
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
            {
              message: { role: 'assistant', content: JSON.stringify(j) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  }

  const docTurn = (path: string, title: string, idx: number) => ({
    thought: `写第 ${idx} 份 doc`,
    tool: 'update_doc',
    args: {
      path,
      title,
      contentMd: `# ${title}\n\n占位 40+ 字符占位 40+ 字符占位 40+ 字符占位 40+ 字符\n本 doc 由测试 mock 注入，内容简短但满足下限要求。`,
      reasonMd: '立项',
    },
  });

  const validBrief = {
    loglineMd: '社畜林岸末日重生回三天前，靠记忆囤货抢先翻盘，最终带家人逃出生天。',
    audience: '都市末世重生流读者，喜欢冷静筹谋型主角和"先知优势"爽感。',
    mainArcMd:
      '开端：林岸末日中绝望被同事捅刀身死，意识穿回末日前三天，醒来时还以为是噩梦。中段：他冷静利用前世记忆囤货并构建小圈子，与试图夺权的旧同事正面冲突，并意外卷入一个名为"红雨观察组"的隐秘组织。高潮：末日机制揭露——这不是天灾而是某势力为筛选幸存者的实验。收尾：林岸联合幸存者反向利用机制反推真相，建立长期生存据点，并把家人接进安全区。',
    protagonistName: '林岸',
    prohibitedTropes: ['不要引入修真飞升', '不要降智反派', '不要主角后宫', '不要主角无脑发疯'],
  };

  const longSummary =
    '## 速览\n本书设计已就绪：主角林岸，主线末日重生囤货反推真相，风格冷静紧张。\n红线：不修真、不无脑、不降智反派、不主角后宫。\n章数 20 × 3000 字。';

  it('落 vault 活文档 + brief 字段进 books 表', async () => {
    mockResponses([
      docTurn('docs/character/lin-an', '林岸 · 角色卡', 1),
      docTurn('docs/world/setting', '世界观 · 背景', 2),
      docTurn('docs/world/rules', '世界硬规则', 3),
      docTurn('docs/relations/character-relations', '初版关系图', 4),
      {
        thought: '4 份硬底线就位，提交 brief',
        tool: 'submit_design',
        args: { brief: validBrief, summaryMd: longSummary },
      },
    ]);

    const result = await designForExistingBook({ bookId: created.bookId! });
    expect(result.brief.protagonistName).toBe('林岸');
    expect(result.docsCommitted).toHaveLength(4);

    const [b] = await db.select().from(books).where(eq(books.id, created.bookId!));
    expect(b!.protagonist).toBe('林岸');
    expect(b!.loglineMd).toContain('林岸');
    expect(b!.audience).toContain('都市');
    expect(b!.mainArcMd).toContain('末日');
    expect(b!.prohibitedTropes).toContain('不要引入修真飞升');

    const docs = await db
      .select({ kind: bookDocs.kind, slug: bookDocs.slug })
      .from(bookDocs)
      .where(eq(bookDocs.bookId, created.bookId!));
    const paths = docs.map((d) => `${d.kind}/${d.slug}`).sort();
    expect(paths).toEqual([
      'character/lin-an',
      'relations/character-relations',
      'world/rules',
      'world/setting',
    ]);
  });
});

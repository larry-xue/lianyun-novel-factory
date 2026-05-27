import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  books,
  bookBriefs,
  styleSamples,
  topicNegotiations,
} from '../db/schema/index.ts';
import {
  getBookBrief,
  getNegotiationByBook,
  postUserMessage,
  startBookFromIdea,
} from './topic-negotiations.ts';

const createdBookIds: string[] = [];

afterAll(async () => {
  for (const id of createdBookIds) {
    await db.delete(books).where(eq(books.id, id));
  }
});

describe('topic-negotiations service', () => {
  it('startBookFromIdea creates stub book + brief + negotiation with first user message', async () => {
    const r = await startBookFromIdea({
      briefIdeaMd: '末世重生爽文，主角靠记忆抢先囤货，节奏要快',
      initialPreferences: { targetTotalChapters: 30, targetCharsPerChapter: 2800 },
    });
    createdBookIds.push(r.bookId);

    const [b] = await db.select().from(books).where(eq(books.id, r.bookId));
    expect(b!.status).toBe('planning');
    expect(b!.title).toBe('（立项中）');

    const brief = await getBookBrief(r.bookId);
    expect(brief).not.toBeNull();
    expect(brief!.targetTotalChapters).toBe(30);
    expect(brief!.targetCharsPerChapter).toBe(2800);
    expect(brief!.briefIdeaMd).toContain('末世重生');
    expect(brief!.confirmedAt).toBeNull();

    const neg = await getNegotiationByBook(r.bookId);
    expect(neg!.status).toBe('active');
    expect(neg!.messages).toHaveLength(1);
    expect(neg!.messages[0]!.role).toBe('user');
  });

  it('postUserMessage appends to messages', async () => {
    const r = await startBookFromIdea({ briefIdeaMd: '科幻仙侠混搭，AI 飞升的故事' });
    createdBookIds.push(r.bookId);

    await postUserMessage(r.bookId, '能不能多点轻松感，少点说教');
    const neg = await getNegotiationByBook(r.bookId);
    expect(neg!.messages).toHaveLength(2);
    expect(neg!.messages[1]!.role).toBe('user');
    expect(neg!.messages[1]!.contentMd).toContain('轻松');
  });

  it('postUserMessage rejects empty / blocked when status≠active', async () => {
    const r = await startBookFromIdea({ briefIdeaMd: '测试用立项 idea，足够长' });
    createdBookIds.push(r.bookId);

    await expect(postUserMessage(r.bookId, '   ')).rejects.toThrow();

    // 模拟切到 confirmed 状态
    await db
      .update(topicNegotiations)
      .set({ status: 'confirmed' })
      .where(eq(topicNegotiations.bookId, r.bookId));

    await expect(postUserMessage(r.bookId, '现在还能发吗')).rejects.toThrow();
  });

  it('cascades: deleting book cleans brief + negotiation', async () => {
    const r = await startBookFromIdea({ briefIdeaMd: '级联删除测试 idea，足够长字数' });
    await db.delete(books).where(eq(books.id, r.bookId));

    const brief = await db.select().from(bookBriefs).where(eq(bookBriefs.bookId, r.bookId));
    expect(brief).toHaveLength(0);
    const neg = await db
      .select()
      .from(topicNegotiations)
      .where(eq(topicNegotiations.bookId, r.bookId));
    expect(neg).toHaveLength(0);
  });

  it('startBookFromIdea persists preselected styleSampleIds / elementSlugs', async () => {
    const [s1] = await db
      .insert(styleSamples)
      .values({
        author: '猫腻',
        title: '《将夜》节选',
        contentMd: '宁缺立于晨光中，慢慢拔出朴素的长刀，心里却没什么波澜。'.repeat(4),
      })
      .returning();
    const [s2] = await db
      .insert(styleSamples)
      .values({
        author: '猫腻',
        title: '《择天记》节选',
        contentMd: '陈长生伸出手，轻轻按在石碑上，碑文亮起。'.repeat(4),
      })
      .returning();

    const r = await startBookFromIdea({
      briefIdeaMd: '想写一本剑修小说，主角靠勘破阵法在宗门崛起',
      initialPreferences: {
        targetTotalChapters: 25,
        targetCharsPerChapter: 3200,
        styleSampleIds: [s1!.id, s2!.id],
        elementSlugs: ['rebirth', 'array-master'],
      },
    });
    createdBookIds.push(r.bookId);

    const brief = await getBookBrief(r.bookId);
    expect(brief).not.toBeNull();
    expect(brief!.styleSampleIds).toEqual([s1!.id, s2!.id]);
    expect(brief!.preselectedElementSlugs).toEqual(['rebirth', 'array-master']);

    const [b] = await db.select().from(books).where(eq(books.id, r.bookId));
    expect(b!.elementSlugs).toEqual(['rebirth', 'array-master']);

    const neg = await getNegotiationByBook(r.bookId);
    expect((neg!.decisions as Record<string, unknown>).elementSlugs).toEqual([
      'rebirth',
      'array-master',
    ]);

    await db.delete(books).where(eq(books.id, r.bookId));
    createdBookIds.pop();
    await db.delete(styleSamples).where(eq(styleSamples.id, s1!.id));
    await db.delete(styleSamples).where(eq(styleSamples.id, s2!.id));
  });

  it('startBookFromIdea defaults to empty preselections when not provided', async () => {
    const r = await startBookFromIdea({ briefIdeaMd: '不预选任何范文/元素的常规立项 idea' });
    createdBookIds.push(r.bookId);

    const brief = await getBookBrief(r.bookId);
    expect(brief!.styleSampleIds).toEqual([]);
    expect(brief!.preselectedElementSlugs).toEqual([]);

    const neg = await getNegotiationByBook(r.bookId);
    // 不预选时 decisions 保持空，让 scout 自由收敛
    expect(neg!.decisions).toEqual({});
  });
});

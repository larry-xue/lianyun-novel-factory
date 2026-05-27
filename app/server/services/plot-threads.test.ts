import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, plotThreadEvents, plotThreads } from '../db/schema/index.ts';
import {
  autoSlugFromTitle,
  introduceThread,
  listEventsForThread,
  listOpenForChapter,
  listThreadsForBook,
  markOverdueAsAbandoned,
  recordThreadEvent,
} from './plot-threads.ts';

let bookId: string;
const titleTag = `__test-thread-${Date.now()}`;

beforeAll(async () => {
  const [b] = await db.insert(books).values({ title: `__plot-threads-test ${Date.now()}` }).returning();
  bookId = b!.id;
});

afterAll(async () => {
  // cascade 会带走 plot_threads / events
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

afterEach(async () => {
  await db.delete(plotThreads).where(sql`${plotThreads.title} LIKE ${`${titleTag}%`}`);
});

describe('plot-threads service', () => {
  it('autoSlugFromTitle is deterministic', () => {
    expect(autoSlugFromTitle('坑甲')).toBe(autoSlugFromTitle('坑甲'));
    expect(autoSlugFromTitle('坑甲')).not.toBe(autoSlugFromTitle('坑乙'));
    expect(autoSlugFromTitle('坑甲')).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('introduceThread inserts row + introduce event', async () => {
    const t = await introduceThread({
      bookId,
      title: `${titleTag}-神秘信件`,
      introducedAtChapterIdx: 3,
      weight: 'arc',
    });
    expect(t.status).toBe('open');
    expect(t.weight).toBe('arc');
    expect(t.introducedAtChapterIdx).toBe(3);
    expect(t.expectedPayoffStart).toBe(4);
    expect(t.expectedPayoffEnd).toBe(13); // arc default window 10

    const events = await listEventsForThread(t.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('introduce');
    expect(events[0]!.chapterIdx).toBe(3);
  });

  it('introduceThread is idempotent: same slug → 1 row, 1 introduce event', async () => {
    const a = await introduceThread({
      bookId,
      title: `${titleTag}-重复坑`,
      introducedAtChapterIdx: 5,
    });
    const b = await introduceThread({
      bookId,
      title: `${titleTag}-重复坑`,
      introducedAtChapterIdx: 7, // 不同章号也应被忽略
    });
    expect(a.id).toBe(b.id);
    expect(b.introducedAtChapterIdx).toBe(5); // 保留首次

    const events = await listEventsForThread(a.id);
    expect(events).toHaveLength(1);
  });

  it('weight controls default payoff window', async () => {
    const small = await introduceThread({
      bookId,
      title: `${titleTag}-小坑`,
      introducedAtChapterIdx: 10,
      weight: 'small',
    });
    expect(small.expectedPayoffEnd).toBe(14); // small window=4

    const longline = await introduceThread({
      bookId,
      title: `${titleTag}-主线坑`,
      introducedAtChapterIdx: 1,
      weight: 'book',
    });
    expect(longline.expectedPayoffEnd).toBe(51); // book window=50
  });

  it('recordThreadEvent advances status: hint → hinted, pay → paid_off', async () => {
    const t = await introduceThread({
      bookId,
      title: `${titleTag}-推进坑`,
      introducedAtChapterIdx: 1,
    });

    await recordThreadEvent({ threadId: t.id, chapterIdx: 3, kind: 'hint', noteMd: '主角偶遇' });
    let [updated] = await db.select().from(plotThreads).where(eq(plotThreads.id, t.id));
    expect(updated!.status).toBe('hinted');

    await recordThreadEvent({
      threadId: t.id,
      chapterIdx: 8,
      kind: 'pay',
      noteMd: '反派揭穿信件来源',
    });
    [updated] = await db.select().from(plotThreads).where(eq(plotThreads.id, t.id));
    expect(updated!.status).toBe('paid_off');
    expect(updated!.payoffNotesMd).toContain('反派揭穿');

    const events = await listEventsForThread(t.id);
    expect(events.map((e) => e.kind)).toEqual(['introduce', 'hint', 'pay']);
  });

  it('listOpenForChapter returns only open/hinted, marks overdue, sorts by urgency', async () => {
    const ontime = await introduceThread({
      bookId,
      title: `${titleTag}-按时坑`,
      introducedAtChapterIdx: 1,
      weight: 'arc',
    });
    const overdue = await introduceThread({
      bookId,
      title: `${titleTag}-过期坑`,
      introducedAtChapterIdx: 1,
      weight: 'small',
    });
    const paid = await introduceThread({
      bookId,
      title: `${titleTag}-已收坑`,
      introducedAtChapterIdx: 1,
      weight: 'arc',
    });
    await recordThreadEvent({ threadId: paid.id, chapterIdx: 4, kind: 'pay' });

    // 当前章 = 8。ontime end=11（未过期），overdue end=5（过期），paid 已 paid_off 不入榜
    const list = await listOpenForChapter(bookId, 8);
    const titles = list.map((t) => t.title);
    expect(titles).toContain(`${titleTag}-按时坑`);
    expect(titles).toContain(`${titleTag}-过期坑`);
    expect(titles).not.toContain(`${titleTag}-已收坑`);

    const found = list.filter((t) => t.title.startsWith(titleTag));
    expect(found[0]!.title).toBe(`${titleTag}-过期坑`); // 过期的排第一
    expect(found[0]!.isOverdue).toBe(true);
    expect(found.find((t) => t.title === `${titleTag}-按时坑`)!.isOverdue).toBe(false);
  });

  it('markOverdueAsAbandoned moves expired threads + creates abandon events', async () => {
    const old = await introduceThread({
      bookId,
      title: `${titleTag}-超期失效坑`,
      introducedAtChapterIdx: 1,
      weight: 'small', // end=5
    });
    const fresh = await introduceThread({
      bookId,
      title: `${titleTag}-新坑`,
      introducedAtChapterIdx: 8,
      weight: 'arc', // end=18
    });

    // 当前章 = 12，grace=5 → cutoff=7。old.end=5 < 7 应被作废；fresh.end=18 应保留
    const abandoned = await markOverdueAsAbandoned(bookId, 12, 5);
    expect(abandoned.map((t) => t.id)).toEqual([old.id]);

    const [oldAfter] = await db.select().from(plotThreads).where(eq(plotThreads.id, old.id));
    expect(oldAfter!.status).toBe('abandoned');
    expect(oldAfter!.payoffNotesMd).toContain('自动作废');

    const [freshAfter] = await db.select().from(plotThreads).where(eq(plotThreads.id, fresh.id));
    expect(freshAfter!.status).toBe('open');

    const oldEvents = await listEventsForThread(old.id);
    expect(oldEvents.at(-1)!.kind).toBe('abandon');
    expect(oldEvents.at(-1)!.chapterIdx).toBe(12);
  });

  it('listThreadsForBook returns all threads for book in stable order', async () => {
    await introduceThread({ bookId, title: `${titleTag}-A`, introducedAtChapterIdx: 5 });
    await introduceThread({ bookId, title: `${titleTag}-B`, introducedAtChapterIdx: 2 });
    await introduceThread({ bookId, title: `${titleTag}-C`, introducedAtChapterIdx: 8 });

    const all = await listThreadsForBook(bookId);
    const tagged = all.filter((t) => t.title.startsWith(titleTag));
    expect(tagged.map((t) => t.title)).toEqual([
      `${titleTag}-B`,
      `${titleTag}-A`,
      `${titleTag}-C`,
    ]);
  });
});

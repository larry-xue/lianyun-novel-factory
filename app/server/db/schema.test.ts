import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { elements, books, chapters, bookStates } from './schema/index.ts';
import * as schema from './schema/index.ts';

const url =
  process.env.DATABASE_URL ?? 'postgresql://lianyun:lianyun_dev@localhost:5433/lianyun';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = drizzle(sql, { schema, casing: 'snake_case' });
});

afterAll(async () => {
  if (sql) await sql.end();
});

describe('drizzle schema (integration with docker pg)', () => {
  it('inserts and selects an element with array defaults', async () => {
    const slug = `test-element-${Date.now()}`;
    const [inserted] = await db
      .insert(elements)
      .values({ slug, zh: '测试元素', category: '测试' })
      .returning();
    expect(inserted).toBeDefined();
    expect(inserted!.comboFriendly).toEqual([]);
    expect(inserted!.comboAvoid).toEqual([]);
    expect(inserted!.hotScore).toBe(0);

    const fetched = await db.select().from(elements).where(eq(elements.slug, slug));
    expect(fetched).toHaveLength(1);

    await db.delete(elements).where(eq(elements.slug, slug));
  });

  it('cascades chapters and book_states when a book is deleted', async () => {
    const [book] = await db.insert(books).values({ title: '测试书' }).returning();
    expect(book).toBeDefined();
    await db
      .insert(chapters)
      .values({ bookId: book!.id, idx: 1, contentMd: 'hi', charCount: 2 });
    await db.insert(bookStates).values({
      bookId: book!.id,
      chapterIdx: 1,
      arcStage: '开篇',
    });

    await db.delete(books).where(eq(books.id, book!.id));

    const remainingChapters = await db
      .select({ c: dsql<number>`count(*)::int` })
      .from(chapters)
      .where(eq(chapters.bookId, book!.id));
    expect(remainingChapters[0]!.c).toBe(0);

    const remainingStates = await db
      .select({ c: dsql<number>`count(*)::int` })
      .from(bookStates)
      .where(eq(bookStates.bookId, book!.id));
    expect(remainingStates[0]!.c).toBe(0);
  });

  it('enforces unique chapter idx per book', async () => {
    const [book] = await db.insert(books).values({ title: '唯一性测试' }).returning();
    await db.insert(chapters).values({ bookId: book!.id, idx: 1, contentMd: '' });
    await expect(
      db.insert(chapters).values({ bookId: book!.id, idx: 1, contentMd: '' }),
    ).rejects.toThrow();
    await db.delete(books).where(eq(books.id, book!.id));
  });
});

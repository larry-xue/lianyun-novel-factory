import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookStates, books, chapters } from '../db/schema/index.ts';
import {
  BookNotFoundError,
  deleteBookFromShelf,
  deleteBooksFromShelf,
} from './bookshelf.ts';

const createdBookIds: string[] = [];

afterEach(async () => {
  if (createdBookIds.length === 0) return;
  await db.delete(books).where(inArray(books.id, createdBookIds));
  createdBookIds.length = 0;
});

describe('bookshelf service', () => {
  it('deletes one book from the shelf and cascades its book workspace rows', async () => {
    const [target] = await db
      .insert(books)
      .values({ title: '__bookshelf-delete-target' })
      .returning();
    const [other] = await db
      .insert(books)
      .values({ title: '__bookshelf-delete-other' })
      .returning();
    createdBookIds.push(target!.id, other!.id);

    await db.insert(chapters).values({
      bookId: target!.id,
      idx: 1,
      title: 'Chapter 1',
      contentMd: 'body',
      charCount: 4,
    });
    await db.insert(bookStates).values({
      bookId: target!.id,
      chapterIdx: 1,
      arcStage: 'opening',
      lastEventSummaryMd: 'started',
      nextChapterIntentMd: 'continue',
    });

    const deleted = await deleteBookFromShelf(target!.id);

    expect(deleted).toEqual({ id: target!.id, title: '__bookshelf-delete-target' });
    expect(await db.select().from(books).where(eq(books.id, target!.id))).toEqual([]);
    expect(await db.select().from(chapters).where(eq(chapters.bookId, target!.id))).toEqual([]);
    expect(await db.select().from(bookStates).where(eq(bookStates.bookId, target!.id))).toEqual([]);
    expect(await db.select().from(books).where(eq(books.id, other!.id))).toHaveLength(1);

    createdBookIds.splice(createdBookIds.indexOf(target!.id), 1);
  });

  it('throws BookNotFoundError when deleting a missing book', async () => {
    await expect(
      deleteBookFromShelf('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it('batch deletes multiple books and only the targeted ones', async () => {
    const [a] = await db.insert(books).values({ title: '__batch-a' }).returning();
    const [b] = await db.insert(books).values({ title: '__batch-b' }).returning();
    const [c] = await db.insert(books).values({ title: '__batch-c' }).returning();
    createdBookIds.push(a!.id, b!.id, c!.id);

    await db.insert(chapters).values({
      bookId: a!.id,
      idx: 1,
      title: 'A1',
      contentMd: 'x',
      charCount: 1,
    });

    const deleted = await deleteBooksFromShelf([a!.id, b!.id]);

    expect(deleted.map((d) => d.id).sort()).toEqual([a!.id, b!.id].sort());
    expect(
      await db.select().from(books).where(inArray(books.id, [a!.id, b!.id])),
    ).toEqual([]);
    expect(await db.select().from(chapters).where(eq(chapters.bookId, a!.id))).toEqual([]);
    expect(await db.select().from(books).where(eq(books.id, c!.id))).toHaveLength(1);

    createdBookIds.splice(createdBookIds.indexOf(a!.id), 1);
    createdBookIds.splice(createdBookIds.indexOf(b!.id), 1);
  });

  it('returns empty array when given empty id list (no SQL fired)', async () => {
    expect(await deleteBooksFromShelf([])).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, volumeSummaries } from '../db/schema/index.ts';
import { listVolumeSummariesForBook } from './volume-summaries.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__volume-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

describe('volume-summaries schema', () => {
  it('volume_summaries enforces unique (bookId, volumeIdx)', async () => {
    await db.insert(volumeSummaries).values({
      bookId,
      volumeIdx: 1,
      rangeStart: 1,
      rangeEnd: 50,
      summaryMd: '占位',
    });
    await expect(
      db.insert(volumeSummaries).values({
        bookId,
        volumeIdx: 1,
        rangeStart: 1,
        rangeEnd: 50,
        summaryMd: '冲突',
      }),
    ).rejects.toThrow();
    await db.delete(volumeSummaries).where(eq(volumeSummaries.bookId, bookId));
  });

  it('listVolumeSummariesForBook returns ordered by volumeIdx', async () => {
    await db.insert(volumeSummaries).values([
      { bookId, volumeIdx: 2, rangeStart: 51, rangeEnd: 100, summaryMd: 'v2' },
      { bookId, volumeIdx: 1, rangeStart: 1, rangeEnd: 50, summaryMd: 'v1' },
      { bookId, volumeIdx: 3, rangeStart: 101, rangeEnd: 150, summaryMd: 'v3' },
    ]);
    const list = await listVolumeSummariesForBook(bookId);
    expect(list.map((v) => v.volumeIdx)).toEqual([1, 2, 3]);
    await db.delete(volumeSummaries).where(eq(volumeSummaries.bookId, bookId));
  });
});

describe('cascades', () => {
  it('cascades: deleting book removes volume_summaries', async () => {
    const [b] = await db
      .insert(books)
      .values({ title: `__cascade-vol-${Date.now()}` })
      .returning();
    await db.insert(volumeSummaries).values({
      bookId: b!.id,
      volumeIdx: 1,
      rangeStart: 1,
      rangeEnd: 10,
      summaryMd: 'x',
    });
    await db.delete(books).where(eq(books.id, b!.id));
    const remaining = await db
      .select()
      .from(volumeSummaries)
      .where(eq(volumeSummaries.bookId, b!.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('summarizeVolume', () => {
  it('summarizeVolume rejects when range has no chapters', async () => {
    const { summarizeVolume } = await import('./volume-summaries.ts');
    await expect(
      summarizeVolume({
        bookId,
        rootRunId: '00000000-0000-0000-0000-000000000000',
        volumeIdx: 99,
        rangeStart: 9000,
        rangeEnd: 9010,
      }),
    ).rejects.toThrow();
  });
});

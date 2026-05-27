import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../app/server/db/client.ts';
import {
  bookStates,
  books,
  chapters,
} from '../../app/server/db/schema/index.ts';
import { produceBook } from '../../app/server/services/book-producer.ts';

const liveLlm = process.env.RUN_LIVE_LLM_TESTS === '1';

let createdBookId: string | undefined;

afterAll(async () => {
  if (createdBookId) {
    await db.delete(books).where(eq(books.id, createdBookId));
  }
});

describe('full-book pipeline', () => {
  it.skipIf(!liveLlm)(
    'auto-produces a 20-chapter book at ~3000 chinese chars/chapter',
    async () => {
      const result = await produceBook({
        topicTitle: '末世重生：囤货从今天开始',
        pitch:
          '社畜重生回末世爆发前 7 天，前世记忆 + 现代理财思维 → 资源整合 → 队伍组建 → 反派踩雷',
        elementSlugs: ['post-apocalypse', 'high-martial'],
        totalChapters: 20,
        charsPerChapter: 3000,
      });
      createdBookId = result.bookId;

      expect(result.chaptersWritten).toBe(20);

      const rows = await db
        .select()
        .from(chapters)
        .where(eq(chapters.bookId, result.bookId));
      expect(rows).toHaveLength(20);
      for (const row of rows) {
        expect(row.charCount).toBeGreaterThanOrEqual(2200);
        expect(row.charCount).toBeLessThanOrEqual(3800);
        expect(row.contentMd.length).toBeGreaterThan(800);
      }

      const states = await db
        .select()
        .from(bookStates)
        .where(eq(bookStates.bookId, result.bookId));
      // initial 0-state + 20 per-chapter states
      expect(states.length).toBeGreaterThanOrEqual(20);

      const avg = result.totalCharCount / result.chaptersWritten;
      expect(avg).toBeGreaterThanOrEqual(2400);
      expect(avg).toBeLessThanOrEqual(3600);
    },
    20 * 60_000, // 20 minutes hard cap
  );
});

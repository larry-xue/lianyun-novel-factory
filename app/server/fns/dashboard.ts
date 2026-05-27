import { createServerFn } from '@tanstack/react-start';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  antiPatterns,
  books,
  chapters,
  elements,
  hooks,
  runs,
  styleSamples,
} from '../db/schema/index.ts';

export const fetchDashboardFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      bookStats,
      chapterStats,
      runStats,
      recentRuns,
      elementCount,
      hookCount,
      antiPatternCount,
      styleSampleCount,
      pendingGateCount,
    ] = await Promise.all([
      // books by status
      db
        .select({ status: books.status, count: sql<number>`count(*)::int` })
        .from(books)
        .groupBy(books.status),
      // chapters total + chars
      db
        .select({
          total: sql<number>`count(*)::int`,
          totalChars: sql<number>`coalesce(sum(${chapters.charCount}), 0)::int`,
          finalCount: sql<number>`count(*) filter (where ${chapters.status} = 'final')::int`,
        })
        .from(chapters),
      // runs stats
      db
        .select({
          total: sql<number>`count(*)::int`,
          success: sql<number>`count(*) filter (where ${runs.status} = 'success')::int`,
          failure: sql<number>`count(*) filter (where ${runs.status} = 'failure')::int`,
          running: sql<number>`count(*) filter (where ${runs.status} = 'running')::int`,
          totalPromptTokens:
            sql<number>`coalesce(sum(${runs.promptTokens}), 0)::int`,
          totalCompletionTokens:
            sql<number>`coalesce(sum(${runs.completionTokens}), 0)::int`,
        })
        .from(runs),
      // recent 8 runs
      db
        .select({
          id: runs.id,
          kind: runs.kind,
          status: runs.status,
          bookId: runs.bookId,
          model: runs.model,
          startedAt: runs.startedAt,
          finishedAt: runs.finishedAt,
        })
        .from(runs)
        .orderBy(desc(runs.createdAt))
        .limit(8),
      // knowledge base counts
      db.select({ count: sql<number>`count(*)::int` }).from(elements),
      db.select({ count: sql<number>`count(*)::int` }).from(hooks),
      db.select({ count: sql<number>`count(*)::int` }).from(antiPatterns),
      db.select({ count: sql<number>`count(*)::int` }).from(styleSamples),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(books)
        .where(eq(books.status, 'writing')),
    ]);

    const bookStatusMap: Record<string, number> = {};
    for (const row of bookStats) {
      bookStatusMap[row.status] = row.count;
    }

    return {
      books: {
        total: Object.values(bookStatusMap).reduce((a, b) => a + b, 0),
        byStatus: bookStatusMap,
      },
      chapters: chapterStats[0] ?? { total: 0, totalChars: 0, finalCount: 0 },
      runs: {
        ...(runStats[0] ?? {
          total: 0,
          success: 0,
          failure: 0,
          running: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
        }),
        recent: recentRuns,
      },
      knowledgeBase: {
        elements: elementCount[0]?.count ?? 0,
        hooks: hookCount[0]?.count ?? 0,
        antiPatterns: antiPatternCount[0]?.count ?? 0,
        styleSamples: styleSampleCount[0]?.count ?? 0,
      },
      activeBooks: pendingGateCount[0]?.count ?? 0,
    };
  },
);

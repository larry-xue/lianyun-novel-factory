import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  bookDocs,
  bookStates,
  books,
  chapters,
} from '../db/schema/index.ts';
import { upsertDoc } from './book-docs.ts';
import {
  listSnapshots,
  restoreToChapter,
  snapshotAfterChapter,
} from './chapter-snapshots.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__snapshot-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

describe('chapter-snapshots', () => {
  it('snapshotAfterChapter 写入 state + docs 全量', async () => {
    await db.insert(bookStates).values({
      bookId,
      chapterIdx: 1,
      arcStage: '开篇',
      activeCharacters: [{ name: '主角', status: '健康' }],
      lastEventSummaryMd: '主角醒来发现重生了',
      nextChapterIntentMd: '走出家门遇到反派',
    });
    await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'world',
      title: '世界观',
      contentMd: '初始世界观 v1',
      editor: 'agent',
    });

    const snap = await snapshotAfterChapter({ bookId, chapterIdx: 1, kind: 'pilot' });
    expect(snap.chapterIdx).toBe(1);
    expect(snap.stateJsonb.arcStage).toBe('开篇');
    expect(snap.stateJsonb.activeCharacters).toEqual([{ name: '主角', status: '健康' }]);
    expect(snap.docsJsonb).toHaveLength(1);
    expect(snap.docsJsonb[0]?.kind).toBe('lore');
    expect(snap.docsJsonb[0]?.contentMd).toBe('初始世界观 v1');
  });

  it('同 chapter_idx 再次 snapshot 走 ON CONFLICT 覆盖', async () => {
    await snapshotAfterChapter({ bookId, chapterIdx: 1, noteMd: '第二次' });
    const list = await listSnapshots(bookId);
    const ch1 = list.filter((s) => s.chapterIdx === 1);
    expect(ch1).toHaveLength(1);
    expect(ch1[0]?.noteMd).toBe('第二次');
  });

  it('restoreToChapter 还原 state/docs，软杀后续章节', async () => {
    // 在 snapshot 之后再造一些「未来状态」
    await db.insert(bookStates).values({
      bookId,
      chapterIdx: 2,
      arcStage: '上升',
      activeCharacters: [{ name: '主角', status: '受伤' }],
      lastEventSummaryMd: '主角遇到反派',
      nextChapterIntentMd: '反派揭露身份',
    });
    await db.insert(chapters).values({
      bookId,
      idx: 2,
      title: '第二章',
      contentMd: '第二章内容',
      charCount: 100,
      status: 'final',
    });
    // 改 lore
    await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'world',
      title: '世界观',
      contentMd: '更新后的世界观 v2',
      editor: 'agent',
    });
    // 新建一个快照里没有的 doc
    await upsertDoc({
      bookId,
      kind: 'character',
      slug: 'villain',
      title: '反派',
      contentMd: '反派卡',
      editor: 'agent',
    });

    const r = await restoreToChapter({ bookId, chapterIdx: 1 });
    expect(r.killedChapters).toBe(1);
    expect(r.deletedStates).toBe(1);
    expect(r.deletedDocs).toBe(1); // character/villain 被删
    expect(r.restoredDocs).toBe(1); // lore/world 还原

    // 验证 ch2 软删
    const [ch2] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.idx, 2)));
    expect(ch2?.status).toBe('killed');

    // 验证 state[2] 被硬删
    const states = await db.select().from(bookStates).where(eq(bookStates.bookId, bookId));
    expect(states.map((s) => s.chapterIdx)).toEqual([1]);

    // 验证 lore/world 内容回到 v1（但 version 升到 3：v2 是改动，v3 是回退）
    const [lore] = await db
      .select()
      .from(bookDocs)
      .where(
        and(eq(bookDocs.bookId, bookId), eq(bookDocs.kind, 'lore'), eq(bookDocs.slug, 'world')),
      );
    expect(lore?.contentMd).toBe('初始世界观 v1');
    expect(lore?.version).toBeGreaterThanOrEqual(3);

    // 验证 character/villain 被删
    const villain = await db
      .select()
      .from(bookDocs)
      .where(
        and(
          eq(bookDocs.bookId, bookId),
          eq(bookDocs.kind, 'character'),
          eq(bookDocs.slug, 'villain'),
        ),
      );
    expect(villain).toHaveLength(0);
  });
});

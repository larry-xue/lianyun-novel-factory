import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookStates, books, chapters } from '../db/schema/index.ts';

export class NotLastChapterError extends Error {
  constructor(
    public lastIdx: number,
    public requestedIdx: number,
  ) {
    super(`只能删除最后一章（当前最后一章为 ${lastIdx}，请求删除 ${requestedIdx}）`);
    this.name = 'NotLastChapterError';
  }
}

export class NoChapterError extends Error {
  constructor(chapterId: string) {
    super(`章节 ${chapterId} 不存在`);
    this.name = 'NoChapterError';
  }
}

/**
 * 删除最后一章并回退 book_state。
 * - 只允许删除 idx 最大的章节（保持连续性）
 * - 级联删除 chapter_revisions（DB CASCADE）
 * - 删除对应的 book_states 行
 * - outline_nodes.chapterId 自动置 NULL（DB SET NULL）
 * - 如果书籍状态是 completed，回退到 writing
 */
export async function deleteLastChapter(bookId: string): Promise<{
  deletedIdx: number;
  deletedTitle: string;
}> {
  // 找到最后一章
  const [last] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(desc(chapters.idx))
    .limit(1);

  if (!last) {
    throw new NoChapterError(bookId);
  }

  // 删除章节（级联删除 chapter_revisions）
  await db.delete(chapters).where(eq(chapters.id, last.id));

  // 删除对应的 book_state
  await db
    .delete(bookStates)
    .where(and(eq(bookStates.bookId, bookId), eq(bookStates.chapterIdx, last.idx)));

  // 如果书籍状态是 completed，回退到 writing
  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (book?.status === 'completed') {
    await db.update(books).set({ status: 'writing' }).where(eq(books.id, bookId));
  }

  return { deletedIdx: last.idx, deletedTitle: last.title };
}

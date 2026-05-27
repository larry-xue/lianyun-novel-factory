import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books } from '../db/schema/index.ts';

export class BookNotFoundError extends Error {
  constructor(id: string) {
    super(`book ${id} not found`);
    this.name = 'BookNotFoundError';
  }
}

export async function deleteBookFromShelf(id: string): Promise<{ id: string; title: string }> {
  const [deleted] = await db
    .delete(books)
    .where(eq(books.id, id))
    .returning({ id: books.id, title: books.title });

  if (!deleted) throw new BookNotFoundError(id);
  return deleted;
}

/**
 * 批量删书。一次 SQL 删除所有命中行；级联清理由 schema 的 onDelete:cascade 处理。
 * 返回实际删掉的行（id + title），调用方可据此对比缺失的 id。
 */
export async function deleteBooksFromShelf(
  ids: string[],
): Promise<Array<{ id: string; title: string }>> {
  if (ids.length === 0) return [];
  return await db
    .delete(books)
    .where(inArray(books.id, ids))
    .returning({ id: books.id, title: books.title });
}

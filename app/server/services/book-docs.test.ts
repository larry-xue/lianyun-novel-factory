import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookDocKinds, bookDocs, books } from '../db/schema/index.ts';
import {
  getDoc,
  listDocKinds,
  listDocsForBook,
  listRevisions,
  upsertDoc,
  upsertDocKind,
} from './book-docs.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__book-docs-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
  // 清掉测试用的 kind
  await db.delete(bookDocKinds).where(sql`${bookDocKinds.slug} LIKE 'test-%'`);
});

describe('book-docs service', () => {
  it('predefined kinds are seeded', async () => {
    const kinds = await listDocKinds();
    const slugs = kinds.map((k) => k.slug);
    // map / forbidden 已在 0024 migration 删除（前者与 world-design 重叠，后者被 books.prohibited_tropes 替代）
    expect(slugs).toEqual(
      expect.arrayContaining(['relations', 'timeline', 'lore', 'reader_notes']),
    );
    expect(slugs).not.toContain('map');
    expect(slugs).not.toContain('forbidden');
  });

  it('upsertDoc creates v1 + introduces unknown kind on the fly', async () => {
    const doc = await upsertDoc({
      bookId,
      kind: 'test-cultivation-tree',
      slug: 'test-main',
      title: '修炼体系图（测试）',
      contentMd: '# 凡人 → 筑基 → 金丹\n\n初版',
      editor: 'agent',
    });
    expect(doc.version).toBe(1);
    expect(doc.lastEditedBy).toBe('agent');

    // kind 自动创建
    const k = await db
      .select()
      .from(bookDocKinds)
      .where(eq(bookDocKinds.slug, 'test-cultivation-tree'));
    expect(k).toHaveLength(1);
    expect(k[0]!.introducedBy).toBe('agent');

    const revs = await listRevisions(doc.id);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.version).toBe(1);
  });

  it('upsertDoc bumps version + writes revision when content differs', async () => {
    await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'test-bumping',
      title: 'lore 测试',
      contentMd: 'v1 内容',
      editor: 'human',
    });
    const v2 = await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'test-bumping',
      title: 'lore 测试',
      contentMd: 'v2 内容（变了）',
      editor: 'human',
      reasonMd: '补充了第 3 章新设定',
    });
    expect(v2.version).toBe(2);
    expect(v2.contentMd).toBe('v2 内容（变了）');

    const revs = await listRevisions(v2.id);
    expect(revs).toHaveLength(2);
    expect(revs[1]!.reasonMd).toBe('补充了第 3 章新设定');
  });

  it('upsertDoc is idempotent: same content → no new revision', async () => {
    const a = await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'test-idempotent',
      title: 'idem 测试',
      contentMd: 'aa',
      editor: 'agent',
    });
    const b = await upsertDoc({
      bookId,
      kind: 'lore',
      slug: 'test-idempotent',
      title: 'idem 测试',
      contentMd: 'aa',
      editor: 'agent',
    });
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(1);

    const revs = await listRevisions(a.id);
    expect(revs).toHaveLength(1);
  });

  it('upsertDocKind allows agent to introduce a new category', async () => {
    const k = await upsertDocKind({
      slug: 'test-economy',
      zh: '经济体系',
      descriptionMd: '货币、税收、贸易',
      introducedBy: 'agent',
    });
    expect(k.slug).toBe('test-economy');
    expect(k.introducedBy).toBe('agent');
  });

  it('listDocsForBook returns docs for that book only', async () => {
    const all = await listDocsForBook(bookId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((d) => d.bookId === bookId)).toBe(true);
  });

  it('upsertDoc accepts nested slug with / separator (multi-level path)', async () => {
    const doc = await upsertDoc({
      bookId,
      kind: 'world',
      slug: 'factions/tianhua-zong',
      title: '天华宗',
      contentMd: '名门正派。',
      editor: 'agent',
    });
    expect(doc.slug).toBe('factions/tianhua-zong');
  });

  it('upsertDoc rejects slug with trailing or doubled slash', async () => {
    await expect(
      upsertDoc({
        bookId,
        kind: 'world',
        slug: 'factions/',
        title: 'x',
        contentMd: 'y',
        editor: 'agent',
      }),
    ).rejects.toThrow();
    await expect(
      upsertDoc({
        bookId,
        kind: 'world',
        slug: 'factions//xxx',
        title: 'x',
        contentMd: 'y',
        editor: 'agent',
      }),
    ).rejects.toThrow();
  });

  it('cascades: deleting book removes docs + revisions', async () => {
    const [b] = await db
      .insert(books)
      .values({ title: `__cascade-test ${Date.now()}` })
      .returning();
    await upsertDoc({
      bookId: b!.id,
      kind: 'lore',
      slug: 'cascade',
      title: 'x',
      contentMd: 'y',
      editor: 'agent',
    });
    await db.delete(books).where(eq(books.id, b!.id));
    const remaining = await db.select().from(bookDocs).where(eq(bookDocs.bookId, b!.id));
    expect(remaining).toHaveLength(0);
  });
});

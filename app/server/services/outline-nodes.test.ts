import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, chapters, outlineNodes } from '../db/schema/index.ts';
import {
  assembleTree,
  getChapterNode,
  insertFlatChapters,
  insertHierarchy,
  listChildren,
  listForBook,
  listVolumes,
  markChapterDone,
} from './outline-nodes.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__outline-nodes-test ${Date.now()}` })
    .returning();
  bookId = b!.id;
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

afterEach(async () => {
  await db.delete(outlineNodes).where(eq(outlineNodes.bookId, bookId));
});

describe('outline-nodes service', () => {
  it('insertHierarchy creates volume → arc → chapter tree', async () => {
    const r = await insertHierarchy({
      bookId,
      volumes: [
        {
          idx: 1,
          title: '初入江湖卷',
          summaryMd: '主角离开门派下山历练',
          arcs: [
            {
              idx: 1,
              title: '试水弧',
              chapterStart: 1,
              chapterEnd: 2,
              chapterBeats: [
                { idx: 1, title: '下山', summaryMd: '主角辞别师门', intent: '立人设' },
                { idx: 2, title: '初遇', summaryMd: '撞见黑衣人' },
              ],
            },
            { idx: 2, title: '历练弧' },
          ],
        },
        { idx: 2, title: '宗门篇' },
      ],
    });

    expect(r.volumeIds).toHaveLength(2);
    expect(r.arcIds).toHaveLength(2); // 卷 1 下两个弧；卷 2 下没填
    expect(r.chapterIds).toHaveLength(2);
    expect(r.totalNodes).toBe(6);

    const all = await listForBook(bookId);
    expect(all).toHaveLength(6);

    const volumes = await listVolumes(bookId);
    expect(volumes).toHaveLength(2);
    expect(volumes[0]!.title).toBe('初入江湖卷');
    expect(volumes[0]!.parentId).toBeNull();

    const arcsOfVol1 = await listChildren(volumes[0]!.id);
    expect(arcsOfVol1).toHaveLength(2);
    expect(arcsOfVol1[0]!.title).toBe('试水弧');
    expect(arcsOfVol1[0]!.parentId).toBe(volumes[0]!.id);
    expect(arcsOfVol1[0]!.meta).toMatchObject({ chapterStart: 1, chapterEnd: 2 });

    const beatsOfArc1 = await listChildren(arcsOfVol1[0]!.id);
    expect(beatsOfArc1).toHaveLength(2);
    expect(beatsOfArc1[0]!.title).toBe('下山');
    expect(beatsOfArc1[0]!.intent).toBe('立人设');
  });

  it('insertFlatChapters creates parent-less chapter nodes', async () => {
    const ids = await insertFlatChapters({
      bookId,
      beats: [
        { idx: 1, title: '第一章', summaryMd: 'aaa', intent: '开端' },
        { idx: 2, title: '第二章', summaryMd: 'bbb' },
        { idx: 3, title: '第三章', summaryMd: 'ccc' },
      ],
    });
    expect(ids).toHaveLength(3);

    const rows = await listForBook(bookId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.parentId === null && r.level === 'chapter')).toBe(true);
  });

  it('partial unique index: same idx under same parent rejected', async () => {
    const r = await insertHierarchy({
      bookId,
      volumes: [{ idx: 1, title: 'A' }],
    });
    await expect(
      insertHierarchy({
        bookId,
        volumes: [{ idx: 1, title: '冲突' }], // 顶层 idx=1 已被占用
      }),
    ).rejects.toThrow();
    expect(r.volumeIds).toHaveLength(1);
  });

  it('partial unique index allows same idx under different parents', async () => {
    // 卷 1 下的弧 1 和卷 2 下的弧 1 不冲突
    const r = await insertHierarchy({
      bookId,
      volumes: [
        { idx: 1, title: 'V1', arcs: [{ idx: 1, title: 'V1A1' }, { idx: 2, title: 'V1A2' }] },
        { idx: 2, title: 'V2', arcs: [{ idx: 1, title: 'V2A1' }] },
      ],
    });
    expect(r.arcIds).toHaveLength(3);
  });

  it('assembleTree builds nested structure from flat rows', async () => {
    await insertHierarchy({
      bookId,
      volumes: [
        {
          idx: 1,
          title: 'V1',
          arcs: [
            {
              idx: 1,
              title: 'V1A1',
              chapterBeats: [{ idx: 1, title: 'C1' }, { idx: 2, title: 'C2' }],
            },
          ],
        },
      ],
    });
    const all = await listForBook(bookId);
    const tree = assembleTree(all);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.node.level).toBe('volume');
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children).toHaveLength(2);
    expect(tree[0]!.children[0]!.children[0]!.node.title).toBe('C1');
  });

  it('markChapterDone: missing chapter node is created under the correct arc by range', async () => {
    const h = await insertHierarchy({
      bookId,
      volumes: [
        {
          idx: 1,
          title: 'V1',
          arcs: [
            {
              idx: 1,
              title: 'Arc1',
              chapterStart: 1,
              chapterEnd: 3,
              chapterBeats: [{ idx: 1, title: 'C1' }],
            },
            {
              idx: 2,
              title: 'Arc2',
              chapterStart: 4,
              chapterEnd: 6,
              // no chapterBeats — simulates LLM not generating beats for this arc
            },
          ],
        },
      ],
    });

    const arc2Id = h.arcIds[1]!;

    // chapter 5 has no pre-created node → should go under arc 2 (chapterStart=4, chapterEnd=6)
    const [dummyCh] = await db
      .insert(chapters)
      .values({ bookId, idx: 5, title: 'C5', contentMd: '', charCount: 0 })
      .returning();
    await markChapterDone(bookId, 5, dummyCh!.id, '第5章摘要');

    const node = await getChapterNode(bookId, 5);
    expect(node).not.toBeNull();
    expect(node!.parentId).toBe(arc2Id);
    expect(node!.status).toBe('done');
    expect(node!.chapterId).toBe(dummyCh!.id);
  });
});

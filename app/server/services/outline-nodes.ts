import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { outlineNodes, type OutlineNode } from '../db/schema/index.ts';

/**
 * 分层大纲业务层。
 * 数据形态：自引用树 (volume → arc → chapter)。
 *
 * 设计点：
 * - insertHierarchy 一次性插入完整三层树，自动管 parent_id
 * - 老书走 insertFlatChapters（无层级，全 parent=null 的 chapter 节点）
 * - listForBook 按层级排序返回扁平列表，UI 自己拼树
 */

export interface BeatInput {
  idx: number;
  title?: string;
  summaryMd?: string;
  intent?: string;
  pacingPhase?: string;
  expectedThreadEvents?: Array<{ threadSlug?: string; threadTitle?: string; kind: string }>;
}

export interface ArcInput {
  idx: number;
  title?: string;
  summaryMd?: string;
  pacingPhase?: string;
  chapterStart?: number;
  chapterEnd?: number;
  chapterBeats?: BeatInput[];
}

export interface VolumeInput {
  idx: number;
  title?: string;
  summaryMd?: string;
  pacingPhase?: string;
  chapterStart?: number;
  chapterEnd?: number;
  arcs?: ArcInput[];
}

export interface InsertHierarchyInput {
  bookId: string;
  volumes: VolumeInput[];
  generatedByRunId?: string;
}

export interface InsertHierarchyResult {
  volumeIds: string[];
  arcIds: string[];
  chapterIds: string[];
  totalNodes: number;
}

export async function insertHierarchy(
  input: InsertHierarchyInput,
): Promise<InsertHierarchyResult> {
  const result: InsertHierarchyResult = {
    volumeIds: [],
    arcIds: [],
    chapterIds: [],
    totalNodes: 0,
  };

  for (const v of input.volumes) {
    const [volRow] = await db
      .insert(outlineNodes)
      .values({
        bookId: input.bookId,
        parentId: null,
        level: 'volume',
        idx: v.idx,
        title: v.title ?? '',
        summaryMd: v.summaryMd ?? '',
        pacingPhase: v.pacingPhase ?? '',
        meta: chapterRangeMeta(v.chapterStart, v.chapterEnd),
        generatedByRunId: input.generatedByRunId,
      })
      .returning();
    if (!volRow) throw new Error(`insertHierarchy: 卷 ${v.idx} 插入失败`);
    result.volumeIds.push(volRow.id);
    result.totalNodes++;

    for (const a of v.arcs ?? []) {
      const [arcRow] = await db
        .insert(outlineNodes)
        .values({
          bookId: input.bookId,
          parentId: volRow.id,
          level: 'arc',
          idx: a.idx,
          title: a.title ?? '',
          summaryMd: a.summaryMd ?? '',
          pacingPhase: a.pacingPhase ?? '',
          meta: chapterRangeMeta(a.chapterStart, a.chapterEnd),
          generatedByRunId: input.generatedByRunId,
        })
        .returning();
      if (!arcRow) throw new Error(`insertHierarchy: 卷 ${v.idx} 弧 ${a.idx} 插入失败`);
      result.arcIds.push(arcRow.id);
      result.totalNodes++;

      for (const b of a.chapterBeats ?? []) {
        const [beatRow] = await db
          .insert(outlineNodes)
          .values({
            bookId: input.bookId,
            parentId: arcRow.id,
            level: 'chapter',
            idx: b.idx,
            title: b.title ?? '',
            summaryMd: b.summaryMd ?? '',
            intent: b.intent ?? '',
            pacingPhase: b.pacingPhase ?? '',
            expectedThreadEvents: b.expectedThreadEvents ?? [],
            generatedByRunId: input.generatedByRunId,
          })
          .returning();
        if (!beatRow) {
          throw new Error(`insertHierarchy: 卷 ${v.idx} 弧 ${a.idx} 章 ${b.idx} 插入失败`);
        }
        result.chapterIds.push(beatRow.id);
        result.totalNodes++;
      }
    }
  }

  return result;
}

/**
 * 老路径：没有卷/弧层级，只有一组章拍。
 * 全部插成 parent_id=null 的 chapter 节点（兼容老 chapterSummaries）。
 */
export async function insertFlatChapters(input: {
  bookId: string;
  beats: BeatInput[];
  generatedByRunId?: string;
}): Promise<string[]> {
  if (input.beats.length === 0) return [];
  const rows = await db
    .insert(outlineNodes)
    .values(
      input.beats.map((b) => ({
        bookId: input.bookId,
        parentId: null,
        level: 'chapter' as const,
        idx: b.idx,
        title: b.title ?? '',
        summaryMd: b.summaryMd ?? '',
        intent: b.intent ?? '',
        pacingPhase: b.pacingPhase ?? '',
        expectedThreadEvents: b.expectedThreadEvents ?? [],
        generatedByRunId: input.generatedByRunId,
      })),
    )
    .returning({ id: outlineNodes.id });
  return rows.map((r) => r.id);
}

function chapterRangeMeta(
  chapterStart: number | undefined,
  chapterEnd: number | undefined,
): Record<string, unknown> {
  if (chapterStart === undefined && chapterEnd === undefined) return {};
  return {
    ...(chapterStart !== undefined ? { chapterStart } : {}),
    ...(chapterEnd !== undefined ? { chapterEnd } : {}),
  };
}

/**
 * 章节写完后回填 outline_node：标 done、关联 chapterId、记录实际事件摘要。
 */
export async function markChapterDone(
  bookId: string,
  chapterIdx: number,
  chapterId: string,
  actualSummaryMd: string,
): Promise<void> {
  const [node] = await db
    .select({ id: outlineNodes.id, meta: outlineNodes.meta })
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.bookId, bookId),
        eq(outlineNodes.idx, chapterIdx),
        eq(outlineNodes.level, 'chapter'),
      ),
    )
    .limit(1);

  if (!node) {
    // 续写超出大纲范围：自动创建 chapter 节点，挂到 chapterIdx 所属的 arc 下
    const arcs = await db
      .select({ id: outlineNodes.id, meta: outlineNodes.meta })
      .from(outlineNodes)
      .where(
        and(
          eq(outlineNodes.bookId, bookId),
          eq(outlineNodes.level, 'arc'),
        ),
      )
      .orderBy(asc(outlineNodes.idx));

    let parentArcId: string | null = null;
    for (const arc of arcs) {
      const m = (arc.meta ?? {}) as Record<string, unknown>;
      const cs = typeof m.chapterStart === 'number' ? m.chapterStart : undefined;
      const ce = typeof m.chapterEnd === 'number' ? m.chapterEnd : undefined;
      if (cs != null && ce != null && chapterIdx >= cs && chapterIdx <= ce) {
        parentArcId = arc.id;
        break;
      }
    }
    // fallback: 如果没有 arc 的 range 匹配，挂到最后一个 arc
    if (!parentArcId && arcs.length > 0) {
      parentArcId = arcs[arcs.length - 1]!.id;
    }

    await db.insert(outlineNodes).values({
      bookId,
      parentId: parentArcId,
      level: 'chapter',
      idx: chapterIdx,
      title: '',
      summaryMd: actualSummaryMd,
      status: 'done',
      chapterId,
      meta: { autoCreated: true, actualSummaryMd },
    });
    return;
  }

  await db
    .update(outlineNodes)
    .set({
      status: 'done',
      chapterId,
      meta: { ...node.meta, actualSummaryMd },
    })
    .where(eq(outlineNodes.id, node.id));
}

/**
 * 取指定章节的 outline_node，供 chapter-planner 读取骨架计划。
 */
export async function getChapterNode(
  bookId: string,
  chapterIdx: number,
): Promise<OutlineNode | null> {
  const [node] = await db
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.bookId, bookId),
        eq(outlineNodes.idx, chapterIdx),
        eq(outlineNodes.level, 'chapter'),
      ),
    )
    .limit(1);
  return node ?? null;
}

export async function listForBook(bookId: string): Promise<OutlineNode[]> {
  return await db
    .select()
    .from(outlineNodes)
    .where(eq(outlineNodes.bookId, bookId))
    .orderBy(asc(outlineNodes.level), asc(outlineNodes.idx));
}

export async function listChildren(parentId: string): Promise<OutlineNode[]> {
  return await db
    .select()
    .from(outlineNodes)
    .where(eq(outlineNodes.parentId, parentId))
    .orderBy(asc(outlineNodes.idx));
}

export async function listVolumes(bookId: string): Promise<OutlineNode[]> {
  return await db
    .select()
    .from(outlineNodes)
    .where(and(eq(outlineNodes.bookId, bookId), isNull(outlineNodes.parentId), eq(outlineNodes.level, 'volume')))
    .orderBy(asc(outlineNodes.idx));
}

/**
 * UI 展示用的树形结构。
 */
export interface OutlineTreeNode {
  node: OutlineNode;
  children: OutlineTreeNode[];
}

export function assembleTree(rows: OutlineNode[]): OutlineTreeNode[] {
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const r of rows) {
    const key = r.parentId || null;
    const arr = byParent.get(key) ?? [];
    arr.push(r);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.idx - b.idx);

  function build(parentId: string | null): OutlineTreeNode[] {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((node) => ({ node, children: build(node.id) }));
  }
  return build(null);
}

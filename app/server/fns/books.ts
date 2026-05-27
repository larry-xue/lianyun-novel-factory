import { createServerFn } from '@tanstack/react-start';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  arcSummaries,
  bookBriefs,
  bookDocRevisions,
  bookDocs,
  bookStates,
  books,
  chapterRevisions,
  chapters,
  characters,
  gateRequests,
  outlineNodes,
  outlineRevisions,
  plotThreadEvents,
  plotThreads,
  topicNegotiations,
  volumeSummaries,
} from '../db/schema/index.ts';
import { produceBook, writeNextChapter, designForExistingBook, produceForExistingBook } from '../services/book-producer.ts';
import { deleteBookFromShelf, deleteBooksFromShelf } from '../services/bookshelf.ts';
import { requireBookOwner, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import { assertBookNotBusy } from '../services/book-busy.ts';

const bookListProjection = {
  id: books.id,
  title: books.title,
  status: books.status,
  elementSlugs: books.elementSlugs,
  mainCategory: books.mainCategory,
  themes: books.themes,
  characterTypes: books.characterTypes,
  plotElements: books.plotElements,
  pinnedAt: books.pinnedAt,
  createdAt: books.createdAt,
} as const;

const chapterProjection = {
  id: chapters.id,
  idx: chapters.idx,
  title: chapters.title,
  contentMd: chapters.contentMd,
  charCount: chapters.charCount,
  status: chapters.status,
  createdAt: chapters.createdAt,
} as const;

const stateProjection = {
  bookId: bookStates.bookId,
  chapterIdx: bookStates.chapterIdx,
  arcStage: bookStates.arcStage,
  lastEventSummaryMd: bookStates.lastEventSummaryMd,
  nextChapterIntentMd: bookStates.nextChapterIntentMd,
  createdAt: bookStates.createdAt,
} as const;

export const listBooksFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  return await db
    .select({ ...bookListProjection, ownerId: books.ownerId })
    .from(books)
    .orderBy(sql`${books.pinnedAt} desc nulls last`, desc(books.createdAt));
});

export const togglePinBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z.object({ bookId: z.string().uuid(), pinned: z.boolean() }).parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await db
      .update(books)
      .set({ pinnedAt: data.pinned ? new Date() : null })
      .where(eq(books.id, data.bookId));
    await logAudit({
      user: me,
      action: data.pinned ? 'books.pin' : 'books.unpin',
      targetType: 'book',
      targetId: data.bookId,
      summary: data.pinned ? '置顶书籍' : '取消置顶',
    });
    return { ok: true };
  });

export const fetchBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    await requireUser();
    const [book] = await db
      .select({
        ...bookListProjection,
        ownerId: books.ownerId,
        outlineMd: books.outlineMd,
        outlineVersion: books.outlineVersion,
        bookSummaryMd: books.bookSummaryMd,
        // brief 元数据：design / 详情页 UI 直接展示，不再绕活文档读
        protagonist: books.protagonist,
        loglineMd: books.loglineMd,
        audience: books.audience,
        mainArcMd: books.mainArcMd,
        prohibitedTropes: books.prohibitedTropes,
        meta: books.meta,
      })
      .from(books)
      .where(eq(books.id, data.id));
    if (!book) throw new Error('book not found');
    const ch = await db
      .select(chapterProjection)
      .from(chapters)
      .where(eq(chapters.bookId, data.id))
      .orderBy(chapters.idx);
    const meta = (book.meta ?? {}) as Record<string, unknown>;
    const pacingPlanMd =
      typeof meta.pacingPlanMd === 'string' ? (meta.pacingPlanMd as string) : '';
    const states = await db
      .select(stateProjection)
      .from(bookStates)
      .where(eq(bookStates.bookId, data.id))
      .orderBy(bookStates.chapterIdx);
    // meta 含 unknown，TanStack Start 序列化会拒；剥掉只保留我们要给 UI 用的字段。
    const { meta: _, ...bookSafe } = book;
    return { book: { ...bookSafe, pacingPlanMd }, chapters: ch, states };
  });

export const copyBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    const result = await db.transaction(async (tx) => {
      // 1. 读源 book
      const [src] = await tx.select().from(books).where(eq(books.id, data.bookId));
      if (!src) throw new Error('源书不存在');

      const { id: _oldId, createdAt: _c, updatedAt: _u, ...bookFields } = src;
      const [newBook] = await tx
        .insert(books)
        .values({ ...bookFields, title: `${src.title}（副本）`, status: 'planning', ownerId: me.id })
        .returning();
      if (!newBook) throw new Error('创建副本失败');
      const newBookId = newBook.id;

      // 2. characters
      const srcChars = await tx.select().from(characters).where(eq(characters.bookId, data.bookId));
      if (srcChars.length) {
        await tx.insert(characters).values(
          srcChars.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 3. chapters — 需要建 id 映射给 chapter_revisions 用
      const srcChapters = await tx.select().from(chapters).where(eq(chapters.bookId, data.bookId));
      const chapterIdMap = new Map<string, string>(); // oldId → newId
      if (srcChapters.length) {
        for (const ch of srcChapters) {
          const { id, createdAt, updatedAt, ...r } = ch;
          const [newCh] = await tx
            .insert(chapters)
            .values({ ...r, bookId: newBookId })
            .returning();
          if (newCh) chapterIdMap.set(id, newCh.id);
        }
      }

      // 4. chapter_revisions
      const oldChapterIds = [...chapterIdMap.keys()];
      if (oldChapterIds.length) {
        const srcRevs = await tx
          .select()
          .from(chapterRevisions)
          .where(inArray(chapterRevisions.chapterId, oldChapterIds));
        if (srcRevs.length) {
          await tx.insert(chapterRevisions).values(
            srcRevs.map(({ id, createdAt, updatedAt, ...r }) => ({
              ...r,
              chapterId: chapterIdMap.get(r.chapterId) ?? r.chapterId,
            })),
          );
        }
      }

      // 5. book_states
      const srcStates = await tx.select().from(bookStates).where(eq(bookStates.bookId, data.bookId));
      if (srcStates.length) {
        await tx.insert(bookStates).values(
          srcStates.map(({ createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 6. book_briefs
      const [srcBrief] = await tx.select().from(bookBriefs).where(eq(bookBriefs.bookId, data.bookId));
      if (srcBrief) {
        const { createdAt, updatedAt, ...r } = srcBrief;
        await tx.insert(bookBriefs).values({ ...r, bookId: newBookId });
      }

      // 7. topic_negotiations
      const srcNegs = await tx
        .select()
        .from(topicNegotiations)
        .where(eq(topicNegotiations.bookId, data.bookId));
      if (srcNegs.length) {
        await tx.insert(topicNegotiations).values(
          srcNegs.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 8. gate_requests
      const srcGates = await tx.select().from(gateRequests).where(eq(gateRequests.bookId, data.bookId));
      if (srcGates.length) {
        await tx.insert(gateRequests).values(
          srcGates.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 9. plot_threads — 需要 id 映射给 plot_thread_events 用
      const srcThreads = await tx.select().from(plotThreads).where(eq(plotThreads.bookId, data.bookId));
      const threadIdMap = new Map<string, string>();
      if (srcThreads.length) {
        for (const t of srcThreads) {
          const { id, createdAt, updatedAt, ...r } = t;
          const [newT] = await tx
            .insert(plotThreads)
            .values({ ...r, bookId: newBookId })
            .returning();
          if (newT) threadIdMap.set(id, newT.id);
        }
      }

      // 10. plot_thread_events
      const srcThreadEvents = await tx
        .select()
        .from(plotThreadEvents)
        .where(eq(plotThreadEvents.bookId, data.bookId));
      if (srcThreadEvents.length) {
        await tx.insert(plotThreadEvents).values(
          srcThreadEvents.map(({ id, createdAt, updatedAt, ...r }) => ({
            ...r,
            bookId: newBookId,
            threadId: threadIdMap.get(r.threadId) ?? r.threadId,
          })),
        );
      }

      // 11. outline_nodes — 自引用树，需要 id 映射
      const srcNodes = await tx.select().from(outlineNodes).where(eq(outlineNodes.bookId, data.bookId));
      const nodeIdMap = new Map<string, string>();
      if (srcNodes.length) {
        // 先插入所有节点（parentId 设 null），再回填 parentId
        for (const n of srcNodes) {
          const { id, createdAt, updatedAt, ...r } = n;
          const [newN] = await tx
            .insert(outlineNodes)
            .values({
              ...r,
              bookId: newBookId,
              parentId: null,
              chapterId: r.chapterId ? (chapterIdMap.get(r.chapterId) ?? null) : null,
            })
            .returning();
          if (newN) nodeIdMap.set(id, newN.id);
        }
        // 回填 parentId
        for (const n of srcNodes) {
          if (n.parentId) {
            const newParentId = nodeIdMap.get(n.parentId);
            const newId = nodeIdMap.get(n.id);
            if (newParentId && newId) {
              await tx
                .update(outlineNodes)
                .set({ parentId: newParentId })
                .where(eq(outlineNodes.id, newId));
            }
          }
        }
      }

      // 12. arc_summaries
      const srcArcs = await tx.select().from(arcSummaries).where(eq(arcSummaries.bookId, data.bookId));
      if (srcArcs.length) {
        await tx.insert(arcSummaries).values(
          srcArcs.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 14. outline_revisions
      const srcRevisions = await tx
        .select()
        .from(outlineRevisions)
        .where(eq(outlineRevisions.bookId, data.bookId));
      if (srcRevisions.length) {
        await tx.insert(outlineRevisions).values(
          srcRevisions.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 15. volume_summaries
      const srcVolumes = await tx
        .select()
        .from(volumeSummaries)
        .where(eq(volumeSummaries.bookId, data.bookId));
      if (srcVolumes.length) {
        await tx.insert(volumeSummaries).values(
          srcVolumes.map(({ id, createdAt, updatedAt, ...r }) => ({ ...r, bookId: newBookId })),
        );
      }

      // 16. book_docs — 需要 id 映射给 book_doc_revisions 用
      const srcDocs = await tx.select().from(bookDocs).where(eq(bookDocs.bookId, data.bookId));
      const docIdMap = new Map<string, string>();
      if (srcDocs.length) {
        for (const d of srcDocs) {
          const { id, createdAt, updatedAt, ...r } = d;
          const [newD] = await tx
            .insert(bookDocs)
            .values({ ...r, bookId: newBookId })
            .returning();
          if (newD) docIdMap.set(id, newD.id);
        }
      }

      // 17. book_doc_revisions
      const oldDocIds = [...docIdMap.keys()];
      if (oldDocIds.length) {
        const srcDocRevs = await tx
          .select()
          .from(bookDocRevisions)
          .where(inArray(bookDocRevisions.docId, oldDocIds));
        if (srcDocRevs.length) {
          await tx.insert(bookDocRevisions).values(
            srcDocRevs.map(({ id, createdAt, updatedAt, ...r }) => ({
              ...r,
              docId: docIdMap.get(r.docId) ?? r.docId,
            })),
          );
        }
      }

      return { newBookId };
    });
    await logAudit({
      user: me,
      action: 'books.copy',
      targetType: 'book',
      targetId: result.newBookId,
      summary: `复制书籍 ${data.bookId} → ${result.newBookId}`,
    });
    return result;
  });

export const deleteBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const result = await deleteBookFromShelf(data.bookId);
    await logAudit({
      user: me,
      action: 'books.delete',
      targetType: 'book',
      targetId: data.bookId,
      summary: `删除书籍《${result.title}》`,
    });
    return result;
  });

export const deleteBooksFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z.object({ bookIds: z.array(z.string().uuid()).min(1).max(200) }).parse(raw),
  )
  .handler(async ({ data }) => {
    // 逐本校验所有权（确保没有别人的书被一并删掉）
    for (const id of data.bookIds) {
      await requireBookOwner(id);
    }
    const me = await requireUser();
    const deleted = await deleteBooksFromShelf(data.bookIds);
    await logAudit({
      user: me,
      action: 'books.bulk_delete',
      targetType: 'book',
      targetId: null,
      summary: `批量删除 ${deleted.length} 本书`,
      diff: { deleted },
    });
    return { deletedCount: deleted.length, deleted };
  });

export const produceBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        topicTitle: z.string().min(2).max(40),
        pitch: z.string().min(10),
        elementSlugs: z.array(z.string().min(1)).min(1).max(10),
        totalChapters: z.number().int().min(1).max(40).default(1),
        charsPerChapter: z.number().int().min(800).max(6000).default(3000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireUser();
    const result = await produceBook({ ...data, ownerId: me.id });
    await logAudit({
      user: me,
      action: 'books.produce',
      targetType: 'book',
      targetId: result.bookId,
      summary: `创建并生产《${data.topicTitle}》(${result.chaptersWritten} 章)`,
    });
    return {
      bookId: result.bookId,
      rootRunId: result.rootRunId,
      chaptersWritten: result.chaptersWritten,
      totalCharCount: result.totalCharCount,
      averageCharCount: result.averageCharCount,
    };
  });

export const writeNextChapterFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const r = await writeNextChapter(data.bookId);
    await logAudit({
      user: me,
      action: 'books.write_next_chapter',
      targetType: 'book',
      targetId: data.bookId,
      summary: '续写下一章',
    });
    return r;
  });

export const designBookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z.object({ bookId: z.string().uuid(), feedback: z.string().max(5000).optional() }).parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'design');
    const r = await designForExistingBook({ bookId: data.bookId, feedback: data.feedback });
    await logAudit({
      user: me,
      action: 'books.redesign',
      targetType: 'book',
      targetId: data.bookId,
      summary: data.feedback ? `重新设计（带反馈）` : '重新设计',
    });
    return r;
  });

export const startProductionFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        gateMode: z.enum(['fully-auto', 'auto-with-confirm', 'manual']).default('auto-with-confirm'),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const result = await produceForExistingBook({ bookId: data.bookId, gateMode: data.gateMode });
    await logAudit({
      user: me,
      action: 'books.start_production',
      targetType: 'book',
      targetId: data.bookId,
      summary: `启动生产 (${data.gateMode})`,
    });
    return {
      bookId: result.bookId,
      rootRunId: result.rootRunId,
      chaptersWritten: result.chaptersWritten,
    };
  });

export const deleteLastChapterFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const { deleteLastChapter } = await import('../services/chapters.ts');
    const r = await deleteLastChapter(data.bookId);
    await logAudit({
      user: me,
      action: 'books.delete_last_chapter',
      targetType: 'book',
      targetId: data.bookId,
      summary: '删除最末章',
    });
    return r;
  });

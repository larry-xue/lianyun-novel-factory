import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  deleteDoc,
  getDoc,
  listDocKinds,
  listDocsForBook,
  listRevisions,
  upsertDoc,
  upsertDocKind,
} from '../services/book-docs.ts';
import { db } from '../db/client.ts';
import { bookDocs } from '../db/schema/index.ts';
import { requireAdmin, requireBookOwner } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';

export const listDocKindsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return await listDocKinds();
});

export const listDocsForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const docs = await listDocsForBook(data.bookId);
    const kinds = await listDocKinds();
    return {
      docs: docs.map((d) => ({
        id: d.id,
        bookId: d.bookId,
        kind: d.kind,
        slug: d.slug,
        title: d.title,
        version: d.version,
        lastEditedBy: d.lastEditedBy,
        updatedAt: d.updatedAt,
      })),
      kinds,
    };
  });

export const fetchDocFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        kind: z.string().min(1),
        slug: z.string().min(1),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const doc = await getDoc(data);
    if (!doc) return null;
    const revisions = await listRevisions(doc.id);
    return {
      doc: {
        id: doc.id,
        bookId: doc.bookId,
        kind: doc.kind,
        slug: doc.slug,
        title: doc.title,
        contentMd: doc.contentMd,
        version: doc.version,
        lastEditedBy: doc.lastEditedBy,
        updatedAt: doc.updatedAt,
      },
      revisions: revisions.map((r) => ({
        version: r.version,
        editedBy: r.editedBy,
        reasonMd: r.reasonMd,
        createdAt: r.createdAt,
      })),
    };
  });

export const saveDocFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        kind: z.string().min(1).max(40),
        slug: z.string().min(1).max(120), // 阶段 1.1 起放宽支持 / 划分多级
        title: z.string().min(1).max(120),
        contentMd: z.string().max(200_000),
        reasonMd: z.string().max(400).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    const doc = await upsertDoc({
      ...data,
      editor: 'human',
    });
    await logAudit({
      user: me,
      action: 'book_docs.save',
      targetType: 'book_doc',
      targetId: doc.id,
      summary: `保存文档 ${data.kind}/${data.slug} v${doc.version}`,
      diff: { reasonMd: data.reasonMd ?? '' },
    });
    return { id: doc.id, version: doc.version };
  });

export const upsertDocKindFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        slug: z.string().min(1).max(80),
        zh: z.string().min(1).max(40),
        descriptionMd: z.string().max(2000).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const r = await upsertDocKind({ ...data, introducedBy: 'human' });
    await logAudit({
      user: me,
      action: 'book_doc_kinds.upsert',
      targetType: 'book_doc_kind',
      targetId: data.slug,
      summary: `维护文档类型 ${data.slug} (${data.zh})`,
    });
    return r;
  });

export const deleteDocFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const [doc] = await db.select({ bookId: bookDocs.bookId, kind: bookDocs.kind, slug: bookDocs.slug }).from(bookDocs).where(eq(bookDocs.id, data.id)).limit(1);
    if (!doc) throw new Error('book_doc not found');
    const me = await requireBookOwner(doc.bookId);
    await deleteDoc(data.id);
    await logAudit({
      user: me,
      action: 'book_docs.delete',
      targetType: 'book_doc',
      targetId: data.id,
      summary: `删除文档 ${doc.kind}/${doc.slug}`,
    });
    return { ok: true };
  });

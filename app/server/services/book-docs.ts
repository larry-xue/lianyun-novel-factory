import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  bookDocKinds,
  bookDocRevisions,
  bookDocs,
  books,
  characters as charactersTbl,
  type BookDoc,
  type BookDocKind,
  type BookDocRevision,
} from '../db/schema/index.ts';
import {
  LivingDocUpdateResultSchema,
  livingDocUpdater,
} from '../mastra/agents/living-doc-updater.ts';
import { runChildAgent } from './run-tracer.ts';

/**
 * book_docs 业务层。
 * - upsertDoc 是 agent 主路径：按 (book_id, kind, slug) 找现有，找到改 + 写 revision；找不到建 + 写 v1
 * - editDoc 是 human 编辑路径：相同语义，editor='human'
 * - listKinds / upsertKind 给「AI 自创新分类」用
 */

/**
 * slug 允许 / 划分多级路径（如 character/lin-chen、world/factions/tianhua）。
 * 规则：首字符必须 alnum；后续允许 alnum/-/，但不允许连续 / 或末尾 /。
 * 长度上限 120（之前 80 不够嵌套用）。
 */
const SlugRegex = /^[a-z0-9](?:[a-z0-9-]|\/(?=[a-z0-9])){0,120}$/;

export async function listDocKinds(): Promise<BookDocKind[]> {
  return await db
    .select()
    .from(bookDocKinds)
    .orderBy(asc(bookDocKinds.introducedBy), asc(bookDocKinds.slug));
}

export async function upsertDocKind(input: {
  slug: string;
  zh: string;
  descriptionMd?: string;
  introducedBy: 'agent' | 'human';
}): Promise<BookDocKind> {
  const slug = z.string().regex(SlugRegex).parse(input.slug);
  const zh = z.string().min(1).max(40).parse(input.zh);
  const [row] = await db
    .insert(bookDocKinds)
    .values({
      slug,
      zh,
      descriptionMd: input.descriptionMd ?? '',
      introducedBy: input.introducedBy,
    })
    .onConflictDoUpdate({
      target: bookDocKinds.slug,
      set: { zh, descriptionMd: input.descriptionMd ?? '' },
    })
    .returning();
  return row!;
}

export async function listDocsForBook(bookId: string): Promise<BookDoc[]> {
  return await db
    .select()
    .from(bookDocs)
    .where(eq(bookDocs.bookId, bookId))
    .orderBy(asc(bookDocs.kind), asc(bookDocs.slug));
}

export async function getDoc(input: {
  bookId: string;
  kind: string;
  slug: string;
}): Promise<BookDoc | null> {
  const [row] = await db
    .select()
    .from(bookDocs)
    .where(
      and(
        eq(bookDocs.bookId, input.bookId),
        eq(bookDocs.kind, input.kind),
        eq(bookDocs.slug, input.slug),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getDocById(id: string): Promise<BookDoc | null> {
  const [row] = await db.select().from(bookDocs).where(eq(bookDocs.id, id)).limit(1);
  return row ?? null;
}

export interface UpsertDocInput {
  bookId: string;
  kind: string;
  slug: string;
  title: string;
  contentMd: string;
  editor: 'agent' | 'human';
  reasonMd?: string;
  generatedByRunId?: string;
  runId?: string;
  /** 结构化数据；存到 book_docs.meta jsonb。update 时不传则保留原值。 */
  meta?: Record<string, unknown>;
}

/**
 * 主路径：写 doc。同 (book/kind/slug) 已存在则版本 +1 + 写 revision。
 * contentMd 与现版完全一致时不写新版（幂等）。
 */
export async function upsertDoc(input: UpsertDocInput): Promise<BookDoc> {
  z.string().regex(SlugRegex).parse(input.slug);
  z.string().min(1).max(120).parse(input.title);

  // 先验 kind 存在；不存在自动 upsert（agent 自创时常见路径）
  const [k] = await db.select().from(bookDocKinds).where(eq(bookDocKinds.slug, input.kind));
  if (!k) {
    await upsertDocKind({
      slug: input.kind,
      zh: input.kind,
      introducedBy: input.editor,
      descriptionMd: '（agent 自创，未填描述）',
    });
  }

  const existing = await getDoc({
    bookId: input.bookId,
    kind: input.kind,
    slug: input.slug,
  });

  if (!existing) {
    const [row] = await db
      .insert(bookDocs)
      .values({
        bookId: input.bookId,
        kind: input.kind,
        slug: input.slug,
        title: input.title,
        contentMd: input.contentMd,
        version: 1,
        lastEditedBy: input.editor,
        generatedByRunId: input.generatedByRunId,
        meta: input.meta ?? {},
      })
      .returning();
    if (!row) throw new Error('upsertDoc: 插入失败');

    await db.insert(bookDocRevisions).values({
      docId: row.id,
      version: 1,
      contentMd: input.contentMd,
      editedBy: input.editor,
      reasonMd: input.reasonMd ?? '初稿',
      runId: input.runId,
    });
    return row;
  }

  if (existing.contentMd === input.contentMd && existing.title === input.title) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const [row] = await db
    .update(bookDocs)
    .set({
      title: input.title,
      contentMd: input.contentMd,
      version: newVersion,
      lastEditedBy: input.editor,
      generatedByRunId: input.generatedByRunId,
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    })
    .where(eq(bookDocs.id, existing.id))
    .returning();
  if (!row) throw new Error('upsertDoc: 更新失败');

  await db.insert(bookDocRevisions).values({
    docId: existing.id,
    version: newVersion,
    contentMd: input.contentMd,
    editedBy: input.editor,
    reasonMd: input.reasonMd ?? (input.editor === 'human' ? '人工修改' : 'agent 修改'),
    runId: input.runId,
  });

  return row;
}

export async function listRevisions(docId: string): Promise<BookDocRevision[]> {
  return await db
    .select()
    .from(bookDocRevisions)
    .where(eq(bookDocRevisions.docId, docId))
    .orderBy(asc(bookDocRevisions.version));
}

export async function deleteDoc(id: string): Promise<void> {
  await db.delete(bookDocs).where(eq(bookDocs.id, id));
}

/**
 * 章节写完后自动更新活文档。
 * 读取已有文档 + 新章节内容 + 管线上下文，调用 living-doc-updater agent，upsert 返回的文档。
 */
export async function updateLivingDocs(opts: {
  bookId: string;
  rootRunId: string;
  chapterIdx: number;
  chapterContentMd: string;
  chapterTitle: string;
  /** chapter-writer 声明的新状态（角色、事件摘要、伏笔动作） */
  newState?: {
    arcStage?: string;
    activeCharacters?: Array<{ name: string; status?: string }>;
    lastEventSummaryMd?: string;
    threadActions?: Array<{
      kind: string;
      slug?: string;
      title?: string;
      noteMd?: string;
    }>;
  };
  /** chapter-planner 的战术计划 */
  chapterPlan?: {
    intent?: string;
    keyBeats?: string[];
  };
}): Promise<{ updated: string[] }> {
  const [book] = await db.select().from(books).where(eq(books.id, opts.bookId));
  if (!book) throw new Error(`book ${opts.bookId} 不存在`);

  const existing = await listDocsForBook(opts.bookId);

  const existingBlock = existing.length
    ? existing
        .map(
          (d) =>
            `### [${d.kind}/${d.slug}] ${d.title}（v${d.version}）\n${d.contentMd}`,
        )
        .join('\n\n')
    : '（暂无活文档）';

  const chars = await db
    .select({ name: charactersTbl.name, role: charactersTbl.role })
    .from(charactersTbl)
    .where(eq(charactersTbl.bookId, opts.bookId));

  const charsDigest = chars.length
    ? chars.map((c) => `- ${c.name}（${c.role || '未定义角色'}）`).join('\n')
    : '（暂无角色）';

  // 管线上下文：chapter-writer 声明的状态 + chapter-planner 的计划
  const stateBlock = opts.newState
    ? [
        `## 写手声明的状态`,
        opts.newState.arcStage ? `阶段：${opts.newState.arcStage}` : '',
        opts.newState.lastEventSummaryMd ? `事件摘要：${opts.newState.lastEventSummaryMd}` : '',
        opts.newState.activeCharacters?.length
          ? `在场角色：${opts.newState.activeCharacters.map((c) => `${c.name}（${c.status || ''}）`).join('、')}`
          : '',
        opts.newState.threadActions?.length
          ? `伏笔动作：${opts.newState.threadActions.map((a) => `${a.kind} ${a.slug || a.title || ''} ${a.noteMd || ''}`).join('；')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const planBlock = opts.chapterPlan
    ? [
        `## 章节战术计划`,
        opts.chapterPlan.intent ? `意图：${opts.chapterPlan.intent}` : '',
        opts.chapterPlan.keyBeats?.length
          ? `关键节拍：\n${opts.chapterPlan.keyBeats.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const prompt = [
    `## 书`,
    `《${book.title}》`,
    ``,
    `## 角色清单`,
    charsDigest,
    ``,
    `## 已有活文档（完整内容，更新时在此基础上增量修改）`,
    existingBlock,
    ``,
    `## 本章（第 ${opts.chapterIdx} 章 ${opts.chapterTitle}）`,
    truncate(opts.chapterContentMd, 6000),
    ``,
    ...(stateBlock ? [stateBlock, ''] : []),
    ...(planBlock ? [planBlock, ''] : []),
    `## 任务`,
    `根据本章内容，决定需要更新或新建哪些活文档。输出 JSON。`,
    ``,
    `**必做**：`,
    `1. 检查角色清单，每个角色都应有对应的 character 文档（kind="character"），新建角色必须创建`,
    `2. 检查 relations/character-relations 关系图是否需要更新`,
  ].join('\n');

  const { result } = await runChildAgent({
    kind: 'living-doc-updater',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { chapterIdx: opts.chapterIdx, docCount: existing.length },
    agent: livingDocUpdater,
    schema: LivingDocUpdateResultSchema,
    prompt,
  });

  const updated: string[] = [];
  for (const doc of result.docs) {
    const existingDoc = existing.find((d) => d.kind === doc.kind && d.slug === doc.slug);
    await upsertDoc({
      bookId: opts.bookId,
      kind: doc.kind,
      slug: doc.slug,
      title: doc.title,
      contentMd: doc.contentMd,
      editor: 'agent',
      reasonMd: doc.reasonMd,
      runId: opts.rootRunId,
      generatedByRunId: opts.rootRunId,
    });
    updated.push(`${doc.kind}/${doc.slug}`);
  }

  if (updated.length) {
    console.log(
      `[living-doc-updater] ch${opts.chapterIdx}: updated ${updated.length} doc(s): ${updated.join(', ')}`,
    );
  }

  return { updated };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…（截断）' : s;
}

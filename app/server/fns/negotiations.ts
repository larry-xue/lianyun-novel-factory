import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  agentRespond,
  appendSystemMessage,
  confirmTopic,
  getBookBrief,
  getNegotiationByBook,
  postUserMessage,
  startBookFromIdea,
  startWriting,
} from '../services/topic-negotiations.ts';
import {
  designForExistingBook,
  produceForExistingBook,
  resumeAfterGate1,
  writeNextChapter,
} from '../services/book-producer.ts';
import { db } from '../db/client.ts';
import { books, chapters } from '../db/schema/index.ts';
import { eq } from 'drizzle-orm';
import { requireBookOwner, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import { assertBookNotBusy } from '../services/book-busy.ts';
import type { JsonObject } from './_serializable.ts';

const BookIdInput = z.object({ bookId: z.string().uuid() });

export const startBookFromIdeaFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        briefIdeaMd: z.string().min(10).max(8_000),
        targetTotalChapters: z.number().int().min(1).max(5000).optional(),
        targetCharsPerChapter: z.number().int().min(500).max(8_000).optional(),
        styleSampleIds: z.array(z.string().uuid()).max(10).optional(),
        elementSlugs: z.array(z.string().min(1)).max(20).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireUser();
    const r = await startBookFromIdea({
      briefIdeaMd: data.briefIdeaMd,
      initialPreferences: {
        targetTotalChapters: data.targetTotalChapters,
        targetCharsPerChapter: data.targetCharsPerChapter,
        styleSampleIds: data.styleSampleIds,
        elementSlugs: data.elementSlugs,
      },
      ownerId: me.id,
    });
    await logAudit({
      user: me,
      action: 'negotiations.start',
      targetType: 'book',
      targetId: r.bookId,
      summary: '开始立项 chat',
    });
    return r;
  });

export const fetchNegotiationFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => BookIdInput.parse(raw))
  .handler(async ({ data }) => {
    // 只读：登录即可，非 owner 也可查看 chat 历史
    await requireUser();
    const neg = await getNegotiationByBook(data.bookId);
    const brief = await getBookBrief(data.bookId);
    if (!neg) return { negotiation: null, brief: brief ?? null };
    return {
      negotiation: {
        id: neg.id,
        bookId: neg.bookId,
        status: neg.status,
        topicCardId: neg.topicCardId,
        // messages 含 unknown 类型嵌套，转成 JsonObject 兼容序列化
        messages: neg.messages as unknown as JsonObject[],
        decisions: neg.decisions as JsonObject,
        createdAt: neg.createdAt,
        updatedAt: neg.updatedAt,
      },
      brief: brief
        ? {
            bookId: brief.bookId,
            briefIdeaMd: brief.briefIdeaMd,
            targetTotalChapters: brief.targetTotalChapters,
            targetCharsPerChapter: brief.targetCharsPerChapter,
            targetVolumeCount: brief.targetVolumeCount,
            targetArcsPerVolume: brief.targetArcsPerVolume,
            pacingProfileMd: brief.pacingProfileMd,
            forbiddenMd: brief.forbiddenMd,
            confirmedAt: brief.confirmedAt,
          }
        : null,
    };
  });

export const postUserMessageFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z.object({ bookId: z.string().uuid(), contentMd: z.string().min(1).max(8_000) }).parse(raw),
  )
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    const neg = await postUserMessage(data.bookId, data.contentMd);
    return { messageCount: neg.messages.length };
  });

export const agentRespondFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => BookIdInput.parse(raw))
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'brainstorm');
    const neg = await agentRespond(data.bookId);
    return { messageCount: neg.messages.length };
  });

export const retryConfirmedTopicProductionFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        gateMode: z.enum(['fully-auto', 'auto-with-confirm', 'manual']).default('auto-with-confirm'),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const neg = await getNegotiationByBook(data.bookId);
    if (neg?.status === 'active') {
      throw new Error('选题尚未确认，无法重试立项生产流程。请先让 agent 重新生成候选。');
    }

    // 按当前状态分流：避免重跑 produceForExistingBook 把 status 重置成 'planning'、
    // 复制角色/bookStates 行 0、再开一个新 gate-1。
    const [book] = await db
      .select({ id: books.id, meta: books.meta })
      .from(books)
      .where(eq(books.id, data.bookId));
    if (!book) throw new Error(`book ${data.bookId} 不存在`);

    const existingCh = await db
      .select({ idx: chapters.idx })
      .from(chapters)
      .where(eq(chapters.bookId, data.bookId))
      .limit(1);
    if (existingCh.length > 0) {
      await writeNextChapter(data.bookId);
      return { ok: true, mode: 'write-next-chapter' as const };
    }

    const meta = (book.meta ?? {}) as Record<string, unknown>;
    if (meta.outlineDraft) {
      await resumeAfterGate1(data.bookId);
      return { ok: true, mode: 'resume-after-gate-1' as const };
    }

    await produceForExistingBook({ bookId: data.bookId, gateMode: data.gateMode });
    return { ok: true, mode: 'produce-for-existing-book' as const };
  });

export const confirmTopicFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        /** 立项 → 自动启动 produceForExistingBook（chat 流闭环）。默认 true */
        startProduction: z.boolean().default(true),
        /** 启动模式：默认 auto-with-confirm 让用户在 gate-1 确认后再开始写章 */
        gateMode: z.enum(['fully-auto', 'auto-with-confirm', 'manual']).default('auto-with-confirm'),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'brainstorm');
    const r = await confirmTopic({ bookId: data.bookId });
    await logAudit({
      user: me,
      action: 'negotiations.confirm_topic',
      targetType: 'book',
      targetId: data.bookId,
      summary: `立项确认（startProduction=${data.startProduction}, gateMode=${data.gateMode}）`,
    });

    // 立项确认后同步跑 story-designer：4 份文档落库。design-review-harness
    // 接管 chat 时已有锚点；失败也通报系统消息，让 review agent 自己 regenerate。
    let designError: string | undefined;
    try {
      await designForExistingBook({ bookId: r.bookId });
      await appendSystemMessage(
        r.bookId,
        '【系统】4 份设计文档已生成（story-concept / character-design / world-design / style-design）。design-review 接手中…',
      );
    } catch (e) {
      console.warn(
        `[confirmTopicFn] designForExistingBook(${r.bookId}) 失败：${e instanceof Error ? e.message : e}`,
      );
      designError = e instanceof Error ? e.message : String(e);
      await appendSystemMessage(
        r.bookId,
        `【系统】设计文档生成失败：${designError.slice(0, 200)}。可在 chat 里说 "regenerate" 让 design-review 重做。`,
      );
    }

    // startProduction=true（兼容旧入参）：跳过 design-review，直接 startWriting
    // 推到 'confirmed' + 跑 produceForExistingBook。chat 流默认传 false。
    if (data.startProduction) {
      try {
        await startWriting({ bookId: r.bookId, gateMode: data.gateMode });
      } catch (e) {
        console.warn(
          `[confirmTopicFn] startWriting(${r.bookId}) 失败：${e instanceof Error ? e.message : e}`,
        );
        return {
          ...r,
          ...(designError ? { designError } : {}),
          startProductionError: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return { ...r, ...(designError ? { designError } : {}) };
  });

export const startWritingFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        /** 覆盖 confirm 消息上 produceArgs 的 gateMode（可选） */
        gateMode: z
          .enum(['fully-auto', 'auto-with-confirm', 'manual'])
          .optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const r = await startWriting({
      bookId: data.bookId,
      ...(data.gateMode ? { gateMode: data.gateMode } : {}),
    });
    await logAudit({
      user: me,
      action: 'negotiations.start_writing',
      targetType: 'book',
      targetId: data.bookId,
      summary: `design review 完成，开始写章（gateMode=${r.gateMode}）`,
    });
    return r;
  });

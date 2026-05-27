import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireBookOwner, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import { assertBookNotBusy } from '../services/book-busy.ts';
import {
  agentRespondScout,
  assertNextChapter,
  confirmChapterPlan,
  ensureScoutSession,
  getScoutSession,
  postScoutUserMessage,
} from '../services/chapter-scout-sessions.ts';
import type { JsonObject } from './_serializable.ts';

const BookChapterInput = z.object({
  bookId: z.string().uuid(),
  chapterIdx: z.number().int().min(1).max(5000),
});

export const fetchScoutSessionFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => BookChapterInput.parse(raw))
  .handler(async ({ data }) => {
    // 只读：登录即可，非 owner 也可查看
    await requireUser();
    await assertNextChapter(data.bookId, data.chapterIdx);
    const sess = await ensureScoutSession(data.bookId, data.chapterIdx);
    return {
      session: {
        bookId: sess.bookId,
        chapterIdx: sess.chapterIdx,
        status: sess.status,
        messages: sess.messages as unknown as JsonObject[],
        decisions: sess.decisions as JsonObject,
        createdAt: sess.createdAt,
        updatedAt: sess.updatedAt,
      },
    };
  });

export const postScoutMessageFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        chapterIdx: z.number().int().min(1).max(5000),
        contentMd: z.string().min(1).max(8_000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    await assertNextChapter(data.bookId, data.chapterIdx);
    const sess = await postScoutUserMessage(data.bookId, data.chapterIdx, data.contentMd);
    return { messageCount: sess.messages.length };
  });

export const agentRespondScoutFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => BookChapterInput.parse(raw))
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    await assertNextChapter(data.bookId, data.chapterIdx);
    await assertBookNotBusy(data.bookId, 'brainstorm');
    const sess = await agentRespondScout(data.bookId, data.chapterIdx);
    return { messageCount: sess.messages.length };
  });

export const confirmChapterPlanFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => BookChapterInput.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'brainstorm');
    const r = await confirmChapterPlan({
      bookId: data.bookId,
      chapterIdx: data.chapterIdx,
    });
    await logAudit({
      user: me,
      action: 'chapter_scout.confirm_plan',
      targetType: 'book',
      targetId: data.bookId,
      summary: `chapter-scout 确认第 ${data.chapterIdx} 章规划`,
      diff: { planSlug: r.planSlug },
    });
    return r;
  });

/**
 * 用户在 widget 上点了非 confirm 类的「答复」之后，会通过 postScoutMessageFn
 * 自动走「user 消息 → agentRespond」串联；这个 fn 给前端一键串起来用。
 */
export const sendScoutTurnFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        chapterIdx: z.number().int().min(1).max(5000),
        contentMd: z.string().min(1).max(8_000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    await requireBookOwner(data.bookId);
    await assertNextChapter(data.bookId, data.chapterIdx);
    await assertBookNotBusy(data.bookId, 'brainstorm');
    await postScoutUserMessage(data.bookId, data.chapterIdx, data.contentMd);
    const sess = await agentRespondScout(data.bookId, data.chapterIdx);
    return { messageCount: sess.messages.length, status: sess.status };
  });

/** 抛出场景：在 chat 路由 loader 里查 session 是否存在但不创建 stub. */
export const peekScoutSessionFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => BookChapterInput.parse(raw))
  .handler(async ({ data }) => {
    // 只读：登录即可
    await requireUser();
    const sess = await getScoutSession(data.bookId, data.chapterIdx);
    if (!sess) return { session: null };
    return {
      session: {
        bookId: sess.bookId,
        chapterIdx: sess.chapterIdx,
        status: sess.status,
        messages: sess.messages as unknown as JsonObject[],
        decisions: sess.decisions as JsonObject,
        createdAt: sess.createdAt,
        updatedAt: sess.updatedAt,
      },
    };
  });

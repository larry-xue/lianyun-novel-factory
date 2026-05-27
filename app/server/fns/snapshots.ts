import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireBookOwner, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import {
  listSnapshotsLite,
  restoreToChapter,
} from '../services/chapter-snapshots.ts';
import { assertBookNotBusy } from '../services/book-busy.ts';

const BookIdInput = z.object({ bookId: z.string().uuid() });

export const listSnapshotsFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => BookIdInput.parse(raw))
  .handler(async ({ data }) => {
    // 只读：登录即可，不要求 book owner —— 否则非 owner 打开书详情页 loader 整包 reject，
    // TanStack Start 会渲染 undefined data 让组件 chapters.reduce 崩。
    await requireUser();
    return await listSnapshotsLite(data.bookId);
  });

export const restoreToChapterFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        chapterIdx: z.number().int().min(1).max(5000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireBookOwner(data.bookId);
    await assertBookNotBusy(data.bookId, 'writing');
    const r = await restoreToChapter({
      bookId: data.bookId,
      chapterIdx: data.chapterIdx,
    });
    await logAudit({
      user: me,
      action: 'snapshots.restore',
      targetType: 'book',
      targetId: data.bookId,
      summary: `回退到第 ${data.chapterIdx} 章快照`,
      diff: r as Record<string, unknown>,
    });
    return r;
  });

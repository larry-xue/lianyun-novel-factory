import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  listEventsForThread,
  listThreadsForBook,
} from '../services/plot-threads.ts';

export const listThreadsForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const rows = await listThreadsForBook(data.bookId);
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      weight: t.weight,
      status: t.status,
      introducedAtChapterIdx: t.introducedAtChapterIdx,
      expectedPayoffStart: t.expectedPayoffStart,
      expectedPayoffEnd: t.expectedPayoffEnd,
      payoffTriggerMd: t.payoffTriggerMd,
      detailMd: t.detailMd,
      payoffNotesMd: t.payoffNotesMd,
      createdAt: t.createdAt,
    }));
  });

export const listThreadEventsFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ threadId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const events = await listEventsForThread(data.threadId);
    return events.map((e) => ({
      id: e.id,
      chapterIdx: e.chapterIdx,
      kind: e.kind,
      noteMd: e.noteMd,
      createdAt: e.createdAt,
    }));
  });

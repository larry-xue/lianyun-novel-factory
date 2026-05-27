import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { listForBook } from '../services/outline-nodes.ts';

export const listOutlineNodesForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const rows = await listForBook(data.bookId);
    return rows.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      level: n.level,
      idx: n.idx,
      title: n.title,
      summaryMd: n.summaryMd,
      intent: n.intent,
      pacingPhase: n.pacingPhase,
      status: n.status,
      chapterId: n.chapterId,
    }));
  });

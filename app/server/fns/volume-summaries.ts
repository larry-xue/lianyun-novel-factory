import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { listVolumeSummariesForBook } from '../services/volume-summaries.ts';

export const listVolumeSummariesForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const rows = await listVolumeSummariesForBook(data.bookId);
    return rows.map((v) => ({
      id: v.id,
      volumeIdx: v.volumeIdx,
      volumeName: v.volumeName,
      rangeStart: v.rangeStart,
      rangeEnd: v.rangeEnd,
      summaryMd: v.summaryMd,
      pivotsMd: v.pivotsMd,
      styleDriftNotesMd: v.styleDriftNotesMd,
    }));
  });

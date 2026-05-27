import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  arcSummaries,
  outlineRevisions,
} from '../db/schema/index.ts';
import type { JsonObject } from './_serializable.ts';

interface SerializedArcSummary {
  id: string;
  bookId: string;
  arcIdx: number;
  arcName: string;
  rangeStart: number;
  rangeEnd: number;
  summaryMd: string;
  pivotsMd: string;
  openThreads: string[];
  createdAt: Date;
}

interface SerializedOutlineRevision {
  id: string;
  bookId: string;
  version: number;
  outlineMd: string;
  reasonMd: string;
  triggeredAtChapterIdx: number | null;
  meta: JsonObject;
  createdAt: Date;
}

const idInput = z.object({ bookId: z.string().uuid() });

export const listArcSummariesFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(arcSummaries)
      .where(eq(arcSummaries.bookId, data.bookId))
      .orderBy(arcSummaries.arcIdx);
    return rows as unknown as SerializedArcSummary[];
  });

export const listOutlineRevisionsFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ data }) => {
    const rows = await db
      .select({
        id: outlineRevisions.id,
        bookId: outlineRevisions.bookId,
        version: outlineRevisions.version,
        outlineMd: outlineRevisions.outlineMd,
        reasonMd: outlineRevisions.reasonMd,
        triggeredAtChapterIdx: outlineRevisions.triggeredAtChapterIdx,
        meta: outlineRevisions.meta,
        createdAt: outlineRevisions.createdAt,
      })
      .from(outlineRevisions)
      .where(eq(outlineRevisions.bookId, data.bookId))
      .orderBy(outlineRevisions.version);
    return rows as unknown as SerializedOutlineRevision[];
  });


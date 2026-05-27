import { createServerFn } from '@tanstack/react-start';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { styleSamples } from '../db/schema/index.ts';
import { requireAdmin, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';

export const listStyleSamplesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  return await db
    .select()
    .from(styleSamples)
    .orderBy(desc(styleSamples.createdAt));
});

export const fetchStyleSampleFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const [row] = await db
      .select()
      .from(styleSamples)
      .where(eq(styleSamples.id, data.id));
    if (!row) throw new Error('style_sample not found');
    return row;
  });

const CreateStyleSampleSchema = z.object({
  author: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  tags: z.array(z.string().min(1)).max(15).default([]),
  contentMd: z.string().min(40),
  sourceUrl: z.string().url().optional(),
});

export const createStyleSampleFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => CreateStyleSampleSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const [row] = await db.insert(styleSamples).values(data).returning();
    if (!row) throw new Error('failed to insert style_sample');
    await logAudit({
      user: me,
      action: 'style_samples.create',
      targetType: 'style_sample',
      targetId: row.id,
      summary: `新增范文 ${data.author} · ${data.title}`,
    });
    return row;
  });

export const deleteStyleSampleFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    await db.delete(styleSamples).where(eq(styleSamples.id, data.id));
    await logAudit({
      user: me,
      action: 'style_samples.delete',
      targetType: 'style_sample',
      targetId: data.id,
      summary: `删除范文 ${data.id}`,
    });
    return { ok: true };
  });

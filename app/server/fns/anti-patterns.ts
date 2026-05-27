import { createServerFn } from '@tanstack/react-start';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { antiPatterns } from '../db/schema/index.ts';
import { requireAdmin } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';

export const listAntiPatternsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return await db.select().from(antiPatterns).orderBy(desc(antiPatterns.createdAt));
});

const CreateAntiPatternSchema = z.object({
  kind: z.string().min(1).max(40),
  contentMd: z.string().min(8),
  sourceRunId: z.string().uuid().optional(),
});

export const createAntiPatternFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => CreateAntiPatternSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const [row] = await db.insert(antiPatterns).values(data).returning();
    if (!row) throw new Error('failed to insert anti_pattern');
    await logAudit({
      user: me,
      action: 'anti_patterns.create',
      targetType: 'anti_pattern',
      targetId: row.id,
      summary: `新增反例 ${row.kind}`,
    });
    return row;
  });

export const deleteAntiPatternFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    await db.delete(antiPatterns).where(eq(antiPatterns.id, data.id));
    await logAudit({
      user: me,
      action: 'anti_patterns.delete',
      targetType: 'anti_pattern',
      targetId: data.id,
      summary: `删除反例 ${data.id}`,
    });
    return { ok: true };
  });

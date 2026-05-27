import { createServerFn } from '@tanstack/react-start';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { hooks } from '../db/schema/index.ts';
import { requireAdmin } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';

export const listHooksFn = createServerFn({ method: 'GET' }).handler(async () => {
  return await db.select().from(hooks).orderBy(desc(hooks.createdAt));
});

const CreateHookSchema = z.object({
  name: z.string().min(2).max(40),
  kind: z.enum(['open', 'close', 'cliff', 'reveal']),
  templateMd: z.string().min(8),
  scenarios: z.array(z.string().min(1)).max(20).default([]),
});

export const createHookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => CreateHookSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const [row] = await db.insert(hooks).values(data).returning();
    if (!row) throw new Error('failed to insert hook');
    await logAudit({
      user: me,
      action: 'hooks.create',
      targetType: 'hook',
      targetId: row.id,
      summary: `新增 hook ${row.name}`,
    });
    return row;
  });

export const deleteHookFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    await db.delete(hooks).where(eq(hooks.id, data.id));
    await logAudit({
      user: me,
      action: 'hooks.delete',
      targetType: 'hook',
      targetId: data.id,
      summary: `删除 hook ${data.id}`,
    });
    return { ok: true };
  });

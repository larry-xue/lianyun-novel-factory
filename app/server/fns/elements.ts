import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  createElement,
  deleteElement,
  getElement,
  listElements,
  updateElement,
} from '../services/elements.ts';
import { ElementInsert, ElementUpdate } from '../db/zod.ts';
import { refineElementDraft } from '../services/element-curator.ts';
import { requireAdmin } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';

export const fetchElementsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (raw: unknown) =>
      z
        .object({
          category: z.string().optional(),
          search: z.string().optional(),
        })
        .optional()
        .parse(raw),
  )
  .handler(async ({ data }) => listElements(data));

export const fetchElementFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const row = await getElement(data.id);
    if (!row) throw new Error(`element ${data.id} not found`);
    return row;
  });

export const createElementFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => ElementInsert.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const r = await createElement(data);
    await logAudit({
      user: me,
      action: 'elements.create',
      targetType: 'element',
      targetId: r.id,
      summary: `新增元素 ${r.slug}`,
    });
    return r;
  });

export const updateElementFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: ElementUpdate,
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const r = await updateElement(data.id, data.patch);
    await logAudit({
      user: me,
      action: 'elements.update',
      targetType: 'element',
      targetId: data.id,
      summary: `更新元素`,
      diff: { patch: data.patch as Record<string, unknown> },
    });
    return r;
  });

export const deleteElementFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    await deleteElement(data.id);
    await logAudit({
      user: me,
      action: 'elements.delete',
      targetType: 'element',
      targetId: data.id,
      summary: `删除元素 ${data.id}`,
    });
    return { ok: true as const };
  });

export const refineElementFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        slug: z.string().optional(),
        zh: z.string().min(1),
        category: z.string().min(1),
        hint: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    return refineElementDraft(data);
  });

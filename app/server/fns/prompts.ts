import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  getPrompt,
  listPrompts,
  listRevisions,
  rollbackPrompt,
  savePrompt,
} from '../services/prompts.ts';
import { requireAdmin } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import type { JsonObject } from './_serializable.ts';

export const listPromptsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await listPrompts();
  return rows.map((r) => ({
    slug: r.slug,
    agentId: r.agentId,
    role: r.role,
    title: r.title,
    version: r.version,
    isActive: r.isActive,
    notesMd: r.notesMd,
    updatedAt: r.updatedAt,
  }));
});

export const fetchPromptFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ slug: z.string().min(1) }).parse(raw))
  .handler(async ({ data }) => {
    const prompt = await getPrompt(data.slug);
    if (!prompt) return null;
    const revisions = await listRevisions(data.slug);
    return {
      prompt: {
        slug: prompt.slug,
        agentId: prompt.agentId,
        role: prompt.role,
        title: prompt.title,
        templateMd: prompt.templateMd,
        variables: prompt.variables as unknown as JsonObject[],
        notesMd: prompt.notesMd,
        version: prompt.version,
        isActive: prompt.isActive,
        updatedAt: prompt.updatedAt,
      },
      revisions: revisions.map((r) => ({
        version: r.version,
        editedBy: r.editedBy,
        reasonMd: r.reasonMd,
        createdAt: r.createdAt,
      })),
    };
  });

export const savePromptFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        slug: z.string().min(1).max(100),
        title: z.string().min(1).max(120).optional(),
        templateMd: z.string().min(1).max(80_000),
        notesMd: z.string().max(2_000).optional(),
        reasonMd: z.string().max(400).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const r = await savePrompt({ ...data, editedBy: 'human' });
    await logAudit({
      user: me,
      action: 'prompts.save',
      targetType: 'prompt',
      targetId: data.slug,
      summary: `保存 prompt ${data.slug} v${r.version}`,
      diff: { reasonMd: data.reasonMd ?? '' },
    });
    return { slug: r.slug, version: r.version };
  });

export const rollbackPromptFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) =>
    z.object({ slug: z.string().min(1), toVersion: z.number().int().positive() }).parse(raw),
  )
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const r = await rollbackPrompt(data.slug, data.toVersion);
    await logAudit({
      user: me,
      action: 'prompts.rollback',
      targetType: 'prompt',
      targetId: data.slug,
      summary: `回滚 prompt ${data.slug} 到 v${data.toVersion}`,
    });
    return { slug: r.slug, version: r.version };
  });

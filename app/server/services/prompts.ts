import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { promptRevisions, prompts, type Prompt } from '../db/schema/index.ts';

/**
 * prompt 仓业务层。S0 (P9)。
 *
 * 命名规范：<agent>.<role>(.<variant>) 如 'chapter-writer.system' / 'topic-scout.system'
 * 调用方用 loadPrompt(slug) 拿模板字符串，或 renderPrompt(slug, vars) 直接拿渲染后的 prompt。
 *
 * 模板引擎：朴素 {{var}} 替换。复杂结构 (如角色列表 → bullet) 在 TS 端预格式化成字符串再注入。
 */

const SlugRegex = /^[a-z0-9][a-z0-9.-]{0,80}$/;

export async function listPrompts(): Promise<Prompt[]> {
  return await db.select().from(prompts).orderBy(asc(prompts.agentId), asc(prompts.slug));
}

export async function getPrompt(slug: string): Promise<Prompt | null> {
  const [row] = await db.select().from(prompts).where(eq(prompts.slug, slug)).limit(1);
  return row ?? null;
}

export async function loadPrompt(slug: string): Promise<string> {
  const row = await getPrompt(slug);
  if (!row) throw new Error(`prompt ${slug} 不存在`);
  if (!row.isActive) throw new Error(`prompt ${slug} 已禁用`);
  return row.templateMd;
}

/**
 * 给 agent 文件用：优先取 DB 里的 prompt，DB 不可用 / slug 没 seed / 表为空 时回退到代码硬编码 SYSTEM。
 * 永不抛错（agent 始终能拿到 instructions），失败仅 console.warn。
 */
export async function loadPromptOrFallback(slug: string, fallback: string): Promise<string> {
  try {
    return await loadPrompt(slug);
  } catch (e) {
    console.warn(
      `[prompts] loadPrompt(${slug}) 失败，回退到硬编码：${e instanceof Error ? e.message : e}`,
    );
    return fallback;
  }
}

/**
 * 朴素 {{var}} 替换。未传 var 的占位符保留原样（方便排查）。
 */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export async function renderPrompt(slug: string, vars: Record<string, string>): Promise<string> {
  return applyTemplate(await loadPrompt(slug), vars);
}

export interface SavePromptInput {
  slug: string;
  agentId?: string;
  role?: 'system' | 'user';
  title?: string;
  templateMd: string;
  variables?: Array<{ name: string; description: string; example?: string }>;
  notesMd?: string;
  editedBy: 'agent' | 'human';
  reasonMd?: string;
}

/**
 * upsert：已存在 → 版本 +1 + 写 revision；不存在 → v1（必须给 agentId/role/title 初始化）。
 * templateMd 与现版完全一致时不写新版（幂等）。
 */
export async function savePrompt(input: SavePromptInput): Promise<Prompt> {
  z.string().regex(SlugRegex).parse(input.slug);
  const existing = await getPrompt(input.slug);

  if (!existing) {
    if (!input.agentId || !input.role || !input.title) {
      throw new Error(`savePrompt: 新增 prompt ${input.slug} 必须给 agentId/role/title`);
    }
    const [row] = await db
      .insert(prompts)
      .values({
        slug: input.slug,
        agentId: input.agentId,
        role: input.role,
        title: input.title,
        templateMd: input.templateMd,
        variables: input.variables ?? [],
        notesMd: input.notesMd ?? '',
        version: 1,
        isActive: true,
      })
      .returning();
    if (!row) throw new Error('savePrompt: insert 失败');
    await db.insert(promptRevisions).values({
      slug: input.slug,
      version: 1,
      templateMd: input.templateMd,
      editedBy: input.editedBy,
      reasonMd: input.reasonMd ?? '初稿',
    });
    return row;
  }

  if (existing.templateMd === input.templateMd && (input.title ?? existing.title) === existing.title) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const [row] = await db
    .update(prompts)
    .set({
      templateMd: input.templateMd,
      title: input.title ?? existing.title,
      notesMd: input.notesMd ?? existing.notesMd,
      variables: input.variables ?? existing.variables,
      version: newVersion,
    })
    .where(eq(prompts.slug, input.slug))
    .returning();
  if (!row) throw new Error('savePrompt: update 失败');

  await db.insert(promptRevisions).values({
    slug: input.slug,
    version: newVersion,
    templateMd: input.templateMd,
    editedBy: input.editedBy,
    reasonMd: input.reasonMd ?? (input.editedBy === 'human' ? '人工修改' : 'agent 修改'),
  });

  return row;
}

export async function listRevisions(slug: string) {
  return await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.slug, slug))
    .orderBy(asc(promptRevisions.version));
}

export async function rollbackPrompt(slug: string, toVersion: number): Promise<Prompt> {
  const [rev] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.slug, slug))
    .limit(1)
    .orderBy(asc(promptRevisions.version));
  if (!rev) throw new Error(`prompt ${slug} 没有任何 revision`);

  const target = (await listRevisions(slug)).find((r) => r.version === toVersion);
  if (!target) throw new Error(`prompt ${slug} 没有版本 v${toVersion}`);

  return await savePrompt({
    slug,
    templateMd: target.templateMd,
    editedBy: 'human',
    reasonMd: `回滚到 v${toVersion}`,
  });
}

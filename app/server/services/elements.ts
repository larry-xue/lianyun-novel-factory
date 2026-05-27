import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { elements } from '../db/schema/index.ts';
import { ElementInsert, ElementUpdate } from '../db/zod.ts';

export type ElementRow = typeof elements.$inferSelect;

const IdParam = z.object({ id: z.string().uuid() });
const SlugParam = z.object({ slug: z.string().min(1) });

const ListParams = z
  .object({
    category: z.string().optional(),
    search: z.string().optional(),
  })
  .optional();
export type ElementListParams = z.infer<typeof ListParams>;

export async function listElements(params?: ElementListParams): Promise<ElementRow[]> {
  const parsed = ListParams.parse(params);
  let query = db.select().from(elements).orderBy(asc(elements.category), asc(elements.zh)).$dynamic();
  if (parsed?.category) {
    query = query.where(eq(elements.category, parsed.category));
  }
  if (parsed?.search) {
    const like = `%${parsed.search}%`;
    query = query.where(sql`${elements.zh} ILIKE ${like} OR ${elements.slug} ILIKE ${like}`);
  }
  return await query;
}

export async function getElement(id: string): Promise<ElementRow | null> {
  IdParam.parse({ id });
  const [row] = await db.select().from(elements).where(eq(elements.id, id)).limit(1);
  return row ?? null;
}

export async function getElementBySlug(slug: string): Promise<ElementRow | null> {
  SlugParam.parse({ slug });
  const [row] = await db.select().from(elements).where(eq(elements.slug, slug)).limit(1);
  return row ?? null;
}

export async function createElement(input: unknown): Promise<ElementRow> {
  const parsed = ElementInsert.parse(input);
  const [row] = await db.insert(elements).values(parsed).returning();
  return row!;
}

export async function updateElement(id: string, patch: unknown): Promise<ElementRow> {
  IdParam.parse({ id });
  const parsed = ElementUpdate.parse(patch);
  const [row] = await db.update(elements).set(parsed).where(eq(elements.id, id)).returning();
  if (!row) throw new ElementNotFoundError(id);
  return row;
}

export async function deleteElement(id: string): Promise<void> {
  IdParam.parse({ id });
  const result = await db.delete(elements).where(eq(elements.id, id)).returning({ id: elements.id });
  if (result.length === 0) throw new ElementNotFoundError(id);
}

export async function upsertElementBySlug(input: unknown): Promise<ElementRow> {
  const parsed = ElementInsert.parse(input);
  const [row] = await db
    .insert(elements)
    .values(parsed)
    .onConflictDoUpdate({
      target: elements.slug,
      set: {
        zh: parsed.zh,
        category: parsed.category,
        hotScore: parsed.hotScore ?? sql`${elements.hotScore}`,
        definitionMd: parsed.definitionMd ?? sql`${elements.definitionMd}`,
        comboFriendly: parsed.comboFriendly ?? sql`${elements.comboFriendly}`,
        comboAvoid: parsed.comboAvoid ?? sql`${elements.comboAvoid}`,
      },
    })
    .returning();
  return row!;
}

export class ElementNotFoundError extends Error {
  constructor(id: string) {
    super(`Element ${id} not found`);
    this.name = 'ElementNotFoundError';
  }
}

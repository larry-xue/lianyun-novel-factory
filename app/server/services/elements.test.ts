import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  ElementNotFoundError,
  createElement,
  deleteElement,
  getElement,
  getElementBySlug,
  listElements,
  updateElement,
  upsertElementBySlug,
} from './elements.ts';
import { db } from '../db/client.ts';
import { elements } from '../db/schema/index.ts';

const tag = `test-${Date.now()}`;

afterEach(async () => {
  await db.delete(elements).where(sql`${elements.slug} LIKE ${`${tag}%`}`);
});

describe('elements service', () => {
  it('creates with array defaults and rejects bad slug via zod', async () => {
    const row = await createElement({
      slug: `${tag}-good`,
      zh: '测试',
      category: '测试',
    });
    expect(row.comboFriendly).toEqual([]);
    expect(row.hotScore).toBe(0);
    expect(row.definitionMd).toBe('');

    await expect(
      createElement({ slug: 'BAD SLUG', zh: '坏', category: '测试' }),
    ).rejects.toThrow();
  });

  it('list / get / getBySlug / search work', async () => {
    await createElement({
      slug: `${tag}-a`,
      zh: '末世测试',
      category: '世界设定',
      hotScore: 0.7,
    });
    await createElement({
      slug: `${tag}-b`,
      zh: '种田测试',
      category: '基调',
      hotScore: 0.5,
    });

    const all = await listElements();
    const ours = all.filter((e) => e.slug.startsWith(tag));
    expect(ours).toHaveLength(2);

    const filtered = await listElements({ category: '世界设定' });
    expect(filtered.some((e) => e.slug === `${tag}-a`)).toBe(true);
    expect(filtered.some((e) => e.slug === `${tag}-b`)).toBe(false);

    const searched = await listElements({ search: '种田' });
    expect(searched.some((e) => e.slug === `${tag}-b`)).toBe(true);

    const bySlug = await getElementBySlug(`${tag}-a`);
    expect(bySlug?.zh).toBe('末世测试');
    expect(await getElementBySlug(`${tag}-nope`)).toBeNull();

    const byId = await getElement(bySlug!.id);
    expect(byId?.id).toBe(bySlug!.id);
  });

  it('updates and deletes; throws ElementNotFoundError on missing id', async () => {
    const row = await createElement({
      slug: `${tag}-u`,
      zh: 'u',
      category: 'c',
    });
    const updated = await updateElement(row.id, { hotScore: 0.9, definitionMd: 'hi' });
    expect(updated.hotScore).toBe(0.9);
    expect(updated.definitionMd).toBe('hi');

    await deleteElement(row.id);
    expect(await getElement(row.id)).toBeNull();

    await expect(
      updateElement('00000000-0000-0000-0000-000000000000', { zh: 'x' }),
    ).rejects.toBeInstanceOf(ElementNotFoundError);
    await expect(
      deleteElement('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(ElementNotFoundError);
  });

  it('upsertElementBySlug merges instead of failing on duplicate slug', async () => {
    const slug = `${tag}-up`;
    const a = await upsertElementBySlug({ slug, zh: 'v1', category: 'c', hotScore: 0.3 });
    const b = await upsertElementBySlug({
      slug,
      zh: 'v2',
      category: 'c',
      hotScore: 0.8,
      definitionMd: '改了',
    });
    expect(a.id).toBe(b.id);
    expect(b.zh).toBe('v2');
    expect(b.hotScore).toBe(0.8);
    expect(b.definitionMd).toBe('改了');
  });
});

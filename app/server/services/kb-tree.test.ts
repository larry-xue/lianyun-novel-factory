import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { antiPatterns, elements, hooks } from '../db/schema/index.ts';
import { grepKb, listKb, loadKbSnapshot, readKb } from './kb-tree.ts';

const cleanup: { elementSlugs: string[]; hookNames: string[]; antiKinds: string[] } = {
  elementSlugs: [],
  hookNames: [],
  antiKinds: [],
};

afterEach(async () => {
  if (cleanup.elementSlugs.length) {
    await db.delete(elements).where(inArray(elements.slug, cleanup.elementSlugs));
    cleanup.elementSlugs.length = 0;
  }
  if (cleanup.hookNames.length) {
    await db.delete(hooks).where(inArray(hooks.name, cleanup.hookNames));
    cleanup.hookNames.length = 0;
  }
  if (cleanup.antiKinds.length) {
    await db.delete(antiPatterns).where(inArray(antiPatterns.kind, cleanup.antiKinds));
    cleanup.antiKinds.length = 0;
  }
});

describe('kb-tree', () => {
  it('listKb 顶层至少有 elements / classification', async () => {
    const snap = await loadKbSnapshot();
    const top = listKb(snap, '');
    expect(top).toMatch(/elements\//);
    expect(top).toMatch(/classification\//);
  });

  it('listKb classification 列出 main / themes / character / plot', async () => {
    const snap = await loadKbSnapshot();
    const out = listKb(snap, 'classification');
    expect(out).toContain('main.md');
    expect(out).toContain('themes.md');
    expect(out).toContain('character.md');
    expect(out).toContain('plot.md');
  });

  it('readKb classification/main.md 含主分类 + 描述', async () => {
    const snap = await loadKbSnapshot();
    const md = readKb(snap, '/classification/main.md');
    expect(md).toContain('# 主分类');
    expect(md).toContain('西方奇幻');
    expect(md).toContain('修仙');
  });

  it('readKb 不存在的路径返回友好错误', async () => {
    const snap = await loadKbSnapshot();
    expect(readKb(snap, '/nope.md')).toContain('路径不存在');
  });

  it('listKb 不存在的目录返回友好错误', async () => {
    const snap = await loadKbSnapshot();
    expect(listKb(snap, 'no-such-dir')).toContain('不存在或为空');
  });

  it('grepKb 在 classification 里找到指定关键词', async () => {
    const snap = await loadKbSnapshot();
    const out = grepKb(snap, '都市', 'classification');
    expect(out).toMatch(/classification\/main\.md/);
    expect(out).toMatch(/都市/);
  });

  it('grepKb 无匹配时返回友好提示', async () => {
    const snap = await loadKbSnapshot();
    const out = grepKb(snap, 'absolutely-no-such-string-zzz', '');
    expect(out).toContain('无匹配');
  });

  it('elements 表有数据时 listKb /elements 列出 .md 条目', async () => {
    const slug = `__kb_test_${Date.now()}`;
    await db.insert(elements).values({
      slug,
      zh: '测试元素',
      category: 'test',
      definitionMd: '一个测试元素，用于 kb-tree 单测。',
    });
    cleanup.elementSlugs.push(slug);

    const snap = await loadKbSnapshot();
    const out = listKb(snap, 'elements');
    expect(out).toContain(`${slug}.md`);

    const md = readKb(snap, `/elements/${slug}.md`);
    expect(md).toContain('测试元素');
    expect(md).toContain('一个测试元素');
  });

  it('hooks 表有数据时落到 /hooks/ 目录', async () => {
    const name = `__kb_hook_${Date.now()}`;
    await db.insert(hooks).values({
      name,
      kind: 'open',
      templateMd: '反差强势开局：主角看似废材，第一章末翻盘。',
      scenarios: ['都市', '系统'],
    });
    cleanup.hookNames.push(name);

    const snap = await loadKbSnapshot();
    const out = listKb(snap, 'hooks');
    expect(out).toMatch(/\.md/);

    const grep = grepKb(snap, '反差强势开局', 'hooks');
    expect(grep).toMatch(/hooks\//);
  });
});

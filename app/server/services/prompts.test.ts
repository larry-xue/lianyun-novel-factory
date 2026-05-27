import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { promptRevisions, prompts } from '../db/schema/index.ts';
import {
  applyTemplate,
  getPrompt,
  listRevisions,
  loadPrompt,
  renderPrompt,
  rollbackPrompt,
  savePrompt,
} from './prompts.ts';

// slug 必须以 a-z0-9 开头，不能用 _
const slugTag = `t${Date.now()}`;

beforeAll(async () => {
  // nothing
});

afterAll(async () => {
  await db.delete(prompts).where(sql`${prompts.slug} LIKE ${`${slugTag}%`}`);
  await db
    .delete(promptRevisions)
    .where(sql`${promptRevisions.slug} LIKE ${`${slugTag}%`}`);
});

describe('prompts service', () => {
  it('applyTemplate replaces {{var}} with values, leaves unknowns', () => {
    expect(applyTemplate('hi {{name}}, age {{age}}', { name: '张三', age: '30' })).toBe(
      'hi 张三, age 30',
    );
    expect(applyTemplate('{{a}}/{{b}}', { a: 'x' })).toBe('x/{{b}}');
  });

  it('savePrompt creates v1 then bumps version on second save', async () => {
    const slug = `${slugTag}-save`;
    const v1 = await savePrompt({
      slug,
      agentId: 'test-agent',
      role: 'system',
      title: '测试 prompt',
      templateMd: '初版 {{topic}}',
      editedBy: 'human',
    });
    expect(v1.version).toBe(1);

    const v2 = await savePrompt({
      slug,
      templateMd: 'v2 {{topic}} ({{audience}})',
      editedBy: 'human',
      reasonMd: '加 audience 占位符',
    });
    expect(v2.version).toBe(2);
    expect(v2.templateMd).toContain('audience');

    const revs = await listRevisions(slug);
    expect(revs.map((r) => r.version)).toEqual([1, 2]);
    expect(revs[1]!.reasonMd).toContain('audience');
  });

  it('savePrompt is idempotent: identical template → no new revision', async () => {
    const slug = `${slugTag}-idem`;
    await savePrompt({
      slug,
      agentId: 'test-agent',
      role: 'system',
      title: 'x',
      templateMd: 'same',
      editedBy: 'human',
    });
    const again = await savePrompt({
      slug,
      templateMd: 'same',
      editedBy: 'human',
    });
    expect(again.version).toBe(1);
    const revs = await listRevisions(slug);
    expect(revs).toHaveLength(1);
  });

  it('savePrompt requires agentId/role/title for first version', async () => {
    await expect(
      savePrompt({
        slug: `${slugTag}-bad`,
        templateMd: 'no metadata',
        editedBy: 'human',
      }),
    ).rejects.toThrow();
  });

  it('renderPrompt loads + substitutes', async () => {
    const slug = `${slugTag}-render`;
    await savePrompt({
      slug,
      agentId: 'test-agent',
      role: 'user',
      title: 'render 测试',
      templateMd: '请写第 {{idx}} 章，主题 {{topic}}',
      editedBy: 'human',
    });
    const out = await renderPrompt(slug, { idx: '5', topic: '末世重生' });
    expect(out).toBe('请写第 5 章，主题 末世重生');
  });

  it('loadPrompt throws on missing slug', async () => {
    await expect(loadPrompt(`${slugTag}-nope`)).rejects.toThrow();
  });

  it('rollbackPrompt restores old template as new version', async () => {
    const slug = `${slugTag}-rb`;
    await savePrompt({
      slug,
      agentId: 'test-agent',
      role: 'system',
      title: 'rb',
      templateMd: 'v1 内容',
      editedBy: 'human',
    });
    await savePrompt({ slug, templateMd: 'v2 内容（坏改动）', editedBy: 'human' });
    expect((await getPrompt(slug))!.version).toBe(2);

    const v3 = await rollbackPrompt(slug, 1);
    expect(v3.version).toBe(3);
    expect(v3.templateMd).toBe('v1 内容');
  });
});

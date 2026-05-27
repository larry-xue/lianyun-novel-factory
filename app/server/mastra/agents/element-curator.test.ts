import { describe, expect, it } from 'vitest';
import { ElementDraftSchema, elementCurator } from './element-curator.ts';

describe('element-curator agent', () => {
  it('exposes a Mastra agent with id, name, and instructions', () => {
    expect(elementCurator.id).toBe('element-curator');
    expect(elementCurator.name).toBe('元素词典管理员');
    expect(typeof elementCurator.getInstructions).toBe('function');
  });

  it('ElementDraftSchema rejects invalid slugs and short definitions', () => {
    expect(() =>
      ElementDraftSchema.parse({
        slug: 'BAD SLUG',
        zh: '坏',
        category: 'x',
        hotScore: 0.5,
        comboFriendly: [],
        comboAvoid: [],
        definitionMd: 'too short',
      }),
    ).toThrow();

    const ok = ElementDraftSchema.parse({
      slug: 'good-slug',
      zh: '试',
      category: '世界设定',
      hotScore: 0.5,
      comboFriendly: ['high-martial'],
      comboAvoid: [],
      definitionMd:
        '## 一句话定义\n足够长的定义文本以满足 80 字符的最小要求，描述这是一个测试元素。\n## 核心爽点\n一些爽点\n## 典型套路\n套路内容\n## 读者画像\n读者画像\n## 避雷\n避雷点',
    });
    expect(ok.slug).toBe('good-slug');
  });

  it('ElementDraftSchema clamps hotScore range', () => {
    expect(() =>
      ElementDraftSchema.parse({
        slug: 'x',
        zh: '试',
        category: 'c',
        hotScore: 1.5,
        comboFriendly: [],
        comboAvoid: [],
        definitionMd: 'a'.repeat(100),
      }),
    ).toThrow();
  });
});

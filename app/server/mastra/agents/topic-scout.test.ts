import { describe, expect, it } from 'vitest';
import {
  TopicProposalSchema,
  TopicProposalSetSchema,
  topicScout,
} from './topic-scout.ts';

describe('topic-scout agent', () => {
  it('exposes a Mastra agent with id, name', () => {
    expect(topicScout.id).toBe('topic-scout');
    expect(topicScout.name).toBe('选题侦察');
  });

  it('TopicProposalSchema clamps score range and shape', () => {
    const ok = TopicProposalSchema.parse({
      title: '末世重生囤货',
      hook: '社畜重生末世前 7 天，靠预知囤够 200 平米物资。',
      elementSlugs: ['post-apocalypse', 'rebirth'],
      targetAudience: '男频末世',
      classification: { mainCategory: '科幻末世', themes: ['末日求生'], characterTypes: [], plotElements: ['囤物资'] },
      scoreOverall: 0.78,
      scoreBreakdown: { novelty: 0.6, fit: 0.85, explosiveness: 0.9 },
      notesMd: 'x'.repeat(80),
    });
    expect(ok.elementSlugs).toContain('rebirth');

    expect(() =>
      TopicProposalSchema.parse({
        title: '冲',
        hook: '太短',
        elementSlugs: [],
        targetAudience: '男频',
        classification: { mainCategory: '科幻末世' },
        scoreOverall: 1.5,
        scoreBreakdown: { novelty: 1, fit: 1, explosiveness: 1 },
        notesMd: 'x'.repeat(80),
      }),
    ).toThrow();
  });

  it('TopicProposalSetSchema requires at least one proposal', () => {
    expect(() =>
      TopicProposalSetSchema.parse({
        proposals: [],
        reasoningMd: 'x'.repeat(40),
        followUpQuestions: [],
      }),
    ).toThrow();
  });

  it('TopicProposalSetSchema accepts a 2-proposal response with follow-ups', () => {
    const set = TopicProposalSetSchema.parse({
      proposals: [
        {
          title: '末世重生囤货',
          hook: 'x'.repeat(40),
          elementSlugs: ['post-apocalypse', 'rebirth'],
          targetAudience: '男频末世',
          classification: { mainCategory: '科幻末世', themes: ['末日求生'], characterTypes: [], plotElements: ['囤物资'] },
          scoreOverall: 0.8,
          scoreBreakdown: { novelty: 0.7, fit: 0.85, explosiveness: 0.9 },
          notesMd: 'x'.repeat(80),
        },
        {
          title: '高武之巅',
          hook: 'x'.repeat(40),
          elementSlugs: ['high-martial', 'face-slap'],
          targetAudience: '男频热血',
          classification: { mainCategory: '都市高武', themes: ['高武世界'], characterTypes: ['大佬'], plotElements: ['升级流'] },
          scoreOverall: 0.72,
          scoreBreakdown: { novelty: 0.55, fit: 0.8, explosiveness: 0.8 },
          notesMd: 'x'.repeat(80),
        },
      ],
      reasoningMd: '两个方向各对应一类爽点：囤积 vs 战斗。',
      followUpQuestions: ['更偏重囤货还是战斗？', '可以接受血腥吗？'],
    });
    expect(set.proposals).toHaveLength(2);
    expect(set.followUpQuestions).toHaveLength(2);
  });
});

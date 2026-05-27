import { describe, expect, it } from 'vitest';
import {
  BatchChapterPlanResultSchema,
  ChapterPlanResultSchema,
  MilestoneSchema,
  chapterPlanner,
} from './chapter-planner.ts';

describe('chapter-planner agent', () => {
  it('exposes a Mastra agent with id, name, and instructions', () => {
    expect(chapterPlanner.id).toBe('chapter-planner');
    expect(chapterPlanner.name).toBe('章节策划师');
  });
});

describe('ChapterPlanResultSchema', () => {
  const basePlan = {
    title: '暗流涌动',
    keyBeats: [
      '陈景安在集市偶遇苏婉清的丫鬟，得知苏家近来频繁出入城主府',
      '回府后发现母亲房中有陌生来客留下的茶渍',
      '章末：一封信被塞进门缝，内容只有一行字——"你父亲的死不是意外"',
    ],
    intent: '让陈景安开始怀疑父亲死因，触发调查线',
    estimatedArcStage: '上升',
  };

  it('parses a valid plan with all fields', () => {
    const r = ChapterPlanResultSchema.parse({
      ...basePlan,
      threadPlan: [
        { slug: 'father-death', action: 'hint', reasonMd: '信件暗示死因不简单' },
        { slug: 'su-family', action: 'hint', reasonMd: '丫鬟出入城主府是伏笔' },
      ],
      pacingGuidance: '慢燃，不揭真相，积累信息差',
    });
    expect(r.title).toBe('暗流涌动');
    expect(r.keyBeats).toHaveLength(3);
    expect(r.threadPlan).toHaveLength(2);
    expect(r.threadPlan[0]!.action).toBe('hint');
  });

  it('defaults threadPlan to [] when missing', () => {
    const r = ChapterPlanResultSchema.parse(basePlan);
    expect(r.threadPlan).toEqual([]);
  });

  it('defaults threadPlan to [] on malformed input', () => {
    const r = ChapterPlanResultSchema.parse({ ...basePlan, threadPlan: null });
    expect(r.threadPlan).toEqual([]);
  });

  it('rejects empty keyBeats', () => {
    expect(() =>
      ChapterPlanResultSchema.parse({ ...basePlan, keyBeats: [] }),
    ).toThrow();
  });

  it('rejects empty intent', () => {
    expect(() =>
      ChapterPlanResultSchema.parse({ ...basePlan, intent: '' }),
    ).toThrow();
  });

  it('accepts a plan with threadPlan action=skip', () => {
    const r = ChapterPlanResultSchema.parse({
      ...basePlan,
      threadPlan: [
        { slug: 'ancient-ruins', action: 'skip', reasonMd: '本章聚焦人物关系，暂不推进探索线' },
      ],
    });
    expect(r.threadPlan[0]!.action).toBe('skip');
  });

  it('accepts up to 8 keyBeats', () => {
    const r = ChapterPlanResultSchema.parse({
      ...basePlan,
      keyBeats: Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 个节拍内容`),
    });
    expect(r.keyBeats).toHaveLength(8);
  });

  it('rejects more than 8 keyBeats', () => {
    expect(() =>
      ChapterPlanResultSchema.parse({
        ...basePlan,
        keyBeats: Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 个节拍内容`),
      }),
    ).toThrow();
  });
});

describe('BatchChapterPlanResultSchema (milestone + beats)', () => {
  const validMilestone = {
    name: '外门起步',
    goalMd: '从主角刚入宗门、毫无人脉，推进到结识首位盟友 + 解锁外门资源使用资格；为下一段进入选拔做铺垫。',
    keyAnchors: [
      '在执事堂偶遇核心 NPC 苏婉清，被她警告',
      '解锁外门储物阁权限',
      '回收伏笔 P0：师父留下的玉佩反应剧烈',
    ],
    pacingPhase: '上升',
    povCharacter: '陈景安',
    newConcepts: [],
  };
  const validBeats = [
    { idx: 1, title: '入门', summaryMd: '主角抵达宗门外门，被分派到杂役院。' },
    { idx: 2, title: '初识', summaryMd: '在执事堂偶遇苏婉清，对方留下警告。' },
    { idx: 3, title: '小试', summaryMd: '主角试用玉佩，引发不寻常反应。' },
  ];

  it('parses a valid milestone + beats', () => {
    const r = BatchChapterPlanResultSchema.parse({
      milestone: validMilestone,
      chapterBeats: validBeats,
    });
    expect(r.milestone.name).toBe('外门起步');
    expect(r.milestone.keyAnchors).toHaveLength(3);
    expect(r.milestone.pacingPhase).toBe('上升');
    expect(r.milestone.povCharacter).toBe('陈景安');
    expect(r.milestone.newConcepts).toEqual([]);
    expect(r.chapterBeats).toHaveLength(3);
    // beats 不再带 pacingPhase
    expect((r.chapterBeats[0] as Record<string, unknown>).pacingPhase).toBeUndefined();
  });

  it('milestone defaults pacingPhase to 上升 when missing/invalid', () => {
    const r = MilestoneSchema.parse({ ...validMilestone, pacingPhase: undefined });
    expect(r.pacingPhase).toBe('上升');
    const r2 = MilestoneSchema.parse({ ...validMilestone, pacingPhase: 'random-bad' });
    expect(r2.pacingPhase).toBe('上升');
  });

  it('rejects milestone with fewer than 2 keyAnchors', () => {
    expect(() =>
      MilestoneSchema.parse({ ...validMilestone, keyAnchors: ['only one'] }),
    ).toThrow();
  });

  it('rejects milestone with goalMd shorter than 20 chars', () => {
    expect(() =>
      MilestoneSchema.parse({ ...validMilestone, goalMd: '太短了' }),
    ).toThrow();
  });

  it('rejects batch result missing milestone', () => {
    expect(() =>
      BatchChapterPlanResultSchema.parse({ chapterBeats: validBeats }),
    ).toThrow();
  });

  it('rejects batch result with empty chapterBeats', () => {
    expect(() =>
      BatchChapterPlanResultSchema.parse({ milestone: validMilestone, chapterBeats: [] }),
    ).toThrow();
  });

  it('rejects milestone without povCharacter', () => {
    const { povCharacter: _drop, ...m } = validMilestone;
    expect(() => MilestoneSchema.parse(m)).toThrow();
  });

  it('rejects milestone with empty povCharacter', () => {
    expect(() => MilestoneSchema.parse({ ...validMilestone, povCharacter: '' })).toThrow();
  });

  it('newConcepts defaults to [] when missing', () => {
    const { newConcepts: _drop, ...m } = validMilestone;
    const r = MilestoneSchema.parse(m);
    expect(r.newConcepts).toEqual([]);
  });

  it('newConcepts allows at most 1 entry', () => {
    const r = MilestoneSchema.parse({ ...validMilestone, newConcepts: ['炼丹一脉'] });
    expect(r.newConcepts).toHaveLength(1);
    expect(() =>
      MilestoneSchema.parse({ ...validMilestone, newConcepts: ['concept-a', 'concept-b'] }),
    ).toThrow();
  });
});

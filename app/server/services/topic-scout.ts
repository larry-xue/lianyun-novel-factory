import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { elements, runs, topicCards } from '../db/schema/index.ts';
import {
  TopicProposalSchema,
  TopicProposalSetSchema,
  topicScout,
  type TopicProposal,
  type TopicProposalSet,
} from '../mastra/agents/topic-scout.ts';
import { runChildAgent } from './run-tracer.ts';

export const ProposeTopicsInputSchema = z.object({
  briefMd: z.string().min(8).max(8_000),
  count: z.number().int().min(1).max(5).default(3),
  seedElementSlugs: z.array(z.string().min(1)).max(15).default([]),
  /** 上一轮 proposals + 用户反馈，让 agent 知道"上次怎么想的、哪不对" */
  previous: z
    .object({
      proposals: z.array(TopicProposalSchema),
      userFeedbackMd: z.string().min(2).max(2_000),
    })
    .optional(),
});
export type ProposeTopicsInput = z.infer<typeof ProposeTopicsInputSchema>;

export const ApproveTopicInputSchema = z.object({
  proposal: TopicProposalSchema,
  /** 用户对 proposal 的修改（可空） */
  overrides: z
    .object({
      title: z.string().min(2).max(40).optional(),
      hook: z.string().min(0).max(160).optional(),
      targetAudience: z.string().min(0).max(40).optional(),
      notesMd: z.string().max(2_000).optional(),
    })
    .default({}),
  status: z.enum(['draft', 'approved']).default('approved'),
});
export type ApproveTopicInput = z.infer<typeof ApproveTopicInputSchema>;

/**
 * 给 user brief + 可选的 element 偏好 → 推几张候选选题卡。
 * 不入库；调用方拿到结果跟用户讨论。
 */
export async function proposeTopics(input: unknown): Promise<{
  rootRunId: string;
  set: TopicProposalSet;
}> {
  const cfg = ProposeTopicsInputSchema.parse(input);

  const elementRows = await db.select().from(elements);
  const elementCatalog = elementRows
    .map((e) => `- ${e.slug} | ${e.zh} | ${e.category} | hot=${e.hotScore.toFixed(2)}`)
    .join('\n');

  const seedHint = cfg.seedElementSlugs.length
    ? `\n## 用户偏好的元素（优先考虑组合）\n${cfg.seedElementSlugs.join(', ')}`
    : '';

  const previousBlock = cfg.previous
    ? [
        ``,
        `## 上一轮的 proposals（用户已看过）`,
        cfg.previous.proposals
          .map(
            (p, i) =>
              `### 候选 ${i + 1} ${p.title}\n- elements: ${p.elementSlugs.join(', ')}\n- hook: ${p.hook}\n- audience: ${p.targetAudience}\n- score: ${p.scoreOverall}`,
          )
          .join('\n'),
        ``,
        `## 用户对上一轮的反馈（必须吸收）`,
        cfg.previous.userFeedbackMd,
      ].join('\n')
    : '';

  const [rootRun] = await db
    .insert(runs)
    .values({
      kind: 'topic-scout',
      status: 'running',
      input: cfg as unknown as Record<string, unknown>,
      startedAt: new Date(),
    })
    .returning();
  if (!rootRun) throw new Error('failed to insert root run');

  try {
    const prompt = [
      `## 用户文案 / 要求`,
      cfg.briefMd,
      seedHint,
      ``,
      `## 元素词典（仅能从这里选 slug）`,
      elementCatalog || '（词典为空，先去填）',
      ``,
      `## 任务`,
      `输出 JSON: { proposals: ${cfg.count} 个候选, reasoningMd, followUpQuestions }。proposals 之间要差异化，不要换个标题、元素一样。`,
      previousBlock,
    ].join('\n');

    const { result } = await runChildAgent({
      kind: 'topic-scout-call',
      parentRunId: rootRun.id,
      input: { briefLen: cfg.briefMd.length, count: cfg.count },
      agent: topicScout,
      schema: TopicProposalSetSchema,
      prompt,
    });

    const knownSlugs = new Set(elementRows.map((e) => e.slug));
    for (const p of result.proposals) {
      const bad = p.elementSlugs.filter((s) => !knownSlugs.has(s));
      if (bad.length) {
        throw new Error(
          `topic-scout 返回未注册的 elementSlug: ${bad.join(', ')}（${p.title}）`,
        );
      }
    }

    await db
      .update(runs)
      .set({
        status: 'success',
        finishedAt: new Date(),
        output: { proposals: result.proposals.length } as Record<string, unknown>,
      })
      .where(eq(runs.id, rootRun.id));

    return { rootRunId: rootRun.id, set: result };
  } catch (err) {
    await db
      .update(runs)
      .set({
        status: 'failure',
        finishedAt: new Date(),
        errorMd: err instanceof Error ? err.message : String(err),
      })
      .where(eq(runs.id, rootRun.id));
    throw err;
  }
}

/**
 * 用户确认某个 proposal 后，把它（含 overrides）持久化到 topic_cards。
 */
export async function approveTopicProposal(input: unknown): Promise<{
  topicCardId: string;
  status: 'draft' | 'approved';
}> {
  const cfg = ApproveTopicInputSchema.parse(input);
  const merged: TopicProposal = {
    ...cfg.proposal,
    title: cfg.overrides.title ?? cfg.proposal.title,
    hook: cfg.overrides.hook ?? cfg.proposal.hook,
    targetAudience: cfg.overrides.targetAudience ?? cfg.proposal.targetAudience,
    notesMd: cfg.overrides.notesMd ?? cfg.proposal.notesMd,
  };

  const [row] = await db
    .insert(topicCards)
    .values({
      title: merged.title,
      hook: merged.hook,
      elementSlugs: merged.elementSlugs,
      targetAudience: merged.targetAudience,
      status: cfg.status,
      score: {
        overall: merged.scoreOverall,
        ...merged.scoreBreakdown,
      } as unknown as Record<string, unknown>,
      scoreOverall: merged.scoreOverall,
      notesMd: merged.notesMd,
    })
    .returning();
  if (!row) throw new Error('failed to insert topic card');

  return { topicCardId: row.id, status: cfg.status };
}

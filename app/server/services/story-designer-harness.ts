import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { books } from '../db/schema/index.ts';
import { upsertDoc } from './book-docs.ts';
import { buildKbTools, type KbSessionLike } from './kb-tools.ts';
import { loadKbSnapshot, type KbSnapshot } from './kb-tree.ts';
import { runHarnessedAgent } from './run-tracer.ts';
import type { ToolDef } from './harness-tools.ts';

/**
 * story-designer-harness：立项 confirm 之后，章节循环开始之前。
 *
 * 一气呵成把书的 vault 写满（自由 fanout 的活文档），并把 brief 元数据
 * 落到 books 表（logline_md / audience / main_arc_md / protagonist /
 * prohibited_tropes）作为后续 chapter-planner / chapter-writer prompt
 * 静态区的源数据。
 *
 * 不与用户对话；产物归 design-review-harness 后续 review。
 */

/* ───── tool path 校验 ───── */

const DocPathRe = /^docs\/[a-z][a-z0-9-]{0,40}\/[a-z0-9](?:[a-z0-9-]|\/(?=[a-z0-9])){0,120}$/;

/**
 * 禁止的 kind：
 * - story-concept/* —— 已在 books.loglineMd / mainArcMd 字段里，重复。
 * - *-design/* —— 设计草稿层与 canonical doc 重叠浪费 token。
 *   旧批次产生的 world-design / character-design / style-design 历史值都列入。
 *
 * 注：style/* **允许**——风格指纹机制已删，本书的写作风格 = vault[kind=style] doc，
 * 由 story-designer / design-review / 用户编辑，chapter-writer 走 vault 自然注入。
 */
const FORBIDDEN_KINDS = new Set([
  'story-concept',
  'world-design',
  'character-design',
  'style-design',
  'relation-design',
  'cultivation-design',
  'system-design',
]);
function isForbiddenKind(kind: string): boolean {
  if (FORBIDDEN_KINDS.has(kind)) return true;
  if (kind.endsWith('-design')) return true;
  return false;
}

/**
 * 4 份硬底线 doc 的 (kind, slug) 检查。submit_design 之前必须全部 update。
 * 主角 character 的 slug 不固定（取决于主角名拼音），所以只检查 kind=character 至少 1 份。
 */
function checkHardFloorDocs(pending: Map<string, PendingDoc>): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const hasCharacter = Array.from(pending.values()).some((d) => d.kind === 'character');
  if (!hasCharacter) missing.push('docs/character/<protagonist-slug>');
  if (!pending.has('world/setting')) missing.push('docs/world/setting');
  if (!pending.has('world/rules')) missing.push('docs/world/rules');
  if (!pending.has('relations/character-relations'))
    missing.push('docs/relations/character-relations');
  return { ok: missing.length === 0, missing };
}

interface PendingDoc {
  kind: string;
  slug: string;
  title: string;
  contentMd: string;
  reasonMd: string;
}

export interface StoryDesignerSession extends KbSessionLike {
  bookId: string;
  pendingDocs: Map<string, PendingDoc>;
  kb: KbSnapshot;
  /** agent 在 submit_design 同 turn 给的对白；外层不强依赖 */
  lastSummaryMd?: string;
}

export async function createStoryDesignerSession(
  bookId: string,
): Promise<StoryDesignerSession> {
  return {
    bookId,
    pendingDocs: new Map(),
    kb: await loadKbSnapshot(),
  };
}

type SdTool<T> = ToolDef<T, StoryDesignerSession>;

/* ───── update_doc ───── */

const UpdateDocArgs = z.object({
  path: z.string().regex(DocPathRe, {
    message:
      'path 必须形如 docs/<kind>/<slug>，slug 支持 / 划分多级（如 docs/world/factions/tianhua-zong）',
  }),
  title: z.string().min(1).max(120),
  contentMd: z.string().min(40),
  reasonMd: z.string().max(200).default(''),
});

const updateDocTool: SdTool<z.infer<typeof UpdateDocArgs>> = {
  name: 'update_doc',
  description:
    '写一份活文档（pending）。\n' +
    'path 形如 docs/<kind>/<slug>；slug 支持 / 划多级（docs/world/factions/tianhua-zong）。\n' +
    'kind 自由（character / world / style / relations / cultivation / system / politics / timeline 等），不存在的 kind 会自动注册。\n' +
    '风格写法落 docs/style/<slug>（如 docs/style/voice），整本书共用——chapter-writer 会自然读到。\n' +
    '禁止 kind：*-design/*（与 canonical doc 重叠）、story-concept/*（已在 books.logline_md / main_arc_md）。\n' +
    '反复调用同 path 会覆盖；submit_design 时一次性原子化落库。',
  argSchema: UpdateDocArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const rest = args.path.slice('docs/'.length);
    const slashIdx = rest.indexOf('/');
    const kind = rest.slice(0, slashIdx);
    const slug = rest.slice(slashIdx + 1);
    if (isForbiddenKind(kind)) {
      throw new Error(
        `update_doc 拒绝：kind="${kind}" 是禁止 kind。` +
          `story-concept/* 已在 books.logline_md / main_arc_md 字段；` +
          `*-design/* 是冗余设计草稿层，直接写 canonical（character/、world/、style/、relations/）即可。`,
      );
    }
    session.pendingDocs.set(`${kind}/${slug}`, {
      kind,
      slug,
      title: args.title,
      contentMd: args.contentMd,
      reasonMd: args.reasonMd || '立项设计阶段写入',
    });
    return {
      resultMd: `pending: docs/${kind}/${slug}（${args.contentMd.length} chars，已暂存，submit_design 时落库）。当前 vault 暂存 ${session.pendingDocs.size} 份 doc。`,
    };
  },
};

/* ───── submit_design (terminal) ───── */

export const SubmitDesignBriefSchema = z.object({
  loglineMd: z.string().min(20).max(400),
  audience: z.string().min(10).max(400),
  mainArcMd: z.string().min(120).max(2000),
  protagonistName: z.string().min(1).max(40),
  prohibitedTropes: z.array(z.string().min(2).max(60)).min(2).max(10),
});

export type SubmitDesignBrief = z.infer<typeof SubmitDesignBriefSchema>;

const SubmitDesignArgs = z.object({
  brief: SubmitDesignBriefSchema,
  summaryMd: z.string().min(40).max(4000),
});

export type SubmitDesignPayload = z.infer<typeof SubmitDesignArgs>;

const submitDesignTool: SdTool<SubmitDesignPayload> = {
  name: 'submit_design',
  description:
    '【硬终止】完成 vault 写入与 brief 落库。\n' +
    'brief 含 loglineMd / audience / mainArcMd / protagonistName / prohibitedTropes，落到 books 表对应字段。\n' +
    'summaryMd 给外层 8-15 行的整本书概括（人物 / 主线 / 题材红线一句话）。风格不必摘要（不归你管）。\n' +
    '前置硬约束：必须已 update_doc 4 份硬底线 doc（character/<protagonist> + world/setting + world/rules + relations/character-relations），否则拒。',
  argSchema: SubmitDesignArgs,
  isTerminal: true,
  async execute(args, { session }) {
    const floor = checkHardFloorDocs(session.pendingDocs);
    if (!floor.ok) {
      throw new Error(
        `submit_design 拒绝：硬底线 doc 缺失：${floor.missing.join('、')}。` +
          `当前 vault 暂存 ${session.pendingDocs.size} 份，但必须有 character/<protagonist> + world/setting + world/rules + relations/character-relations 这 4 份才能 submit。`,
      );
    }
    session.lastSummaryMd = args.summaryMd;
    return {
      resultMd: `[submit_design] brief 已就绪，将由 commit 落 books + ${session.pendingDocs.size} 份 doc。`,
      terminalPayload: args,
    };
  },
};

/* ───── tool registry & commit ───── */

export function buildStoryDesignerTools(): Array<ToolDef<unknown, StoryDesignerSession>> {
  return [
    ...buildKbTools<StoryDesignerSession>(),
    updateDocTool,
    submitDesignTool,
  ] as Array<ToolDef<unknown, StoryDesignerSession>>;
}

export const STORY_DESIGNER_TERMINAL_TOOLS = ['submit_design'] as const;

/**
 * submit_design 之后由外层调用：把 pending docs 落 book_docs，把 brief 落 books 表。
 * 单 transaction 保证原子性失败回滚（若 upsertDoc 内部不裸跑 sql 则各自隔离）。
 */
export async function commitStoryDesignerSession(opts: {
  session: StoryDesignerSession;
  brief: SubmitDesignBrief;
  rootRunId: string;
}): Promise<{ docsCommitted: string[] }> {
  const { session, brief, rootRunId } = opts;

  const docsCommitted: string[] = [];
  for (const [, p] of session.pendingDocs) {
    await upsertDoc({
      bookId: session.bookId,
      kind: p.kind,
      slug: p.slug,
      title: p.title,
      contentMd: p.contentMd,
      editor: 'agent',
      reasonMd: p.reasonMd,
      runId: rootRunId,
      generatedByRunId: rootRunId,
    });
    docsCommitted.push(`${p.kind}/${p.slug}`);
  }

  await db
    .update(books)
    .set({
      protagonist: brief.protagonistName,
      loglineMd: brief.loglineMd,
      audience: brief.audience,
      mainArcMd: brief.mainArcMd,
      prohibitedTropes: brief.prohibitedTropes,
    })
    .where(eq(books.id, session.bookId));

  return { docsCommitted };
}

/* ───── harness 入口 ───── */

export interface RunStoryDesignerOptions {
  bookId: string;
  /** 立项上下文：brief 摘要 + 元素 + 分类等 — 由外层组装好 */
  contextPrompt: string;
  /** 系统 prompt（来自 prompts 表 slug='story-designer-skill.system'） */
  systemPrompt: string;
  parentRunId?: string;
  modelLabel?: string;
  maxToolCalls?: number;
  maxTokens?: number;
}

export interface StoryDesignerHarnessResult {
  runId: string;
  brief: SubmitDesignBrief;
  summaryMd: string;
  docsCommitted: string[];
  toolCallCount: number;
  turns: number;
}

/**
 * 跑一次完整的 story-designer harness：探索 → 多轮 update_doc → submit_design → commit。
 * 一次调用一气呵成，不像 brainstorm-harness 是 per-message 的多次 invocation。
 */
export async function runStoryDesignerHarness(
  opts: RunStoryDesignerOptions,
): Promise<StoryDesignerHarnessResult> {
  const session = await createStoryDesignerSession(opts.bookId);
  const tools = buildStoryDesignerTools();

  const harness = await runHarnessedAgent<SubmitDesignPayload, StoryDesignerSession>({
    kind: 'story-designer-harness',
    parentRunId: opts.parentRunId,
    bookId: opts.bookId,
    input: { bookId: opts.bookId },
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.contextPrompt,
    tools,
    terminalToolNames: [...STORY_DESIGNER_TERMINAL_TOOLS],
    toolContext: { session },
    maxToolCalls: opts.maxToolCalls ?? 60,
    maxTokens: opts.maxTokens ?? 8000,
    modelLabel: opts.modelLabel,
  });

  const { docsCommitted } = await commitStoryDesignerSession({
    session,
    brief: harness.result.brief,
    rootRunId: harness.runId,
  });

  return {
    runId: harness.runId,
    brief: harness.result.brief,
    summaryMd: harness.result.summaryMd,
    docsCommitted,
    toolCallCount: harness.toolCallCount,
    turns: harness.turns,
  };
}

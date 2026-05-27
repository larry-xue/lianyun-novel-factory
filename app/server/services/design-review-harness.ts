import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { bookDocs } from '../db/schema/index.ts';
import type { ToolDef } from './harness-tools.ts';
import { upsertDoc } from './book-docs.ts';
import { runHarnessedAgent } from './run-tracer.ts';
import { designForExistingBook } from './book-producer.ts';
import { WidgetSpecSchema, type WidgetSpec } from './brainstorm-harness.ts';

/**
 * design-review-harness：confirm 立项之后接管 chat。
 *
 * 用户已经看到 vault 里的活文档（story-designer 已自动生成 8-15 份：
 * character/<x>、world/setting、world/rules、style/voice、relations/character-relations
 * 等等，kind 自由 fanout）。本 harness 帮用户 list / read / 改 / regenerate，最后
 * start_writing 触发章节生产。
 *
 * 工具：list_doc / read_doc / update_doc / regenerate_design / ask_user / start_writing
 * 终止：ask_user（软）/ start_writing（硬）
 */

/* ───── path 校验：与 story-designer-harness 保持一致 ───── */

const DocPathRe = /^docs\/[a-z][a-z0-9-]{0,40}\/[a-z0-9](?:[a-z0-9-]|\/(?=[a-z0-9])){0,120}$/;

function parseDocPath(path: string): { kind: string; slug: string } {
  const rest = path.slice('docs/'.length);
  const slashIdx = rest.indexOf('/');
  return {
    kind: rest.slice(0, slashIdx),
    slug: rest.slice(slashIdx + 1),
  };
}

export interface DesignReviewSession {
  bookId: string;
  /** agent 在 ask_user / start_writing 同 turn 给的对白；外层不强依赖 */
  lastReplyMd?: string;
}

export function createDesignReviewSession(bookId: string): DesignReviewSession {
  return { bookId };
}

type DrTool<T> = ToolDef<T, DesignReviewSession>;

/* ───── Tools ───── */

const ListDocArgs = z.object({
  kind: z.string().max(80).optional(),
});

const listDocTool: DrTool<z.infer<typeof ListDocArgs>> = {
  name: 'list_doc',
  description:
    '列 vault 里的活文档。\n' +
    '- 不传 kind：列全部，每行 docs/<kind>/<slug>  v<n>  <title>\n' +
    '- 传 kind：只列该 kind（例：list_doc({ kind: "character" })）\n' +
    '使用时机：第一轮入场先 list_doc 看 vault 全貌；改之前 list 一下确认 path。',
  argSchema: ListDocArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const where = args.kind
      ? and(eq(bookDocs.bookId, session.bookId), eq(bookDocs.kind, args.kind))
      : eq(bookDocs.bookId, session.bookId);
    const rows = await db
      .select({
        kind: bookDocs.kind,
        slug: bookDocs.slug,
        title: bookDocs.title,
        version: bookDocs.version,
      })
      .from(bookDocs)
      .where(where)
      .orderBy(asc(bookDocs.kind), asc(bookDocs.slug));
    if (rows.length === 0) {
      return {
        resultMd: args.kind
          ? `（kind=${args.kind} 下暂无文档）`
          : '（vault 暂无文档；可能 story-designer 尚未生成，用 regenerate_design 重做）',
      };
    }
    return {
      resultMd: rows
        .map((r) => `docs/${r.kind}/${r.slug}  v${r.version}  ${r.title}`)
        .join('\n'),
    };
  },
};

const ReadDocArgs = z.object({
  path: z.string().regex(DocPathRe, {
    message:
      'path 必须形如 docs/<kind>/<slug>，slug 支持 / 划多级（docs/world/factions/tianhua-zong）',
  }),
});

const readDocTool: DrTool<z.infer<typeof ReadDocArgs>> = {
  name: 'read_doc',
  description:
    '读 vault 里某份文档全文 markdown。\n' +
    'path 形如 docs/<kind>/<slug>，slug 支持 / 划多级。\n' +
    '使用时机：摘要给用户前先读关键 doc（如 docs/character/<protagonist>、docs/world/setting）；改之前必读。',
  argSchema: ReadDocArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const { kind, slug } = parseDocPath(args.path);
    const [row] = await db
      .select({
        contentMd: bookDocs.contentMd,
        title: bookDocs.title,
        version: bookDocs.version,
      })
      .from(bookDocs)
      .where(
        and(
          eq(bookDocs.bookId, session.bookId),
          eq(bookDocs.kind, kind),
          eq(bookDocs.slug, slug),
        ),
      )
      .limit(1);
    if (!row) return { resultMd: `（未找到 ${args.path}；用 list_doc 看现有 path）` };
    return { resultMd: `# ${row.title} (v${row.version})\n\n${row.contentMd}` };
  },
};

const UpdateDocArgs = z.object({
  path: z.string().regex(DocPathRe, {
    message:
      'path 必须形如 docs/<kind>/<slug>，slug 支持 / 划多级（docs/world/factions/tianhua-zong）',
  }),
  title: z.string().min(1).max(120),
  contentMd: z.string().min(50).max(20_000),
  reasonMd: z.string().max(400).default(''),
});

const updateDocTool: DrTool<z.infer<typeof UpdateDocArgs>> = {
  name: 'update_doc',
  description:
    '局部改写一份活文档（覆盖整篇 contentMd），与 list_doc/read_doc 同一 path 词汇。\n' +
    '调用前必须先 read_doc 同 path 拿到原文，在原文基础上改，保留没动的段。\n' +
    '新建文档也走这个 tool（不存在的 kind 会自动注册）。\n' +
    '使用时机：用户给具体反馈、且只动一两段。\n' +
    '不要用：用户要整体重做 → regenerate_design；空内容 → 别调。',
  argSchema: UpdateDocArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const { kind, slug } = parseDocPath(args.path);
    await upsertDoc({
      bookId: session.bookId,
      kind,
      slug,
      title: args.title,
      contentMd: args.contentMd,
      editor: 'agent',
      reasonMd: args.reasonMd || `design-review: 用户反馈手术刀改写 ${args.path}`,
    });
    return {
      resultMd: `updated: ${args.path} (${args.contentMd.length} chars)\nreason: ${args.reasonMd || '（未提供）'}`,
    };
  },
};

const RegenerateDesignArgs = z.object({
  feedbackMd: z.string().min(5).max(2000),
});

const regenerateDesignTool: DrTool<z.infer<typeof RegenerateDesignArgs>> = {
  name: 'regenerate_design',
  description:
    '【核武器】基于 feedback 把 vault 整体重生成（story-designer 会写一组新的活文档，覆盖现有同 path 的部分）。\n' +
    'feedbackMd 写清楚要改什么 + 保留什么，会一起喂给底层 story-designer。\n' +
    '使用时机：用户说"整体重做" / "方向跑偏了" / "想要完全不同的故事"。\n' +
    '不要用：只想改一两段 → update_doc；改完不要立刻 start_writing，先 list_doc / ask_user 让用户看新版。',
  argSchema: RegenerateDesignArgs,
  isTerminal: false,
  async execute(args, { session }) {
    await designForExistingBook({ bookId: session.bookId, feedback: args.feedbackMd });
    return {
      resultMd:
        `regenerated: vault 已基于反馈整体重生成。\n建议下一步：list_doc 看新 vault → read_doc 抽查 1-2 份 → ask_user 让用户看新版。`,
    };
  },
};

/* ───── 终止：ask_user（软）+ start_writing（硬） ───── */

const AskUserArgs = z.object({
  replyMd: z.string().min(1).max(2000),
  widget: WidgetSpecSchema,
});

const askUserTool: DrTool<z.infer<typeof AskUserArgs>> = {
  name: 'ask_user',
  description:
    '【软终止】向用户提一个问题，等待回复。replyMd = 你写给用户的解释或引子，widget = 这一轮渲染哪种交互组件。\n' +
    'widget 词汇（同 brainstorm-harness）：multi-choice / multi-pick / free-text / confirm（不要用 confirm，那是 start_writing 的语义）。\n' +
    '一旦本工具返回（即用户回复了），harness 退出本轮，下一条 user 消息会触发新一轮。',
  argSchema: AskUserArgs,
  isTerminal: true,
  async execute(args, { session }) {
    session.lastReplyMd = args.replyMd;
    return {
      resultMd: `[ask_user · ${args.widget.kind}] 已提交给前端等待用户回复`,
      terminalPayload: {
        replyMd: args.replyMd,
        widget: args.widget,
      } satisfies AskUserPayload,
    };
  },
};

const StartWritingArgs = z.object({
  replyMd: z.string().min(1).max(2000),
  /** 渲染在 confirm widget 里给用户最后一眼的摘要 */
  summaryMd: z.string().min(20).max(4000),
  /** produceForExistingBook 入参；默认 auto-with-confirm 让 gate-1 再卡一次 */
  gateMode: z
    .enum(['fully-auto', 'auto-with-confirm', 'manual'])
    .default('auto-with-confirm'),
});

const startWritingTool: DrTool<z.infer<typeof StartWritingArgs>> = {
  name: 'start_writing',
  description:
    '【硬终止】用户已经审过 vault、说 OK 了，提交 produceForExistingBook 入参 → 渲染 confirm widget 给用户做最终批准。\n' +
    'replyMd = 你写给用户的话（"那我就按这个开写了"），summaryMd = 给用户最后一眼的摘要 markdown（vault 关键 doc 1-2 行概括 + 章数/字数 + gate 模式）。\n' +
    'gateMode 默认 auto-with-confirm（gate-1 再卡一次）；用户明确说"全自动写完别问了"才用 fully-auto。\n' +
    '注意：本工具不直接落库，等用户在 confirm widget 上点"开始写作"才落。',
  argSchema: StartWritingArgs,
  isTerminal: true,
  async execute(args, { session }) {
    session.lastReplyMd = args.replyMd;
    return {
      resultMd: `[start_writing] 入参已提交，等待用户最终批准`,
      terminalPayload: {
        replyMd: args.replyMd,
        summaryMd: args.summaryMd,
        gateMode: args.gateMode,
      } satisfies StartWritingPayload,
    };
  },
};

/* ───── Terminal payloads ───── */

export interface AskUserPayload {
  replyMd: string;
  widget: WidgetSpec;
}

export interface StartWritingPayload {
  replyMd: string;
  summaryMd: string;
  gateMode: 'fully-auto' | 'auto-with-confirm' | 'manual';
}

export type DesignReviewTerminal =
  | { kind: 'ask_user'; payload: AskUserPayload }
  | { kind: 'start_writing'; payload: StartWritingPayload };

export const DESIGN_REVIEW_TERMINAL_TOOLS = ['ask_user', 'start_writing'] as const;

export function buildDesignReviewTools(): Array<ToolDef<unknown, DesignReviewSession>> {
  return [
    listDocTool,
    readDocTool,
    updateDocTool,
    regenerateDesignTool,
    askUserTool,
    startWritingTool,
  ] as Array<ToolDef<unknown, DesignReviewSession>>;
}

/* ───── Harness 入口 ───── */

export interface RunDesignReviewOptions {
  bookId: string;
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>;
  systemPrompt: string;
  parentRunId?: string;
  modelLabel?: string;
  maxToolCalls?: number;
  maxTokens?: number;
}

export interface DesignReviewHarnessResult {
  runId: string;
  terminal: DesignReviewTerminal;
  toolCallCount: number;
  turns: number;
}

export async function runDesignReviewHarness(
  opts: RunDesignReviewOptions,
): Promise<DesignReviewHarnessResult> {
  const session = createDesignReviewSession(opts.bookId);

  const tools = buildDesignReviewTools();
  const userPrompt = buildUserPrompt(opts.history);

  const harness = await runHarnessedAgent<
    AskUserPayload | StartWritingPayload,
    DesignReviewSession
  >({
    kind: 'design-review-harness',
    parentRunId: opts.parentRunId,
    bookId: opts.bookId,
    input: { historyLen: opts.history.length },
    systemPrompt: opts.systemPrompt,
    userPrompt,
    tools,
    terminalToolNames: [...DESIGN_REVIEW_TERMINAL_TOOLS],
    toolContext: { session },
    maxToolCalls: opts.maxToolCalls ?? 20,
    maxTokens: opts.maxTokens ?? 6000,
    modelLabel: opts.modelLabel,
  });

  const terminal: DesignReviewTerminal =
    harness.terminalTool === 'start_writing'
      ? { kind: 'start_writing', payload: harness.result as StartWritingPayload }
      : { kind: 'ask_user', payload: harness.result as AskUserPayload };

  return {
    runId: harness.runId,
    terminal,
    toolCallCount: harness.toolCallCount,
    turns: harness.turns,
  };
}

function buildUserPrompt(
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>,
): string {
  const historyBlock = history
    .map((m) => {
      const tag = m.role === 'user' ? '用户' : m.role === 'agent' ? '你（上一轮）' : '系统';
      return `### ${tag}\n${m.contentMd}`;
    })
    .join('\n\n');

  return [
    '<system-reminder>',
    '你正在进行 design review：vault 里的活文档（character/<x>、world/setting、style/voice、relations/character-relations 等，kind 自由）已经由 story-designer 落库。',
    '',
    '操作约束：',
    '- 每轮只调一个工具',
    '- 第一轮不知道 vault 里有什么 → list_doc',
    '- 改文档前先 read_doc',
    '- 想问用户问题 → ask_user',
    '- 用户说 OK 开写 → start_writing（默认 gateMode=auto-with-confirm）',
    '- 改一两段 → update_doc；整体重做 → regenerate_design',
    '</system-reminder>',
    '',
    '## design review 对话历史',
    historyBlock || '（暂无历史，这是第一轮——先 list_doc 看 vault 全貌，再 read_doc 关键 doc，再 ask_user 给摘要 + 问要不要改）',
    '',
    '## 你这一轮的目标',
    '基于上面的对话，决定下一步：探索 vault / 改文档 / 问下一题 / 开写。',
  ].join('\n');
}

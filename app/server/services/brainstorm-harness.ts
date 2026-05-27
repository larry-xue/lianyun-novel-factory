import { z } from 'zod';
import type { ToolDef } from './harness-tools.ts';
import { grepKbTool, listKbTool, readKbTool } from './kb-tools.ts';
import { loadKbSnapshot, type KbSnapshot } from './kb-tree.ts';
import { runHarnessedAgent } from './run-tracer.ts';

/**
 * brainstorm-harness：立项 chat 走的 agent harness。
 *
 * 仿 Claude Code 设计：agent 拿到 KB 文件树 + 决策表 + ask_user 工具，
 * 自己探索、问用户、收敛决策，最后 confirm_topic 落 brief。
 *
 * 一次 user 消息 = 一次 invocation；agent 跑到任一终止工具退出：
 *  - ask_user(widget)        软终止：把 widget 落最新 assistant 消息，等下一条 user
 *  - confirm_topic(brief)    硬终止：返回拟定的 brief，调用方拉起二次确认
 */

/* ───────────────────────────────────────────────────────
 * Widget schema（前后端共用）
 * ─────────────────────────────────────────────────────── */

const WidgetOption = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(400).default(''),
});

export const WidgetSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('multi-choice'),
    header: z.string().max(20),
    question: z.string().min(1).max(400),
    options: z.array(WidgetOption).min(2).max(4),
  }),
  z.object({
    kind: z.literal('multi-pick'),
    header: z.string().max(20),
    question: z.string().min(1).max(400),
    options: z.array(WidgetOption).min(2).max(4),
  }),
  z.object({
    kind: z.literal('free-text'),
    header: z.string().max(20),
    question: z.string().min(1).max(400),
    placeholder: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('confirm'),
    header: z.string().max(20),
    summaryMd: z.string().min(1).max(4000),
  }),
]);
export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

/* ───────────────────────────────────────────────────────
 * harness session：跨 tool 调用共享决策表 + KB 快照 + 累积 reply
 * ─────────────────────────────────────────────────────── */

export interface BrainstormSession {
  bookId: string;
  /** 当前已 pin 的决策；pin_decision / unpin_decision 修改 */
  decisions: Record<string, unknown>;
  /** 每条决策的理由（pin 时附带的 reasonMd） */
  reasons: Record<string, string>;
  /** KB 文件树快照，invocation 开始时加载一次 */
  kb: KbSnapshot;
  /**
   * agent 在 ask_user / confirm_topic 同 turn 的 args 里给 replyMd —— 即 agent
   * 给用户看的对白。harness 不需要单独访问，但保留在 session 上以便外层感知。
   */
  lastReplyMd?: string;
}

export async function createBrainstormSession(
  bookId: string,
  initialDecisions: Record<string, unknown> = {},
): Promise<BrainstormSession> {
  return {
    bookId,
    decisions: { ...initialDecisions },
    reasons: {},
    kb: await loadKbSnapshot(),
  };
}

type BsTool<T> = ToolDef<T, BrainstormSession>;

/* ───────────────────────────────────────────────────────
 * Tools
 * KB 三件套（list_kb / read_kb / grep_kb）从 ./kb-tools.ts 复用。
 * ─────────────────────────────────────────────────────── */

const PinDecisionArgs = z.object({
  key: z.string().min(1).max(60),
  /** 任何 JSON 可序列化值 */
  value: z.unknown(),
  reasonMd: z.string().max(400).default(''),
});

const pinDecisionTool: BsTool<z.infer<typeof PinDecisionArgs>> = {
  name: 'pin_decision',
  description:
    '把一条决策钉到决策表（持久化到 negotiation.decisions）。\n' +
    '常用 key：mainCategory / elementSlugs / themes / characterTypes / plotElements / ' +
    'targetAudience / coreConflictMd / charsPerChapter / totalChapters / forbiddenMd。\n' +
    'value 类型按 key 决定（mainCategory: string, elementSlugs: string[], charsPerChapter: number 等）。\n' +
    '使用时机：用户明确给了答案、或你结合 KB 已经能确定一项。',
  argSchema: PinDecisionArgs,
  isTerminal: false,
  async execute(args, { session }) {
    session.decisions[args.key] = args.value;
    if (args.reasonMd) session.reasons[args.key] = args.reasonMd;
    return {
      resultMd: `pinned: ${args.key} = ${JSON.stringify(args.value)}\nreason: ${args.reasonMd || '（未提供）'}`,
    };
  },
};

const UnpinDecisionArgs = z.object({
  key: z.string().min(1).max(60),
});

const unpinDecisionTool: BsTool<z.infer<typeof UnpinDecisionArgs>> = {
  name: 'unpin_decision',
  description:
    '从决策表移除一条决策。使用时机：用户改主意了、或后续探索发现之前 pin 错。',
  argSchema: UnpinDecisionArgs,
  isTerminal: false,
  async execute(args, { session }) {
    if (!(args.key in session.decisions)) {
      return { resultMd: `key=${args.key} 本来就不在决策表里，no-op。` };
    }
    delete session.decisions[args.key];
    delete session.reasons[args.key];
    return { resultMd: `unpinned: ${args.key}` };
  },
};

/* ─── 终止工具：ask_user（软）+ confirm_topic（硬） ─── */

const AskUserArgs = z.object({
  /** agent 给用户看的对白（widget 之外的解释 / 引导） */
  replyMd: z.string().min(1).max(2000),
  widget: WidgetSpecSchema,
});

const askUserTool: BsTool<z.infer<typeof AskUserArgs>> = {
  name: 'ask_user',
  description:
    '【软终止】向用户提一个问题，等待回复。replyMd = 你写给用户的解释或引子，widget = 这一轮渲染哪种交互组件。\n' +
    'widget 词汇：\n' +
    '  - multi-choice: 单选题（2-4 选项）—— 大多数决策都用这个，强迫用户给具体回答\n' +
    '  - multi-pick:   多选（2-4 选项）—— 真正多值的字段如 themes / elementSlugs\n' +
    '  - free-text:    自由文本 —— 没有合适预定选项时（"主角的核心痛点"）\n' +
    '  - confirm:      不要用 —— 这是 confirm_topic 的语义，不是 ask_user\n' +
    '\n纪律：每次只问一题，不要堆叠。一旦本工具返回（即用户回复了），harness 退出本轮，' +
    '下一条 user 消息会触发新一轮 invocation。',
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

const ConfirmBriefSchema = z.object({
  /** 主分类（必填，从 /classification/main.md 选） */
  mainCategory: z.string().min(1),
  /** 元素 slugs（来自 /elements/） */
  elementSlugs: z.array(z.string().min(1)).max(10).default([]),
  /** 主题、角色类型、情节元素 */
  themes: z.array(z.string()).max(2).default([]),
  characterTypes: z.array(z.string()).max(2).default([]),
  plotElements: z.array(z.string()).max(2).default([]),
  /** 目标读者一句话 */
  targetAudience: z.string().min(1).max(200),
  /** 核心冲突 / 钩子（一句话钩子，做 hook 用） */
  coreConflictMd: z.string().min(1).max(800),
  /** 整本书简介（背封文字风格，2-4 段，给读者看 + 喂给 story-designer 当 pitch） */
  synopsisMd: z.string().min(80).max(1500),
  /** 章数 / 字数 */
  totalChapters: z.number().int().min(1).max(5000).default(20),
  charsPerChapter: z.number().int().min(500).max(8000).default(3000),
  /** 雷区 / 禁忌 */
  forbiddenMd: z.string().max(800).default(''),
  /** 拟定书名 */
  proposedTitle: z.string().min(1).max(40),
});

export type ConfirmedBrief = z.infer<typeof ConfirmBriefSchema>;

const ConfirmTopicArgs = z.object({
  /** 给用户看的解释（"我帮你整理了，你看看？"） */
  replyMd: z.string().min(1).max(2000),
  brief: ConfirmBriefSchema,
  /** 给用户看的摘要 markdown，渲染在 confirm widget 里 */
  summaryMd: z.string().min(10).max(4000),
});

const confirmTopicTool: BsTool<z.infer<typeof ConfirmTopicArgs>> = {
  name: 'confirm_topic',
  description:
    '【硬终止】所有必填决策齐了，把 brief 整理出来 → 渲染 confirm widget 给用户做最终批准。\n' +
    '调用前确保 decisions 已 pin 完：mainCategory / elementSlugs / targetAudience / ' +
    'coreConflictMd / synopsisMd / charsPerChapter / totalChapters / proposedTitle。\n' +
    'summaryMd = 给用户看的整本书摘要（markdown，分段，每段一两行）。\n' +
    '注意：此工具不直接落库，等用户在 confirm widget 上点了"批准开书"才落。',
  argSchema: ConfirmTopicArgs,
  isTerminal: true,
  async execute(args, { session }) {
    session.lastReplyMd = args.replyMd;
    return {
      resultMd: `[confirm_topic] brief 已提交给前端等待用户最终批准`,
      terminalPayload: {
        replyMd: args.replyMd,
        brief: args.brief,
        summaryMd: args.summaryMd,
      } satisfies ConfirmTopicPayload,
    };
  },
};

/* ───────────────────────────────────────────────────────
 * Terminal payloads
 * ─────────────────────────────────────────────────────── */

export interface AskUserPayload {
  replyMd: string;
  widget: WidgetSpec;
}

export interface ConfirmTopicPayload {
  replyMd: string;
  brief: ConfirmedBrief;
  summaryMd: string;
}

export type BrainstormTerminal =
  | { kind: 'ask_user'; payload: AskUserPayload }
  | { kind: 'confirm_topic'; payload: ConfirmTopicPayload };

/* ───────────────────────────────────────────────────────
 * Tool registry & harness 入口
 * ─────────────────────────────────────────────────────── */

export function buildBrainstormTools(): Array<ToolDef<unknown, BrainstormSession>> {
  return [
    listKbTool,
    readKbTool,
    grepKbTool,
    pinDecisionTool,
    unpinDecisionTool,
    askUserTool,
    confirmTopicTool,
  ] as Array<ToolDef<unknown, BrainstormSession>>;
}

export const BRAINSTORM_TERMINAL_TOOLS = ['ask_user', 'confirm_topic'] as const;

/**
 * 用户在 /books/ 入口预选的范文片段。每条会被截断后塞进 user prompt
 * 顶部 system-reminder 块，agent 拿来做风格判断的参考。
 */
export interface PreselectedStyleSample {
  author: string;
  title: string;
  /** 内容 md；超过 1500 字会被裁断 */
  contentMd: string;
}

export interface RunBrainstormOptions {
  bookId: string;
  /** 决策表当前状态（落 db 之后再读出来传进来） */
  decisions: Record<string, unknown>;
  /** chat 历史（user/agent/system 都按 chat 排好），最后一条必须是 user */
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>;
  /** 系统 prompt（来自 prompts 表 slug='brainstorm-skill'） */
  systemPrompt: string;
  /** 父 run；通常是 negotiation 的根 run */
  parentRunId?: string;
  /** 用户在 /books/ 入口预选的范文（多选）；scout agent 拿来对照风格 */
  preselectedStyleSamples?: PreselectedStyleSample[];
  modelLabel?: string;
  maxToolCalls?: number;
  maxTokens?: number;
}

export interface BrainstormHarnessResult {
  runId: string;
  terminal: BrainstormTerminal;
  /** 本轮跑完后的最新决策表（kb 工具可能 pin/unpin） */
  decisions: Record<string, unknown>;
  /** 本轮跑完后每条决策的理由（同步） */
  reasons: Record<string, string>;
  toolCallCount: number;
  turns: number;
}

/** 跑一次 brainstorm-harness。每条 user 消息 → 调一次。 */
export async function runBrainstormHarness(
  opts: RunBrainstormOptions,
): Promise<BrainstormHarnessResult> {
  const session = await createBrainstormSession(opts.bookId, opts.decisions);

  const tools = buildBrainstormTools();
  const userPrompt = buildUserPrompt(opts.history, session.decisions, {
    styleSamples: opts.preselectedStyleSamples ?? [],
  });

  const harness = await runHarnessedAgent<AskUserPayload | ConfirmTopicPayload, BrainstormSession>({
    kind: 'brainstorm-harness',
    parentRunId: opts.parentRunId,
    bookId: opts.bookId,
    input: {
      decisionKeys: Object.keys(opts.decisions),
      historyLen: opts.history.length,
    },
    systemPrompt: opts.systemPrompt,
    userPrompt,
    tools,
    terminalToolNames: [...BRAINSTORM_TERMINAL_TOOLS],
    toolContext: { session },
    maxToolCalls: opts.maxToolCalls ?? 30,
    maxTokens: opts.maxTokens ?? 6000,
    modelLabel: opts.modelLabel,
  });

  const terminal: BrainstormTerminal =
    harness.terminalTool === 'confirm_topic'
      ? { kind: 'confirm_topic', payload: harness.result as ConfirmTopicPayload }
      : { kind: 'ask_user', payload: harness.result as AskUserPayload };

  return {
    runId: harness.runId,
    terminal,
    decisions: { ...session.decisions },
    reasons: { ...session.reasons },
    toolCallCount: harness.toolCallCount,
    turns: harness.turns,
  };
}

/**
 * 拼 user prompt：注入历史 + 当前决策快照 + 系统提醒。
 *
 * 仿 Claude Code <system-reminder>：把累积态以"事实通报"形式喂给
 * agent，不和真实 chat 历史混。
 */
function buildUserPrompt(
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>,
  decisions: Record<string, unknown>,
  preselected: {
    styleSamples: PreselectedStyleSample[];
  },
): string {
  const decisionsBlock =
    Object.keys(decisions).length === 0
      ? '（暂无 pinned 决策）'
      : JSON.stringify(decisions, null, 2);

  const historyBlock = history
    .map((m) => {
      const tag = m.role === 'user' ? '用户' : m.role === 'agent' ? '你（上一轮）' : '系统';
      return `### ${tag}\n${m.contentMd}`;
    })
    .join('\n\n');

  const preselectedBlock = formatPreselectedBlock(preselected);

  return [
    '<system-reminder>',
    '当前决策表（已 pin）：',
    decisionsBlock,
    '',
    '操作约束：',
    '- 每轮只调一个工具',
    '- 想问用户问题 → 调 ask_user',
    '- 觉得 brief 已齐 → 调 confirm_topic',
    '- 否则继续 list_kb / read_kb / grep_kb / pin_decision / unpin_decision',
    '</system-reminder>',
    ...(preselectedBlock ? ['', preselectedBlock] : []),
    '',
    '## 立项对话历史',
    historyBlock,
    '',
    '## 你这一轮的目标',
    '基于上面的对话和已 pin 决策，决定下一步：探索 KB / pin 新决策 / 问下一个问题 / 给最终 confirm。',
  ].join('\n');
}

/**
 * 把用户在 /books/ 入口预选的范文格式化成 reminder 块。
 * 返回空字符串表示没有预选，省略整段。
 *
 * 范文：每篇截断 1500 字（避免 prompt 爆炸；scout 只需要嗅风格不需要全文）。
 */
function formatPreselectedBlock(preselected: {
  styleSamples: PreselectedStyleSample[];
}): string {
  const lines: string[] = [];
  if (preselected.styleSamples.length > 0) {
    lines.push(
      '<style-samples-preselected>',
      `用户已为本书提供 ${preselected.styleSamples.length} 篇范文，仅作风格/语感参照，不要把情节当作硬约束：`,
    );
    preselected.styleSamples.forEach((s, i) => {
      const trimmed =
        s.contentMd.length > 1500 ? s.contentMd.slice(0, 1500) + '\n…（已截断）' : s.contentMd;
      lines.push('', `### [${i + 1}] ${s.author} · ${s.title}`, trimmed);
    });
    lines.push('</style-samples-preselected>');
  }
  return lines.join('\n');
}

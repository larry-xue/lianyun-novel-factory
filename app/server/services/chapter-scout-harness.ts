import { z } from 'zod';
import {
  readOnlyKbTools,
  type HarnessSession,
  type ToolDef,
} from './harness-tools.ts';
import { runHarnessedAgent } from './run-tracer.ts';

/**
 * chapter-scout-harness：单章 chat 走的 agent harness。
 *
 * 仿 brainstorm-harness：agent 拿到只读工具 + 决策表 + ask_user 工具，
 * 自己探索（list / read / grep），问用户，逐项 pin beat 字段，
 * 最后 confirm_beat 落 chapter-plan。
 *
 * 一次 user 消息 = 一次 invocation；agent 跑到任一终止工具退出：
 *  - ask_user(widget)        软终止
 *  - confirm_beat(beat)      硬终止：返回拟定的 beat，调用方拉起二次确认
 */

/* ───────────────────────────────────────────────────────
 * Widget schema（沿用 brainstorm 的，前端 WidgetRenderer 直接复用）
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
 * Session：复用 HarnessSession（pendingDocs/pendingThreadActions 永远空）
 * ─────────────────────────────────────────────────────── */

export interface ChapterScoutSession extends HarnessSession {
  decisions: Record<string, unknown>;
  reasons: Record<string, string>;
  lastReplyMd?: string;
}

export function createChapterScoutSession(
  bookId: string,
  chapterIdx: number,
  initialDecisions: Record<string, unknown> = {},
): ChapterScoutSession {
  return {
    bookId,
    chapterIdx,
    pendingDocs: new Map(),
    pendingThreadActions: [],
    decisions: { ...initialDecisions },
    reasons: {},
  };
}

type CsTool<T> = ToolDef<T, ChapterScoutSession>;

/* ───────────────────────────────────────────────────────
 * Tools：list/read/grep 直接复用；其余原创
 * ─────────────────────────────────────────────────────── */

const PinDecisionArgs = z.object({
  key: z.string().min(1).max(60),
  value: z.unknown(),
  reasonMd: z.string().max(400).default(''),
});

const pinDecisionTool: CsTool<z.infer<typeof PinDecisionArgs>> = {
  name: 'pin_decision',
  description:
    '把一条 beat 字段钉到决策表。\n' +
    '常用 key：title / summaryMd / intent / twist / anchors。\n' +
    'value 类型按 key 决定（title: string, summaryMd: string, intent: string, twist: string, anchors: string[]）。\n' +
    '使用时机：用户给了明确答复、或你结合上下文已经能确定一项。',
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

const unpinDecisionTool: CsTool<z.infer<typeof UnpinDecisionArgs>> = {
  name: 'unpin_decision',
  description:
    '从决策表移除一条 beat 字段。使用时机：用户改主意了或后续探索发现之前 pin 错。',
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

const AskUserArgs = z.object({
  replyMd: z.string().min(1).max(2000),
  widget: WidgetSpecSchema,
});

const askUserTool: CsTool<z.infer<typeof AskUserArgs>> = {
  name: 'ask_user',
  description:
    '【软终止】向用户提一个问题，等待回复。replyMd = 你写给用户的解释或引子，widget = 这一轮渲染哪种交互组件。\n' +
    'widget 词汇：\n' +
    '  - multi-choice: 单选题（2-4 选项）—— 大多数决策都用这个\n' +
    '  - multi-pick:   多选（2-4 选项）—— 真正多值的字段如 anchors\n' +
    '  - free-text:    自由文本 —— 没有合适预定选项时（title / summaryMd 自由调整）\n' +
    '  - confirm:      不要用 —— 这是 confirm_beat 的语义\n' +
    '\n纪律：每次只问一题。一旦本工具返回，harness 退出本轮，' +
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

export const ConfirmedBeatSchema = z.object({
  /** 章节标题（6-20 字） */
  title: z.string().min(1).max(40),
  /** 本章剧情纲要（2-4 句，60-300 字） */
  summaryMd: z.string().min(20).max(800),
  /** 本章在主线/弧线里的作用 */
  intent: z.string().min(10).max(400),
  /** 本章的小反转/钩子（可选） */
  twist: z.string().max(400).optional().default(''),
  /** 必须命中的剧情锚点（可选，1-3 个） */
  anchors: z.array(z.string().min(1).max(120)).max(3).default([]),
});

export type ConfirmedBeat = z.infer<typeof ConfirmedBeatSchema>;

const ConfirmBeatArgs = z.object({
  replyMd: z.string().min(1).max(2000),
  beat: ConfirmedBeatSchema,
  /** 给用户看的摘要 markdown，渲染在 confirm widget 里 */
  summaryMd: z.string().min(10).max(4000),
});

const confirmBeatTool: CsTool<z.infer<typeof ConfirmBeatArgs>> = {
  name: 'confirm_beat',
  description:
    '【硬终止】所有必填决策齐了，把 beat 整理出来 → 渲染 confirm widget 给用户做最终批准。\n' +
    '调用前确保 decisions 已 pin 完：title / summaryMd / intent。\n' +
    'summaryMd = 给用户看的本章规划摘要（markdown，分段，每段一两行）。\n' +
    '注意：此工具不直接落库，等用户在 confirm widget 上点"确认开写"才落 chapter-plan。',
  argSchema: ConfirmBeatArgs,
  isTerminal: true,
  async execute(args, { session }) {
    session.lastReplyMd = args.replyMd;
    return {
      resultMd: `[confirm_beat] beat 已提交给前端等待用户最终批准`,
      terminalPayload: {
        replyMd: args.replyMd,
        beat: args.beat,
        summaryMd: args.summaryMd,
      } satisfies ConfirmBeatPayload,
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

export interface ConfirmBeatPayload {
  replyMd: string;
  beat: ConfirmedBeat;
  summaryMd: string;
}

export type ChapterScoutTerminal =
  | { kind: 'ask_user'; payload: AskUserPayload }
  | { kind: 'confirm_beat'; payload: ConfirmBeatPayload };

/* ───────────────────────────────────────────────────────
 * Tool registry & 入口
 * ─────────────────────────────────────────────────────── */

export function buildChapterScoutTools(): Array<ToolDef<unknown, ChapterScoutSession>> {
  return [
    readOnlyKbTools.list as unknown as ToolDef<unknown, ChapterScoutSession>,
    readOnlyKbTools.read as unknown as ToolDef<unknown, ChapterScoutSession>,
    readOnlyKbTools.grep as unknown as ToolDef<unknown, ChapterScoutSession>,
    pinDecisionTool,
    unpinDecisionTool,
    askUserTool,
    confirmBeatTool,
  ] as Array<ToolDef<unknown, ChapterScoutSession>>;
}

export const CHAPTER_SCOUT_TERMINAL_TOOLS = ['ask_user', 'confirm_beat'] as const;

export interface RunChapterScoutOptions {
  bookId: string;
  chapterIdx: number;
  decisions: Record<string, unknown>;
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>;
  systemPrompt: string;
  parentRunId?: string;
  modelLabel?: string;
  maxToolCalls?: number;
  maxTokens?: number;
}

export interface ChapterScoutHarnessResult {
  runId: string;
  terminal: ChapterScoutTerminal;
  decisions: Record<string, unknown>;
  reasons: Record<string, string>;
  toolCallCount: number;
  turns: number;
}

export async function runChapterScoutHarness(
  opts: RunChapterScoutOptions,
): Promise<ChapterScoutHarnessResult> {
  const session = createChapterScoutSession(opts.bookId, opts.chapterIdx, opts.decisions);

  const tools = buildChapterScoutTools();
  const userPrompt = buildUserPrompt(opts.history, session.decisions, opts.chapterIdx);

  const harness = await runHarnessedAgent<
    AskUserPayload | ConfirmBeatPayload,
    ChapterScoutSession
  >({
    kind: 'chapter-scout-harness',
    parentRunId: opts.parentRunId,
    bookId: opts.bookId,
    input: {
      chapterIdx: opts.chapterIdx,
      decisionKeys: Object.keys(opts.decisions),
      historyLen: opts.history.length,
    },
    systemPrompt: opts.systemPrompt,
    userPrompt,
    tools,
    terminalToolNames: [...CHAPTER_SCOUT_TERMINAL_TOOLS],
    toolContext: { session },
    maxToolCalls: opts.maxToolCalls ?? 30,
    maxTokens: opts.maxTokens ?? 6000,
    modelLabel: opts.modelLabel,
  });

  const terminal: ChapterScoutTerminal =
    harness.terminalTool === 'confirm_beat'
      ? { kind: 'confirm_beat', payload: harness.result as ConfirmBeatPayload }
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

function buildUserPrompt(
  history: Array<{ role: 'user' | 'agent' | 'system'; contentMd: string }>,
  decisions: Record<string, unknown>,
  chapterIdx: number,
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

  return [
    '<system-reminder>',
    `当前规划目标：第 ${chapterIdx} 章。`,
    '当前决策表（已 pin）：',
    decisionsBlock,
    '',
    '操作约束：',
    '- 每轮只调一个工具',
    '- 想问用户问题 → 调 ask_user',
    '- 觉得 beat 已齐 → 调 confirm_beat',
    '- 否则继续 list / read / grep / pin_decision / unpin_decision',
    '</system-reminder>',
    '',
    `## 第 ${chapterIdx} 章规划对话历史`,
    historyBlock,
    '',
    '## 你这一轮的目标',
    `基于上面的对话和已 pin 决策，决定下一步：探索本书资料 / pin 新决策 / 问下一个问题 / 给最终 confirm_beat。`,
  ].join('\n');
}

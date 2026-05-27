import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  arcSummaries,
  bookDocs,
  bookStates,
  books,
  chapters,
  characters as charactersTbl,
  plotThreads,
} from '../db/schema/index.ts';
import { upsertDoc } from './book-docs.ts';
import { countChineseChars } from '../llm/client.ts';
import {
  introduceThread,
  recordThreadEvent,
  type OpenThreadForChapter,
} from './plot-threads.ts';

/**
 * Chapter-writer harness 的工具集。Claude-Code 风格的"目录 + 工具"心智模型：
 *
 *   docs/<kind>/<slug>            活文档（character / relations / lore / timeline / ...）
 *   chapters/<idx>                章节正文
 *   chapters/<idx>/state          章末 book_state 快照
 *   threads/                      伏笔列表（默认 open + hinted）
 *   threads/<id>                  单条伏笔详情
 *   arcs/<idx>                    arc 摘要
 *   design/<slug>                 立项时的 4 份设计文档（kind='design'）
 *
 * 设计要点：
 * - update_doc / mark_thread 不立即写库，先攒到 session（pendingDocs/pendingThreadActions）
 * - 后续 read/grep 看得见 pending 内容（写穿缓存）
 * - 仅 submit_chapter 成功时由 commitSession 一次性原子化落库；harness abort 则全部丢弃
 */

const PathRe = /^[a-zA-Z0-9_\-./]+$/;

export interface PendingDoc {
  kind: string;
  slug: string;
  title: string;
  contentMd: string;
  reasonMd: string;
}

export interface PendingThreadAction {
  kind: 'introduce' | 'hint' | 'pay';
  slug?: string;
  title?: string;
  weight?: 'small' | 'arc' | 'book';
  payoffWindowChapters?: number;
  payoffTriggerMd?: string;
  noteMd: string;
}

export interface HarnessSession {
  bookId: string;
  /** 当前章节序号（用于伏笔事件 chapter_idx） */
  chapterIdx: number;
  pendingDocs: Map<string, PendingDoc>; // key = `${kind}/${slug}`
  pendingThreadActions: PendingThreadAction[];
}

export function createHarnessSession(bookId: string, chapterIdx: number): HarnessSession {
  return {
    bookId,
    chapterIdx,
    pendingDocs: new Map(),
    pendingThreadActions: [],
  };
}

export interface ToolExecutionContext<S = HarnessSession> {
  session: S;
}

export interface ToolExecutionResult {
  resultMd: string;
  terminalPayload?: unknown;
}

export interface ToolDef<T = unknown, S = HarnessSession> {
  name: string;
  description: string;
  argSchema: z.ZodType<T>;
  isTerminal: boolean;
  execute(args: T, ctx: ToolExecutionContext<S>): Promise<ToolExecutionResult>;
}

// ─── tool: list ───
const ListArgs = z.object({ path: z.string().optional().default('') });

const listTool: ToolDef<z.infer<typeof ListArgs>> = {
  name: 'list',
  description:
    '列目录（ls）。path 可选；空则列顶层：docs/ chapters/ threads/ arcs/ design/。其他可选：docs、docs/<kind>、chapters、threads、arcs、design。',
  argSchema: ListArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const path = (args.path ?? '').replace(/^\/+|\/+$/g, '');
    if (path === '' || path === '/') {
      return {
        resultMd: [
          'docs/        # 活文档（character / relations / lore / timeline / ...）',
          'chapters/    # 章节正文 + state',
          'threads/     # 伏笔（默认 open + hinted）',
          'arcs/        # arc 摘要',
          'design/      # 立项设计文档（4 份）',
        ].join('\n'),
      };
    }
    if (path === 'docs') return await listDocsAllKinds(session);
    if (path.startsWith('docs/')) {
      const kind = path.slice('docs/'.length);
      return await listDocsByKind(session, kind);
    }
    if (path === 'chapters') return await listChapters(session);
    if (path === 'threads') return await listThreads(session);
    if (path === 'arcs') return await listArcs(session);
    if (path === 'design') return await listDocsByKind(session, 'design');
    return { resultMd: `（未知路径：${path}）` };
  },
};

async function listDocsAllKinds(session: HarnessSession): Promise<ToolExecutionResult> {
  const rows = await db
    .select({ kind: bookDocs.kind, slug: bookDocs.slug, title: bookDocs.title, version: bookDocs.version })
    .from(bookDocs)
    .where(eq(bookDocs.bookId, session.bookId))
    .orderBy(asc(bookDocs.kind), asc(bookDocs.slug));
  const merged = mergePendingIntoList(rows, session);
  if (merged.length === 0) return { resultMd: '（暂无活文档）' };
  const lines = merged.map(
    (r) => `docs/${r.kind}/${r.slug}  v${r.version}  ${r.title}${r.pending ? '  [pending]' : ''}`,
  );
  return { resultMd: lines.join('\n') };
}

async function listDocsByKind(session: HarnessSession, kind: string): Promise<ToolExecutionResult> {
  const rows = await db
    .select({ kind: bookDocs.kind, slug: bookDocs.slug, title: bookDocs.title, version: bookDocs.version })
    .from(bookDocs)
    .where(and(eq(bookDocs.bookId, session.bookId), eq(bookDocs.kind, kind)))
    .orderBy(asc(bookDocs.slug));
  const merged = mergePendingIntoList(rows, session, kind);
  if (merged.length === 0) return { resultMd: `（kind=${kind} 下暂无文档）` };
  const lines = merged.map(
    (r) => `docs/${r.kind}/${r.slug}  v${r.version}  ${r.title}${r.pending ? '  [pending]' : ''}`,
  );
  return { resultMd: lines.join('\n') };
}

function mergePendingIntoList(
  rows: Array<{ kind: string; slug: string; title: string; version: number }>,
  session: HarnessSession,
  filterKind?: string,
): Array<{ kind: string; slug: string; title: string; version: number; pending: boolean }> {
  const merged = rows.map((r) => {
    const pendingKey = `${r.kind}/${r.slug}`;
    const p = session.pendingDocs.get(pendingKey);
    return p
      ? { ...r, title: p.title, version: r.version + 1, pending: true }
      : { ...r, pending: false };
  });
  for (const [key, p] of session.pendingDocs) {
    if (filterKind && p.kind !== filterKind) continue;
    if (!merged.find((r) => `${r.kind}/${r.slug}` === key)) {
      merged.push({ kind: p.kind, slug: p.slug, title: p.title, version: 1, pending: true });
    }
  }
  return merged;
}

async function listChapters(session: HarnessSession): Promise<ToolExecutionResult> {
  const rows = await db
    .select({ idx: chapters.idx, title: chapters.title, charCount: chapters.charCount })
    .from(chapters)
    .where(eq(chapters.bookId, session.bookId))
    .orderBy(asc(chapters.idx));
  if (rows.length === 0) return { resultMd: '（尚未写过章节）' };
  return {
    resultMd: rows.map((r) => `chapters/${r.idx}  ${r.title}  ${r.charCount}字`).join('\n'),
  };
}

async function listThreads(session: HarnessSession): Promise<ToolExecutionResult> {
  const rows = await db
    .select()
    .from(plotThreads)
    .where(
      and(eq(plotThreads.bookId, session.bookId), inArray(plotThreads.status, ['open', 'hinted'])),
    )
    .orderBy(asc(plotThreads.introducedAtChapterIdx));
  if (rows.length === 0) return { resultMd: '（暂无开放伏笔）' };
  const lines = rows.map((t) => {
    const overdue = session.chapterIdx > t.expectedPayoffEnd ? ' [P0 已超期]' : '';
    return `threads/${t.id}  [${t.status}] ${t.title}  weight=${t.weight}  ch${t.introducedAtChapterIdx}→ch${t.expectedPayoffStart}-${t.expectedPayoffEnd}${overdue}`;
  });
  return { resultMd: lines.join('\n') };
}

async function listArcs(session: HarnessSession): Promise<ToolExecutionResult> {
  const rows = await db
    .select({
      idx: arcSummaries.arcIdx,
      name: arcSummaries.arcName,
      rs: arcSummaries.rangeStart,
      re: arcSummaries.rangeEnd,
    })
    .from(arcSummaries)
    .where(eq(arcSummaries.bookId, session.bookId))
    .orderBy(asc(arcSummaries.arcIdx));
  if (rows.length === 0) return { resultMd: '（暂无 arc 摘要）' };
  return {
    resultMd: rows.map((r) => `arcs/${r.idx}  ${r.name}  ch${r.rs}-${r.re}`).join('\n'),
  };
}

// ─── tool: read ───
const ReadArgs = z.object({ path: z.string().regex(PathRe) });

const readTool: ToolDef<z.infer<typeof ReadArgs>> = {
  name: 'read',
  description:
    '读单份文档/章节/状态全文（cat）。path 形如：docs/<kind>/<slug>、chapters/<idx>、chapters/<idx>/state、threads/<id>、arcs/<idx>、design/<slug>。',
  argSchema: ReadArgs,
  isTerminal: false,
  async execute(args, { session }) {
    return await readPath(session, args.path);
  },
};

async function readPath(session: HarnessSession, rawPath: string): Promise<ToolExecutionResult> {
  const path = rawPath.replace(/^\/+|\/+$/g, '');
  // docs/<kind>/<slug>
  if (path.startsWith('docs/')) {
    const rest = path.slice('docs/'.length);
    const [kind, slug] = rest.split('/');
    if (!kind || !slug) return { resultMd: `（路径格式应为 docs/<kind>/<slug>，收到 ${path}）` };
    const pending = session.pendingDocs.get(`${kind}/${slug}`);
    if (pending) return { resultMd: `# ${pending.title} [pending]\n\n${pending.contentMd}` };
    const [row] = await db
      .select()
      .from(bookDocs)
      .where(
        and(
          eq(bookDocs.bookId, session.bookId),
          eq(bookDocs.kind, kind),
          eq(bookDocs.slug, slug),
        ),
      )
      .limit(1);
    if (!row) return { resultMd: `（未找到 ${path}）` };
    return { resultMd: `# ${row.title} (v${row.version})\n\n${row.contentMd}` };
  }
  // design/<slug> 是 docs/design/<slug> 的快捷
  if (path.startsWith('design/')) {
    return await readPath(session, `docs/design/${path.slice('design/'.length)}`);
  }
  // chapters/<idx> 或 chapters/<idx>/state
  if (path.startsWith('chapters/')) {
    const rest = path.slice('chapters/'.length);
    const [idxStr, sub] = rest.split('/');
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 1) return { resultMd: `（章号无效：${idxStr}）` };
    if (sub === 'state') {
      const [s] = await db
        .select()
        .from(bookStates)
        .where(and(eq(bookStates.bookId, session.bookId), eq(bookStates.chapterIdx, idx)))
        .limit(1);
      if (!s) return { resultMd: `（第 ${idx} 章无 state 记录）` };
      return {
        resultMd: [
          `# ch${idx} state`,
          `arcStage: ${s.arcStage}`,
          `lastEvent: ${s.lastEventSummaryMd}`,
          `nextIntent: ${s.nextChapterIntentMd}`,
          `activeChars: ${(s.activeCharacters as Array<{ name: string; status: string }> | null)
            ?.map((c) => `${c.name}(${c.status})`)
            .join('、') ?? ''}`,
        ].join('\n'),
      };
    }
    if (sub) return { resultMd: `（chapters 子路径只支持 /state，收到 /${sub}）` };
    const [c] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.bookId, session.bookId), eq(chapters.idx, idx)))
      .limit(1);
    if (!c) return { resultMd: `（第 ${idx} 章未写）` };
    return { resultMd: `# 第 ${c.idx} 章 ${c.title}\n\n${c.contentMd}` };
  }
  // threads/<id>
  if (path.startsWith('threads/')) {
    const id = path.slice('threads/'.length);
    if (!id) return { resultMd: '（threads 路径需带 id）' };
    const [t] = await db.select().from(plotThreads).where(eq(plotThreads.id, id)).limit(1);
    if (!t || t.bookId !== session.bookId) return { resultMd: `（未找到 ${path}）` };
    return {
      resultMd: [
        `# ${t.title}`,
        `slug: ${t.slug}`,
        `status: ${t.status}  weight: ${t.weight}`,
        `introduced: ch${t.introducedAtChapterIdx}`,
        `expected payoff: ch${t.expectedPayoffStart}-${t.expectedPayoffEnd}`,
        t.payoffTriggerMd ? `trigger: ${t.payoffTriggerMd}` : '',
        t.detailMd ? `\n${t.detailMd}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  // arcs/<idx>
  if (path.startsWith('arcs/')) {
    const idx = Number(path.slice('arcs/'.length));
    if (!Number.isInteger(idx)) return { resultMd: `（arc idx 无效）` };
    const [a] = await db
      .select()
      .from(arcSummaries)
      .where(and(eq(arcSummaries.bookId, session.bookId), eq(arcSummaries.arcIdx, idx)))
      .limit(1);
    if (!a) return { resultMd: `（未找到 arc ${idx}）` };
    return {
      resultMd: [
        `# Arc ${a.arcIdx} ${a.arcName}（ch${a.rangeStart}-${a.rangeEnd}）`,
        a.summaryMd,
        a.pivotsMd ? `\n关键转折：${a.pivotsMd}` : '',
        a.openThreads.length ? `\n未收悬念：${(a.openThreads as string[]).join('、')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  return { resultMd: `（未知 path 前缀：${path}）` };
}

// ─── tool: grep ───
const GrepArgs = z.object({
  pattern: z.string().min(1),
  path: z.string().optional().default(''),
  /** 默认 false。true 时按 JS RegExp 解析 pattern。 */
  regex: z.boolean().optional().default(false),
  /** 每命中条目最多展示前 N 行片段，默认 1。 */
  contextLines: z.number().int().min(0).max(5).optional().default(1),
});

const grepTool: ToolDef<z.infer<typeof GrepArgs>> = {
  name: 'grep',
  description:
    '搜索文本。path 可选（限定 docs / chapters / docs/<kind>），不给则全搜。默认子串匹配；regex=true 走 JS 正则。返回 path:line snippet 列表。',
  argSchema: GrepArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const test = args.regex
      ? buildRegexTester(args.pattern)
      : (s: string) => s.toLowerCase().includes(args.pattern.toLowerCase());
    if (!test) return { resultMd: `（regex 解析失败：${args.pattern}）` };

    const haystack = await collectGrepHaystack(session, args.path);
    const hits: string[] = [];
    for (const item of haystack) {
      const lines = item.contentMd.split(/\n+/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (test(line)) {
          const snippet = lines.slice(i, i + args.contextLines).join(' ⏎ ').slice(0, 240);
          hits.push(`${item.path}:${i + 1}  ${snippet}`);
          if (hits.length >= 80) break;
        }
      }
      if (hits.length >= 80) break;
    }
    if (hits.length === 0) return { resultMd: `（无命中）` };
    return { resultMd: hits.join('\n') };
  },
};

function buildRegexTester(pattern: string): ((s: string) => boolean) | null {
  try {
    const re = new RegExp(pattern, 'i');
    return (s: string) => re.test(s);
  } catch {
    return null;
  }
}

interface GrepItem {
  path: string;
  contentMd: string;
}

async function collectGrepHaystack(
  session: HarnessSession,
  scopeRaw: string,
): Promise<GrepItem[]> {
  const scope = (scopeRaw ?? '').replace(/^\/+|\/+$/g, '');
  const items: GrepItem[] = [];

  const wantDocs = scope === '' || scope === 'docs' || scope.startsWith('docs/');
  const wantChapters = scope === '' || scope === 'chapters';
  const docKindFilter = scope.startsWith('docs/') ? scope.slice('docs/'.length) : undefined;

  if (wantDocs) {
    const docs = await db
      .select({ kind: bookDocs.kind, slug: bookDocs.slug, contentMd: bookDocs.contentMd })
      .from(bookDocs)
      .where(eq(bookDocs.bookId, session.bookId));
    for (const d of docs) {
      if (docKindFilter && d.kind !== docKindFilter) continue;
      const pending = session.pendingDocs.get(`${d.kind}/${d.slug}`);
      items.push({
        path: `docs/${d.kind}/${d.slug}`,
        contentMd: pending?.contentMd ?? d.contentMd,
      });
    }
    // 仅 pending 的（DB 里还没有）
    for (const [key, p] of session.pendingDocs) {
      if (!docs.find((d) => `${d.kind}/${d.slug}` === key)) {
        if (docKindFilter && p.kind !== docKindFilter) continue;
        items.push({ path: `docs/${key}`, contentMd: p.contentMd });
      }
    }
  }

  if (wantChapters) {
    const cs = await db
      .select({ idx: chapters.idx, contentMd: chapters.contentMd })
      .from(chapters)
      .where(eq(chapters.bookId, session.bookId));
    for (const c of cs) items.push({ path: `chapters/${c.idx}`, contentMd: c.contentMd });
  }

  return items;
}

// ─── tool: update_doc ───
const UpdateDocArgs = z.object({
  path: z.string().regex(/^docs\/[a-z0-9-]+\/[a-z0-9](?:[a-z0-9-]|\/(?=[a-z0-9])){0,120}$/),
  title: z.string().min(1).max(120),
  content_md: z.string().min(1),
  reason_md: z.string().min(1).max(200).optional().default('agent 在 chapter-writer harness 内更新'),
});

const updateDocTool: ToolDef<z.infer<typeof UpdateDocArgs>> = {
  name: 'update_doc',
  description:
    '写/覆盖一份活文档。path 必须是 docs/<kind>/<slug>，kind 是 kebab-case slug，必填 title 与 content_md。**先攒在 session，submit_chapter 时一次性原子提交。**',
  argSchema: UpdateDocArgs,
  isTerminal: false,
  async execute(args, { session }) {
    const rest = args.path.slice('docs/'.length);
    const slashIdx = rest.indexOf('/');
    const kind = rest.slice(0, slashIdx);
    const slug = rest.slice(slashIdx + 1);
    session.pendingDocs.set(`${kind}/${slug}`, {
      kind,
      slug,
      title: args.title,
      contentMd: args.content_md,
      reasonMd: args.reason_md,
    });
    return {
      resultMd: `pending: docs/${kind}/${slug}（${args.content_md.length} chars，submit_chapter 时落库）`,
    };
  },
};

// ─── tool: mark_thread ───
const MarkThreadArgs = z.object({
  action: z.enum(['introduce', 'hint', 'pay']),
  slug: z.string().optional(),
  title: z.string().optional(),
  weight: z.enum(['small', 'arc', 'book']).optional(),
  payoff_window_chapters: z.number().int().positive().optional(),
  payoff_trigger_md: z.string().optional(),
  note_md: z.string().min(1),
});

const markThreadTool: ToolDef<z.infer<typeof MarkThreadArgs>> = {
  name: 'mark_thread',
  description:
    '记录本章对一条伏笔的动作。action ∈ {introduce, hint, pay}。introduce 时必填 title；hint/pay 时必填 slug。**先攒到 session，submit_chapter 时一次性提交。**',
  argSchema: MarkThreadArgs,
  isTerminal: false,
  async execute(args, { session }) {
    if (args.action === 'introduce' && !args.title) {
      return { resultMd: 'ERR: introduce 必须提供 title' };
    }
    if ((args.action === 'hint' || args.action === 'pay') && !args.slug) {
      return { resultMd: `ERR: ${args.action} 必须提供已存在伏笔的 slug` };
    }
    session.pendingThreadActions.push({
      kind: args.action,
      slug: args.slug,
      title: args.title,
      weight: args.weight,
      payoffWindowChapters: args.payoff_window_chapters,
      payoffTriggerMd: args.payoff_trigger_md,
      noteMd: args.note_md,
    });
    return {
      resultMd: `pending thread action: ${args.action} ${args.slug ?? args.title ?? ''}`,
    };
  },
};

// ─── tool: submit_chapter (terminal) ───
import { lenientString } from '../mastra/agents/_zod-helpers.ts';

export const SubmitChapterArgs = z.object({
  title: z.string().min(1).max(60),
  content_md: z.string().min(500),
  hook_md: z.string().min(4),
  new_state: z.object({
    arc_stage: lenientString(''),
    active_characters: z
      .array(z.object({ name: z.string().min(1), status: lenientString('') }))
      .default([]),
    last_event_summary_md: lenientString(''),
    next_chapter_intent_md: lenientString(''),
  }),
});

export type SubmitChapterPayload = z.infer<typeof SubmitChapterArgs>;

/**
 * 创建 submit_chapter 工具。三道硬校验：
 * 1. 字数：上限 = charsPerChapter + 1000，下限 = charsPerChapter - 300（仅 charsPerChapter 给了时）
 * 2. 段落字面重复：本章内任意 5-gram 字符序列在 content_md 自身重复出现 → reject
 * 3. 跨章字面重复：本章 vs 上一章 / 上上章的 5-gram 重叠率 > 30% → reject
 *
 * 超出直接 throw，harness 把错误回喂给 LLM 让它删戏 / 补戏重新 submit。
 */
function createSubmitChapterTool(charsPerChapter?: number): ToolDef<SubmitChapterPayload> {
  const upper = charsPerChapter ? charsPerChapter + 1000 : Infinity;
  const lower = charsPerChapter ? Math.max(0, charsPerChapter - 300) : 0;
  return {
    name: 'submit_chapter',
    description:
      '提交本章并退出循环。title/content_md/hook_md 必填；new_state 含 arc_stage、active_characters、last_event_summary_md、next_chapter_intent_md。**伏笔动作通过 mark_thread 记录，不在 new_state 里。**',
    argSchema: SubmitChapterArgs,
    isTerminal: true,
    async execute(args, { session }) {
      if (charsPerChapter) {
        const charCount = countChineseChars(args.content_md);
        if (charCount > upper) {
          throw new Error(
            `content_md 字数 ${charCount} 超过上限 ${upper}（目标 ${charsPerChapter}，最多 +1000）。请删减场景描写/内心戏/重复信息，把正文压到 ${lower}-${upper} 字符再重新 submit_chapter。优先保留：对话、关键动作、推进 milestone 的事件。`,
          );
        }
        if (charCount < lower) {
          throw new Error(
            `content_md 字数 ${charCount} 低于下限 ${lower}（目标 ${charsPerChapter}，最少 -300）。需要补充：对话/动作/感官细节，让本章更饱满（不要水描写、不要重复），把正文撑到 ${lower}-${upper} 之间再重新 submit_chapter。`,
          );
        }
      }

      // 章内段落字面重复（≥30 字 N-gram 完全重复）
      const intraDup = findIntraChapterDup(args.content_md);
      if (intraDup) {
        throw new Error(
          `content_md 内部检测到段落字面重复（${intraDup.length} 字片段重复出现）：\n"${intraDup.snippet}"\n请删除其中一处或改写，避免段落重复。`,
        );
      }

      // 跨章字面重复（5-gram 重叠率 > 30%）
      const crossDup = await findCrossChapterDup(session.bookId, session.chapterIdx, args.content_md);
      if (crossDup) {
        throw new Error(
          `content_md 与第 ${crossDup.againstIdx} 章的字面重叠率 ${(crossDup.ratio * 100).toFixed(1)}% 超过 30%。\n常见原因：把上一章已经讲过的家族秘密/世界观说明再讲一遍。请删掉重复信息，本章只推进新进展。\n重叠最重的片段（节选）："${crossDup.snippet}"`,
        );
      }

      return { resultMd: 'submitted', terminalPayload: args };
    },
  };
}

/**
 * 章内段落级字面重复扫描：取连续 30 中文字符 N-gram，看是否在 content 内出现 ≥ 2 次。
 * 命中即返回片段；用于堵 LLM "整段一字不差再写一遍"。
 */
function findIntraChapterDup(content: string): { snippet: string; length: number } | null {
  // 只看中文字符（去掉空白/标点的影响）
  const flat = content.replace(/\s+/g, '');
  const N = 30;
  if (flat.length < N * 2) return null;
  const seen = new Map<string, number>();
  for (let i = 0; i + N <= flat.length; i++) {
    const gram = flat.slice(i, i + N);
    // 排除"单字重复填充"的伪命中：要求 gram 内至少 10 个不同字符（真正的语言片段）
    const distinct = new Set(gram).size;
    if (distinct < 10) continue;
    const prev = seen.get(gram);
    if (prev !== undefined && i - prev >= N) {
      // 至少间隔一个 N 长度避免相邻字符的伪命中
      return { snippet: gram, length: N };
    }
    if (prev === undefined) seen.set(gram, i);
  }
  return null;
}

/**
 * 与上一章 / 上上章字面 5-gram 重叠率检查。
 * 用于堵跨章对话/秘密 / 设定整段反复重述的 bug（同一段家族秘密在相邻章被讲两遍）。
 */
async function findCrossChapterDup(
  bookId: string,
  chapterIdx: number,
  content: string,
): Promise<{ againstIdx: number; ratio: number; snippet: string } | null> {
  if (chapterIdx <= 1) return null;
  const prev = await db
    .select({ idx: chapters.idx, contentMd: chapters.contentMd })
    .from(chapters)
    .where(
      and(
        eq(chapters.bookId, bookId),
        inArray(chapters.idx, [chapterIdx - 1, chapterIdx - 2].filter((i) => i >= 1)),
      ),
    );
  if (prev.length === 0) return null;
  const flatNew = content.replace(/\s+/g, '');
  if (flatNew.length < 100) return null;
  const N = 5;
  const newGrams = new Set<string>();
  for (let i = 0; i + N <= flatNew.length; i++) newGrams.add(flatNew.slice(i, i + N));
  if (newGrams.size === 0) return null;

  let worst: { againstIdx: number; ratio: number; snippet: string } | null = null;
  for (const p of prev) {
    const flatPrev = p.contentMd.replace(/\s+/g, '');
    if (flatPrev.length < N) continue;
    let hit = 0;
    let firstHitGram: string | null = null;
    for (let i = 0; i + N <= flatPrev.length; i++) {
      const gram = flatPrev.slice(i, i + N);
      if (newGrams.has(gram)) {
        hit++;
        if (firstHitGram === null) firstHitGram = gram;
      }
    }
    const totalPrevGrams = flatPrev.length - N + 1;
    const ratio = hit / totalPrevGrams;
    if (ratio > 0.3 && (!worst || ratio > worst.ratio)) {
      // 找一段更长的重叠片段做提示（围绕 firstHitGram 取 60 字）
      const snippet = firstHitGram ?? '';
      const expanded = expandSnippet(flatNew, snippet, 60);
      worst = { againstIdx: p.idx, ratio, snippet: expanded };
    }
  }
  return worst;
}

function expandSnippet(haystack: string, needle: string, max: number): string {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return needle;
  const start = Math.max(0, idx - 10);
  const end = Math.min(haystack.length, idx + max);
  return haystack.slice(start, end);
}

// ─── 工具集导出 ───

export function buildChapterWriterTools(opts?: { charsPerChapter?: number }): ToolDef[] {
  return [
    listTool,
    readTool,
    grepTool,
    updateDocTool,
    markThreadTool,
    createSubmitChapterTool(opts?.charsPerChapter),
  ] as ToolDef[];
}

/**
 * chapter-scout 等只读探索场景复用的「文件系统」工具：list/read/grep。
 * 都只依赖 session.bookId / chapterIdx，不写任何 pending；
 * 任何 HarnessSession 形状的 session（含子类型）都能直接挂上。
 */
export const readOnlyKbTools = {
  list: listTool,
  read: readTool,
  grep: grepTool,
} as const;

// ─── 提交：把 session 里 pending 内容原子化落库 ───

export async function commitChapterWriterSession(opts: {
  session: HarnessSession;
  rootRunId: string;
  /** 写入活文档所属的章节 idx（与 markChapterDone 一致即可） */
}): Promise<{ docsCommitted: string[]; threadActionsApplied: number }> {
  const { session, rootRunId } = opts;
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

  let appliedActions = 0;
  for (const a of session.pendingThreadActions) {
    if (a.kind === 'introduce') {
      const t = await introduceThread({
        bookId: session.bookId,
        slug: a.slug,
        title: a.title!,
        weight: a.weight ?? 'arc',
        introducedAtChapterIdx: session.chapterIdx,
        payoffWindowChapters: a.payoffWindowChapters,
        payoffTriggerMd: a.payoffTriggerMd,
        generatedByRunId: rootRunId,
        noteMd: a.noteMd,
      });
      // introduceThread 自己已经记 introduce 事件
      void t;
      appliedActions++;
      continue;
    }
    // hint / pay：根据 slug 找 thread 然后 record
    const [t] = await db
      .select()
      .from(plotThreads)
      .where(and(eq(plotThreads.bookId, session.bookId), eq(plotThreads.slug, a.slug!)))
      .limit(1);
    if (!t) {
      console.warn(`[commitChapterWriterSession] mark_thread ${a.kind} 找不到 slug=${a.slug}，跳过`);
      continue;
    }
    await recordThreadEvent({
      threadId: t.id,
      chapterIdx: session.chapterIdx,
      kind: a.kind,
      noteMd: a.noteMd,
      generatedByRunId: rootRunId,
    });
    appliedActions++;
  }

  return { docsCommitted, threadActionsApplied: appliedActions };
}

// ─── 给 prompt 注入用：当前书的目录树概览（list 顶层 + 计数） ───

export async function buildToolCatalogPrompt(tools: ToolDef[]): Promise<string> {
  const lines = tools.map((t) => {
    const argsShape = describeZod(t.argSchema);
    return `- **${t.name}**${t.isTerminal ? ' [terminal]' : ''} — ${t.description}\n  args: ${argsShape}`;
  });
  return lines.join('\n');
}

function describeZod(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
    return JSON.stringify(json);
  } catch {
    return '{}';
  }
}


import { createServerFn } from '@tanstack/react-start';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { books, llmCalls, runs, toolCalls } from '../db/schema/index.ts';
import {
  produceBook,
  produceForExistingBook,
  resumeAfterGate1,
  writeNextChapter,
} from '../services/book-producer.ts';
import { requireAdmin, requireBookOwner, requireUser } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import { requestCancel } from '../services/cancellation.ts';
import { listRuns } from '../services/runs-list.ts';
import { RUN_STATUS_VALUES } from '~/lib/run-status.ts';
import type { JsonObject, JsonValue } from './_serializable.ts';

interface SerializedRun {
  id: string;
  kind: string;
  status: string;
  parentId: string | null;
  bookId: string | null;
  input: JsonObject;
  output: JsonObject;
  errorMd: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedLlmCall {
  id: string;
  runId: string | null;
  model: string;
  prompt: JsonValue;
  response: string | null;
  responseJson: JsonValue;
  promptTokens: number;
  completionTokens: number;
  cacheHit: boolean;
  latencyMs: number | null;
  errorMd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedToolCall {
  id: string;
  runId: string;
  parentLlmCallId: string | null;
  seq: number;
  toolName: string;
  argsJson: JsonValue;
  resultMd: string;
  errorMd: string | null;
  durationMs: number | null;
  createdAt: Date;
}

const runListProjection = {
  id: runs.id,
  kind: runs.kind,
  status: runs.status,
  bookId: runs.bookId,
  parentId: runs.parentId,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  promptTokens: runs.promptTokens,
  completionTokens: runs.completionTokens,
  errorMd: runs.errorMd,
  createdAt: runs.createdAt,
} as const;

export const listRunsFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        rootsOnly: z.boolean().default(true),
        status: z.enum(RUN_STATUS_VALUES).optional(),
        limit: z.number().int().min(1).max(200).default(20),
        offset: z.number().int().min(0).default(0),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }) => listRuns(data));

/**
 * 给一组 root run id，递归向下走 runs 树并对 llm_calls.{prompt,completion}_tokens 求和。
 * 用一次 SQL 解决批量；root 自己有直接 LLM 调用也算进去。
 */
async function loadDescendantTokenTotals(
  rootIds: string[],
): Promise<Map<string, { promptTokens: number; completionTokens: number }>> {
  if (rootIds.length === 0) return new Map();
  const rows = (await db.execute(sql`
    with recursive descendants(root_id, run_id) as (
      select id, id from runs where id in (${sql.join(
        rootIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      union all
      select d.root_id, r.id
      from runs r
      join descendants d on r.parent_id = d.run_id
    )
    select d.root_id::text as root_id,
           coalesce(sum(c.prompt_tokens), 0)::int as prompt_tokens,
           coalesce(sum(c.completion_tokens), 0)::int as completion_tokens
    from descendants d
    left join llm_calls c on c.run_id = d.run_id
    group by d.root_id
  `)) as unknown as Array<{
    root_id: string;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  const map = new Map<string, { promptTokens: number; completionTokens: number }>();
  for (const r of rows ?? []) {
    map.set(r.root_id, {
      promptTokens: Number(r.prompt_tokens) || 0,
      completionTokens: Number(r.completion_tokens) || 0,
    });
  }
  return map;
}

export const listRunsForBookFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) =>
    z
      .object({
        bookId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(12),
        rootsOnly: z.boolean().default(false),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const where = data.rootsOnly
      ? sql`${runs.bookId} = ${data.bookId}::uuid and ${runs.parentId} is null`
      : eq(runs.bookId, data.bookId);
    const rows = await db
      .select(runListProjection)
      .from(runs)
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(data.limit);
    const totals = await loadDescendantTokenTotals(rows.map((r) => r.id));
    return rows.map((r) => {
      const t = totals.get(r.id);
      return {
        ...r,
        promptTokens: t?.promptTokens ?? r.promptTokens ?? 0,
        completionTokens: t?.completionTokens ?? r.completionTokens ?? 0,
      };
    });
  });

export const fetchRunTreeFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const [root] = await db.select().from(runs).where(eq(runs.id, data.id));
    if (!root) throw new Error('run not found');

    const rootRunId = root.parentId ?? root.id;
    const all = await collectTree(rootRunId);
    const allIds = all.map((r) => r.id);

    const calls = allIds.length
      ? await db
          .select()
          .from(llmCalls)
          .where(inArray(llmCalls.runId, allIds))
          .orderBy(llmCalls.createdAt)
      : [];

    const callsByRun = new Map<string, typeof calls>();
    for (const c of calls) {
      if (!c.runId) continue;
      const arr = callsByRun.get(c.runId) ?? [];
      arr.push(c);
      callsByRun.set(c.runId, arr);
    }

    const tools = allIds.length
      ? await db
          .select()
          .from(toolCalls)
          .where(inArray(toolCalls.runId, allIds))
          .orderBy(toolCalls.createdAt)
      : [];

    const toolsByRun = new Map<string, typeof tools>();
    for (const t of tools) {
      const arr = toolsByRun.get(t.runId) ?? [];
      arr.push(t);
      toolsByRun.set(t.runId, arr);
    }

    // 按 run 树累加每个节点的 token：把每个 run 自己的 llm_calls 求和后，自下而上滚到祖先节点。
    // 这样根节点（produce-book 这种 orchestrator）也能看到全树的总 token。
    const ownTokensByRun = new Map<string, { p: number; c: number }>();
    for (const c of calls) {
      if (!c.runId) continue;
      const acc = ownTokensByRun.get(c.runId) ?? { p: 0, c: 0 };
      acc.p += c.promptTokens ?? 0;
      acc.c += c.completionTokens ?? 0;
      ownTokensByRun.set(c.runId, acc);
    }
    const childrenByParent = new Map<string | null, string[]>();
    for (const r of all) {
      const arr = childrenByParent.get(r.parentId ?? null) ?? [];
      arr.push(r.id);
      childrenByParent.set(r.parentId ?? null, arr);
    }
    const totalsById = new Map<string, { p: number; c: number }>();
    function totalFor(id: string): { p: number; c: number } {
      const cached = totalsById.get(id);
      if (cached) return cached;
      const own = ownTokensByRun.get(id) ?? { p: 0, c: 0 };
      let p = own.p;
      let cc = own.c;
      for (const childId of childrenByParent.get(id) ?? []) {
        const t = totalFor(childId);
        p += t.p;
        cc += t.c;
      }
      const v = { p, c: cc };
      totalsById.set(id, v);
      return v;
    }
    const runsWithRollup = all.map((r) => {
      const t = totalFor(r.id);
      return { ...r, promptTokens: t.p, completionTokens: t.c };
    });

    return {
      focusRunId: root.id,
      rootRunId,
      runs: runsWithRollup as unknown as SerializedRun[],
      llmCallsByRun: Object.fromEntries(callsByRun) as unknown as Record<
        string,
        SerializedLlmCall[]
      >,
      toolCallsByRun: Object.fromEntries(toolsByRun) as unknown as Record<
        string,
        SerializedToolCall[]
      >,
    };
  });

async function collectTree(rootId: string) {
  const rows = await db.select().from(runs).where(eq(runs.id, rootId));
  if (rows.length === 0) return [];
  const out = [...rows];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    const kids = await db.select().from(runs).where(eq(runs.parentId, id));
    for (const k of kids) {
      out.push(k);
      queue.push(k.id);
    }
  }
  return out;
}

const ReplayInputSchema = z.object({ runId: z.string().uuid() });

export const REPLAYABLE_ROOT_KINDS = new Set([
  'produce-book',
  'produce-book-existing',
  'produce-book-resume',
  'write-next-chapter',
] as const);

/**
 * 回放 / 续跑。语义按 root kind 分流：
 * - produce-book        → 用同一 input 新建一本书。
 * - produce-book-existing → outlineDraft 已就绪则等价 resumeAfterGate1；否则重跑立项（meta 没有 outline 才会走这分支）。
 * - produce-book-resume → 同 bookId 续 chapter 循环。
 * - write-next-chapter  → 同 bookId 写下一章。
 */
export const replayRunFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => ReplayInputSchema.parse(raw))
  .handler(async ({ data }) => {
    const [row] = await db.select().from(runs).where(eq(runs.id, data.runId));
    if (!row) throw new Error('run not found');
    if (!REPLAYABLE_ROOT_KINDS.has(row.kind as never)) {
      throw new Error(`不支持 replay kind=${row.kind}`);
    }

    if (row.kind === 'produce-book') {
      const me = await requireUser();
      const input = { ...(row.input as Record<string, unknown>), ownerId: me.id };
      const r = await produceBook(input);
      await logAudit({
        user: me,
        action: 'runs.replay',
        targetType: 'run',
        targetId: data.runId,
        summary: 'replay produce-book（创建新书）',
      });
      return { newRootRunId: r.rootRunId, newBookId: r.bookId };
    }

    if (!row.bookId) {
      throw new Error(`run ${row.id} (${row.kind}) 缺 bookId，无法续跑`);
    }
    const bookId = row.bookId;
    const me = await requireBookOwner(bookId);
    await logAudit({
      user: me,
      action: 'runs.replay',
      targetType: 'run',
      targetId: data.runId,
      summary: `replay ${row.kind}`,
    });

    if (row.kind === 'write-next-chapter') {
      const r = await writeNextChapter(bookId);
      return { newRootRunId: r.rootRunId, newBookId: bookId };
    }

    if (row.kind === 'produce-book-resume') {
      const r = await resumeAfterGate1(bookId);
      return { newRootRunId: r.rootRunId, newBookId: bookId };
    }

    // produce-book-existing
    const [b] = await db
      .select({ meta: books.meta })
      .from(books)
      .where(eq(books.id, bookId));
    const meta = (b?.meta ?? {}) as Record<string, unknown>;
    if (meta.outlineDraft) {
      const r = await resumeAfterGate1(bookId);
      return { newRootRunId: r.rootRunId, newBookId: bookId };
    }
    const input = (row.input ?? {}) as Record<string, unknown>;
    const gateMode =
      (input.gateMode as 'fully-auto' | 'auto-with-confirm' | 'manual' | undefined) ??
      'auto-with-confirm';
    const r = await produceForExistingBook({ bookId, gateMode });
    return { newRootRunId: r.rootRunId, newBookId: bookId };
  });

const CancelInputSchema = z.object({ runId: z.string().uuid() });

/**
 * 中断一个 root run（通常是 produce-book / write-next-chapter 这种长跑）。
 *
 * 1. 调 requestCancel：本进程内 controller.abort()，正在飞的 LLM fetch 立即抛 AbortError，
 *    run-tracer 把当前子 run 标 cancelled，外层 runRootWithCancellation 把 root run + book 标好。
 * 2. 兜底：如果 controller 不在本进程（dev server 重启 / 跨机），DB 直接把 root run 标 cancelled，
 *    book 标 paused —— 原 worker 进程里残留的子 run 不会再写回 root。
 */
export const cancelRunFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => CancelInputSchema.parse(raw))
  .handler(async ({ data }) => {
    const [row] = await db.select().from(runs).where(eq(runs.id, data.runId));
    if (!row) throw new Error('run not found');
    if (row.parentId) throw new Error('只能中断 root run');
    if (row.status !== 'running' && row.status !== 'pending') {
      // 已经终态了，幂等返回
      return { ok: true, alreadyTerminal: true, abortedInProcess: false } as const;
    }

    const me = row.bookId ? await requireBookOwner(row.bookId) : await requireAdmin();

    const abortedInProcess = requestCancel(row.id);

    await db
      .update(runs)
      .set({
        status: 'cancelled',
        finishedAt: new Date(),
        errorMd: '用户中断',
      })
      .where(eq(runs.id, row.id));

    if (row.bookId) {
      await db
        .update(books)
        .set({ status: 'paused' })
        .where(eq(books.id, row.bookId));
    }

    await logAudit({
      user: me,
      action: 'runs.cancel',
      targetType: 'run',
      targetId: row.id,
      summary: abortedInProcess
        ? `中断 ${row.kind}（本进程 abort）`
        : `中断 ${row.kind}（仅落库，本进程未持有 controller）`,
    });

    return { ok: true, alreadyTerminal: false, abortedInProcess } as const;
  });

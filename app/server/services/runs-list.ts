import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { books, runs } from '../db/schema/index.ts';
import type { RunStatus } from '~/lib/run-status.ts';

export interface ListRunsInput {
  rootsOnly: boolean;
  status?: RunStatus;
  limit: number;
  offset: number;
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

export async function listRuns(data: ListRunsInput) {
  const conds = [
    data.rootsOnly ? isNull(runs.parentId) : undefined,
    data.status ? eq(runs.status, data.status) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  // 没指定状态时，把 running 顶到最上面，其它按 createdAt 倒序。
  const orderBy = data.status
    ? [desc(runs.createdAt)]
    : [sql`(${runs.status} = 'running') desc`, desc(runs.createdAt)];
  const [rows, totalRows] = await Promise.all([
    db
      .select(runListProjection)
      .from(runs)
      .where(where)
      .orderBy(...orderBy)
      .limit(data.limit)
      .offset(data.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .where(where),
  ]);
  const total = totalRows[0]?.count ?? 0;
  const bookIds = Array.from(
    new Set(rows.map((r) => r.bookId).filter((x): x is string => !!x)),
  );
  const bookRows = bookIds.length
    ? await db
        .select({ id: books.id, title: books.title, status: books.status })
        .from(books)
        .where(inArray(books.id, bookIds))
    : [];
  const bookMap = new Map(bookRows.map((b) => [b.id, b]));
  const totals = await loadDescendantTokenTotals(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => {
      const t = totals.get(r.id);
      return {
        ...r,
        promptTokens: t?.promptTokens ?? r.promptTokens ?? 0,
        completionTokens: t?.completionTokens ?? r.completionTokens ?? 0,
        book: r.bookId ? bookMap.get(r.bookId) ?? null : null,
      };
    }),
    total,
    limit: data.limit,
    offset: data.offset,
  };
}

/**
 * 给一组 root run id，递归向下走 runs 树并对 llm_calls.{prompt,completion}_tokens 求和。
 * 用一次 SQL 解决批量；root 自己有直接 LLM 调用也算进去。
 */
export async function loadDescendantTokenTotals(
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


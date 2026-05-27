import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { PageHeader, PageShell, SelectControl } from '~/components/ui/page';
import { fetchAuditLogsFn, listUsersFn } from '~/server/fns/auth';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

const PAGE_SIZES = [25, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZES)[number];

interface AuditSearch {
  page: number;
  pageSize: PageSize;
  userId?: string;
  actionLike?: string;
}

function clampPageSize(v: unknown): PageSize {
  const n = Number(v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 50;
}

export const Route = createFileRoute('/audit/')({
  validateSearch: (raw: Record<string, unknown>): AuditSearch => ({
    page: Math.max(1, Number(raw.page) || 1),
    pageSize: clampPageSize(raw.pageSize),
    userId: typeof raw.userId === 'string' && raw.userId ? raw.userId : undefined,
    actionLike:
      typeof raw.actionLike === 'string' && raw.actionLike.trim() ? raw.actionLike.trim() : undefined,
  }),
  beforeLoad: requireAdminBeforeLoad,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const offset = (deps.page - 1) * deps.pageSize;
    const [logs, userList] = await Promise.all([
      fetchAuditLogsFn({
        data: {
          limit: deps.pageSize,
          offset,
          userId: deps.userId,
          actionLike: deps.actionLike,
        },
      }),
      listUsersFn(),
    ]);
    return { logs, userList };
  },
  component: AuditPage,
});

function AuditPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // 受控输入：避免每键入一字就触发服务端查询。失焦或回车再 commit
  const [actionInput, setActionInput] = useState(search.actionLike ?? '');
  useEffect(() => {
    setActionInput(search.actionLike ?? '');
  }, [search.actionLike]);

  function update(patch: Partial<AuditSearch>) {
    navigate({
      search: (old) => ({
        ...(old as AuditSearch),
        ...patch,
        // 任何过滤变化都回到第 1 页（pageSize 切换也回首页）
        page: patch.page ?? 1,
      }),
      replace: false,
    });
  }

  const totalPages = Math.max(1, Math.ceil(data.logs.total / search.pageSize));
  const currentPage = Math.min(search.page, totalPages);
  const fromIdx = data.logs.total === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const toIdx = Math.min(currentPage * search.pageSize, data.logs.total);

  return (
    <PageShell>
      <PageHeader
        title="审计日志"
        description={`共 ${data.logs.total} 条记录`}
        eyebrow="管理员"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="h-4 w-4 text-(--color-muted)" />
            操作记录
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">用户</Label>
              <SelectControl
                value={search.userId ?? ''}
                onChange={(e) =>
                  update({ userId: e.target.value || undefined })
                }
              >
                <option value="">全部用户</option>
                {data.userList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}（{u.role === 'admin' ? '管理员' : '普通'}）
                  </option>
                ))}
              </SelectControl>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">动作（子串匹配）</Label>
              <Input
                value={actionInput}
                placeholder="如 books.delete / settings"
                onChange={(e) => setActionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    update({ actionLike: actionInput.trim() || undefined });
                  }
                }}
                onBlur={() => {
                  if ((actionInput.trim() || undefined) !== search.actionLike) {
                    update({ actionLike: actionInput.trim() || undefined });
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">每页</Label>
              <SelectControl
                value={String(search.pageSize)}
                onChange={(e) => update({ pageSize: clampPageSize(e.target.value) })}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </SelectControl>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-(--color-border)">
            <table className="w-full text-xs">
              <thead className="bg-(--color-surface) text-(--color-muted)">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">时间</th>
                  <th className="px-2 py-2 text-left font-medium">用户</th>
                  <th className="px-2 py-2 text-left font-medium">动作</th>
                  <th className="px-2 py-2 text-left font-medium">对象</th>
                  <th className="px-2 py-2 text-left font-medium">摘要</th>
                  <th className="px-2 py-2 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-(--color-muted)">
                      无记录
                    </td>
                  </tr>
                ) : (
                  data.logs.rows.map((r) => (
                    <tr key={r.id} className="border-t border-(--color-border) align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-(--color-muted)">
                        {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap font-medium text-(--color-fg)">
                        {r.username || <span className="text-(--color-muted)">—</span>}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-(--color-accent)">
                        {r.action}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-(--color-muted)">
                        {r.targetType}
                        {r.targetId ? <span className="ml-1 text-[10px]">/{shortId(r.targetId)}</span> : null}
                      </td>
                      <td className="px-2 py-2 max-w-md text-(--color-fg)">
                        {r.summary}
                        {r.diffJson && r.diffJson !== '{}' && (
                          <details className="mt-1 text-[10px] text-(--color-muted)">
                            <summary className="cursor-pointer">diff</summary>
                            <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded-sm bg-(--color-surface) p-2 text-[10px]">
                              {prettyJson(r.diffJson)}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-[10px] text-(--color-muted)">
                        {r.ip || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-(--color-muted)">
              {data.logs.total === 0
                ? '无结果'
                : `第 ${fromIdx}-${toIdx} 条 / 共 ${data.logs.total} 条`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => update({ page: currentPage - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一页
              </Button>
              <span className="text-xs text-(--color-muted)">
                第 <span className="font-medium text-(--color-fg)">{currentPage}</span> /{' '}
                {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => update({ page: currentPage + 1 })}
              >
                下一页
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

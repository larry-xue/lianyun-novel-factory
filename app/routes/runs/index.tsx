import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { SelectControl } from '~/components/ui/page';
import { fmtTokens } from '~/lib/format';
import { RUN_STATUS_VALUES, type RunStatus } from '~/lib/run-status';
import { listRunsFn } from '~/server/fns/runs';

const PAGE_SIZES = [20, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const STATUS_FILTER_VALUES = ['all', ...RUN_STATUS_VALUES] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: '全部',
  pending: '待执行',
  running: '运行中',
  success: '成功',
  failure: '失败',
  cancelled: '已取消',
};

interface RunsSearch {
  page: number;
  pageSize: PageSize;
  status: StatusFilter;
}

function clampPageSize(v: unknown): PageSize {
  const n = Number(v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 20;
}

function clampStatus(v: unknown): StatusFilter {
  return (STATUS_FILTER_VALUES as readonly string[]).includes(v as string)
    ? (v as StatusFilter)
    : 'all';
}

export const Route = createFileRoute('/runs/')({
  validateSearch: (raw: Record<string, unknown>): RunsSearch => ({
    page: Math.max(1, Number(raw.page) || 1),
    pageSize: clampPageSize(raw.pageSize),
    status: clampStatus(raw.status),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    listRunsFn({
      data: {
        rootsOnly: true,
        status: deps.status === 'all' ? undefined : (deps.status as RunStatus),
        limit: deps.pageSize,
        offset: (deps.page - 1) * deps.pageSize,
      },
    }),
  component: RunsList,
});

const STATUS_ICON = {
  pending: CirclePause,
  running: CircleDot,
  success: CircleCheck,
  failure: CircleAlert,
  cancelled: CircleAlert,
} as const;

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-(--color-muted)',
  running: 'text-blue-500 animate-pulse',
  success: 'text-emerald-500',
  failure: 'text-red-500',
  cancelled: 'text-amber-500',
};

function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start) return '—';
  const t0 = new Date(start).getTime();
  const t1 = end ? new Date(end).getTime() : Date.now();
  const ms = t1 - t0;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function RunsList() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });

  const rows = data.rows;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / search.pageSize));
  const currentPage = Math.min(search.page, totalPages);
  const fromIdx = total === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const toIdx = Math.min(currentPage * search.pageSize, total);
  const hasActive = rows.some((r) => r.status === 'running' || r.status === 'pending');

  // 仅当前页存在 running/pending 时才自动刷新；翻到旧页面就静默
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      router.invalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [hasActive, router]);

  function update(patch: Partial<RunsSearch>) {
    navigate({
      search: (old) => ({
        ...(old as RunsSearch),
        ...patch,
        // pageSize / status 变化时回首页
        page:
          patch.page ??
          (patch.pageSize || patch.status ? 1 : (old as RunsSearch).page),
      }),
      replace: false,
    });
  }

  function goPage(p: number) {
    update({ page: Math.max(1, Math.min(totalPages, p)) });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">跑批观测</h1>
          <p className="mt-1 text-sm text-(--color-muted)">
            每次 produce-book / style-distill 都是一棵 run 树。点进去看 trace。
            {hasActive && (
              <span className="ml-2 text-(--color-accent)">· 自动刷新中</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-(--color-muted)">
          <span>状态</span>
          <SelectControl
            value={search.status}
            onChange={(e) => update({ status: clampStatus(e.target.value) })}
            className="h-8 w-24"
          >
            {STATUS_FILTER_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectControl>
          <span>每页</span>
          <SelectControl
            value={String(search.pageSize)}
            onChange={(e) => update({ pageSize: clampPageSize(e.target.value) })}
            className="h-8 w-20"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </SelectControl>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const Icon = STATUS_ICON[r.status as keyof typeof STATUS_ICON] ?? CircleDot;
          return (
            <Link key={r.id} to="/runs/$id" params={{ id: r.id }}>
              <Card className="transition-colors hover:border-(--color-accent)/50">
                <CardContent className="flex items-center gap-3 p-3">
                  <Icon className={`h-4 w-4 ${STATUS_COLOR[r.status] ?? ''}`} />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs">{r.kind}</span>
                      {r.book && (
                        <span className="text-xs text-(--color-muted)">
                          → {r.book.title}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-(--color-muted)">
                      {new Date(r.createdAt).toLocaleString('zh-CN')} ·{' '}
                      {fmtDuration(r.startedAt, r.finishedAt)} ·{' '}
                      {fmtTokens((r.promptTokens ?? 0) + (r.completionTokens ?? 0))}
                    </div>
                    {r.errorMd && (
                      <div className="mt-1 line-clamp-1 text-[10px] text-red-600">
                        {r.errorMd}
                      </div>
                    )}
                  </div>
                  <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted)">
                    {r.status}
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              {total === 0 ? '还没跑过任何东西。' : '当前页没有数据，回到第 1 页看看。'}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border) pt-3">
        <div className="text-xs text-(--color-muted)">
          {total === 0 ? '无结果' : `第 ${fromIdx}-${toIdx} 条 / 共 ${total} 条`}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => goPage(1)}
            title="首页"
            aria-label="首页"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> 上一页
          </Button>
          <span className="px-2 text-xs text-(--color-muted)">
            第 <span className="font-medium text-(--color-fg)">{currentPage}</span> /{' '}
            {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => goPage(currentPage + 1)}
          >
            下一页 <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => goPage(totalPages)}
            title="末页"
            aria-label="末页"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

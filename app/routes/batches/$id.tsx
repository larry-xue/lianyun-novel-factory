import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, BookOpen, FileWarning } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { fetchBatchFn } from '~/server/fns/batches';

interface BatchData {
  batch: {
    id: string;
    name: string;
    status: string;
    concurrency: number;
    earlyKillBelowChars: number;
    jobsTotal: number;
    jobsCompleted: number;
    jobsKilled: number;
    jobsFailed: number;
  };
  jobs: Array<{
    id: string;
    status: string;
    topicTitle: string;
    pitch: string;
    elementSlugs: string[];
    bookId: string | null;
    rootRunId: string | null;
    errorMd: string | null;
    resultMeta: Record<string, unknown>;
  }>;
}

export const Route = createFileRoute('/batches/$id')({
  component: BatchDetail,
  loader: async ({ params }) => fetchBatchFn({ data: { id: params.id } }),
});

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-(--color-muted)',
  running: 'text-blue-500',
  success: 'text-emerald-500',
  killed: 'text-amber-500',
  failure: 'text-red-500',
};

function BatchDetail() {
  const { batch, jobs } = Route.useLoaderData() as unknown as BatchData;

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/batches"
        className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
      >
        <ArrowLeft className="h-4 w-4" /> 批次列表
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
        <p className="mt-1 text-xs text-(--color-muted)">
          并发 {batch.concurrency} · 总 {batch.jobsTotal} 个选题 · 首章 kill 阈值{' '}
          {batch.earlyKillBelowChars} · 状态 {batch.status}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs text-(--color-muted)">完成</div>
            <div className="mt-1 text-xl font-semibold text-emerald-600">
              {batch.jobsCompleted}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs text-(--color-muted)">淘汰</div>
            <div className="mt-1 text-xl font-semibold text-amber-600">
              {batch.jobsKilled}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs text-(--color-muted)">失败</div>
            <div className="mt-1 text-xl font-semibold text-red-600">
              {batch.jobsFailed}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs text-(--color-muted)">进行中</div>
            <div className="mt-1 text-xl font-semibold">
              {Math.max(
                0,
                batch.jobsTotal - batch.jobsCompleted - batch.jobsKilled - batch.jobsFailed,
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">选题逐条</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-3">
          {jobs.map((j) => {
            const meta = (j.resultMeta ?? {}) as Record<string, unknown>;
            const chapters = (meta.chaptersWritten as number | undefined) ?? 0;
            const avg = (meta.averageCharCount as number | undefined) ?? 0;
            return (
              <div
                key={j.id}
                className="flex items-center gap-2 rounded-md border border-(--color-border) p-2 text-sm"
              >
                <span
                  className={`text-[10px] uppercase tracking-wide ${STATUS_COLOR[j.status] ?? ''}`}
                >
                  {j.status}
                </span>
                <div className="flex-1">
                  <div className="font-medium">{j.topicTitle}</div>
                  <div className="text-[10px] text-(--color-muted)">
                    {j.elementSlugs.join(' · ') || '—'}
                  </div>
                  {j.errorMd && (
                    <div className="mt-0.5 line-clamp-1 text-[10px] text-red-600">
                      <FileWarning className="mr-0.5 inline h-3 w-3" />
                      {j.errorMd}
                    </div>
                  )}
                </div>
                {chapters > 0 && (
                  <span className="text-[10px] text-(--color-muted)">
                    {chapters} 章 · 均 {avg} 字
                  </span>
                )}
                {j.bookId && (
                  <Link
                    to="/books/$bookId"
                    params={{ bookId: j.bookId }}
                    className="text-(--color-muted) hover:text-(--color-fg)"
                    aria-label="查看书"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                  </Link>
                )}
                {j.rootRunId && (
                  <Link
                    to="/runs/$id"
                    params={{ id: j.rootRunId }}
                    className="text-[10px] text-(--color-muted) hover:underline"
                  >
                    trace
                  </Link>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

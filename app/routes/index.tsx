import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Activity,
  BookOpen,
  FileText,
  Hash,
  Layers,
  Loader2,
  PenLine,
  Zap,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { fetchDashboardFn } from '~/server/fns/dashboard';
import { probeLlmFn } from '~/server/fns/settings';
import type { LlmProbeResult } from '~/server/services/llm-health';

export const Route = createFileRoute('/')({
  component: Dashboard,
  loader: () => fetchDashboardFn(),
});

const STATUS_LABEL: Record<string, string> = {
  planning: '筹备中',
  writing: '写作中',
  paused: '已暂停',
  completed: '已完成',
  killed: '已淘汰',
};

const STATUS_COLOR: Record<string, string> = {
  planning: 'text-(--color-muted)',
  writing: 'text-blue-500',
  paused: 'text-amber-500',
  completed: 'text-emerald-500',
  killed: 'text-red-400',
};

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: '排队',
  running: '运行中',
  success: '成功',
  failure: '失败',
  cancelled: '取消',
};

const RUN_STATUS_DOT: Record<string, string> = {
  pending: 'bg-(--color-muted)',
  running: 'bg-blue-500 animate-pulse',
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  cancelled: 'bg-(--color-muted)',
};

function Dashboard() {
  const data = Route.useLoaderData();

  const totalBooks = data.books.total;
  const writingBooks = data.books.byStatus['writing'] ?? 0;
  const completedBooks = data.books.byStatus['completed'] ?? 0;
  const killedBooks = data.books.byStatus['killed'] ?? 0;
  const planningBooks = data.books.byStatus['planning'] ?? 0;

  const tokenK =
    Math.round(
      (data.runs.totalPromptTokens + data.runs.totalCompletionTokens) / 1000,
    );

  const kbTotal =
    data.knowledgeBase.elements +
    data.knowledgeBase.hooks +
    data.knowledgeBase.antiPatterns +
    data.knowledgeBase.styleSamples;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">平台总览</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          实时状态 · 所有数据来自数据库
        </p>
      </header>

      <LlmHealthCard />

      {/* 核心指标 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="书籍总数"
          value={totalBooks}
          detail={`${writingBooks} 写作中 · ${completedBooks} 已完成`}
        />
        <StatCard
          icon={FileText}
          label="章节总数"
          value={data.chapters.total}
          detail={`${data.chapters.finalCount} 终稿 · ${(data.chapters.totalChars / 1000).toFixed(0)}k 字`}
        />
        <StatCard
          icon={Zap}
          label="LLM 调用"
          value={data.runs.total}
          detail={`${data.runs.success} 成功 · ${data.runs.failure} 失败`}
        />
        <StatCard
          icon={Hash}
          label="Token 消耗"
          value={tokenK > 1000 ? `${(tokenK / 1000).toFixed(1)}M` : `${tokenK}k`}
          detail={`${(data.runs.totalPromptTokens / 1000).toFixed(0)}k prompt · ${(data.runs.totalCompletionTokens / 1000).toFixed(0)}k completion`}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 书籍状态分布 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">书籍状态分布</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {totalBooks === 0 ? (
              <Empty text="还没有书籍" />
            ) : (
              Object.entries(data.books.byStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2 text-sm">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        status === 'writing'
                          ? 'bg-blue-500'
                          : status === 'completed'
                            ? 'bg-emerald-500'
                            : status === 'killed'
                              ? 'bg-red-400'
                              : status === 'paused'
                                ? 'bg-amber-500'
                                : 'bg-(--color-muted)'
                      }`}
                    />
                    <span className="flex-1 text-(--color-fg)">
                      {STATUS_LABEL[status] ?? status}
                    </span>
                    <span className={STATUS_COLOR[status] ?? ''}>{count}</span>
                  </div>
                ))
            )}
            {totalBooks > 0 && (
              <Link
                to="/books"
                className="mt-2 text-xs text-(--color-accent) hover:underline"
              >
                查看书架 →
              </Link>
            )}
          </CardContent>
        </Card>

        {/* 最近活动 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">最近活动</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {data.runs.recent.length === 0 ? (
              <Empty text="还没有运行记录" />
            ) : (
              data.runs.recent.map((r) => (
                <Link
                  key={r.id}
                  to="/runs/$id"
                  params={{ id: r.id }}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-(--color-surface)"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${RUN_STATUS_DOT[r.status] ?? ''}`}
                  />
                  <span className="flex-1 truncate text-(--color-fg)">
                    {r.kind}
                  </span>
                  <span className="text-[10px] text-(--color-muted)">
                    {RUN_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.bookId && (
                    <Link
                      to="/books/$bookId"
                      params={{ bookId: r.bookId }}
                      className="text-[10px] text-(--color-muted) hover:text-(--color-fg)"
                      onClick={(e) => e.stopPropagation()}
                    >
                      书
                    </Link>
                  )}
                  {r.startedAt && (
                    <span className="text-[10px] text-(--color-muted)">
                      {new Date(r.startedAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </Link>
              ))
            )}
            {data.runs.recent.length > 0 && (
              <Link
                to="/runs"
                search={{ page: 1, pageSize: 20, status: 'all' }}
                className="mt-1 text-xs text-(--color-accent) hover:underline"
              >
                查看全部 →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 知识库概况 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wide text-(--color-muted)">
          知识库 · {kbTotal} 条
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KbCard
            to="/elements"
            icon={Layers}
            label="元素词典"
            count={data.knowledgeBase.elements}
          />
          <KbCard
            to="/hooks"
            icon={Zap}
            label="Hook 模板"
            count={data.knowledgeBase.hooks}
          />
          <KbCard
            to="/anti-patterns"
            icon={BookOpen}
            label="反例库"
            count={data.knowledgeBase.antiPatterns}
          />
          <KbCard
            to="/styles/samples"
            icon={PenLine}
            label="范文库"
            count={data.knowledgeBase.styleSamples}
          />
        </div>
      </section>
    </div>
  );
}

function LlmHealthCard() {
  const [result, setResult] = useState<LlmProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientErr, setClientErr] = useState<string | null>(null);

  async function runProbe() {
    setLoading(true);
    setClientErr(null);
    try {
      const r = await probeLlmFn();
      setResult(r);
    } catch (e) {
      setClientErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Activity className="h-4 w-4 shrink-0 text-(--color-muted)" />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium">LLM 健康探测</div>
            {result ? (
              <ProbeResultLine result={result} />
            ) : clientErr ? (
              <div className="text-xs text-red-500 truncate">{clientErr}</div>
            ) : (
              <div className="text-xs text-(--color-muted)">
                点「立即测试」对当前配置的 LLM 打一次 json_object 探测请求（15s 超时）
              </div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={runProbe}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              探测中…
            </>
          ) : result ? (
            '再测一次'
          ) : (
            '立即测试'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProbeResultLine({ result }: { result: LlmProbeResult }) {
  const dotClass = result.ok
    ? 'bg-emerald-500'
    : result.errorCode === 'timeout'
      ? 'bg-amber-500 animate-pulse'
      : 'bg-red-500';
  const statusLabel = result.ok ? '健康' : labelForErrorCode(result.errorCode);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={result.ok ? 'text-emerald-600' : 'text-red-500'}>
          {statusLabel}
        </span>
      </span>
      <span className="text-(--color-muted)">·</span>
      <span className="text-(--color-muted)">{(result.latencyMs / 1000).toFixed(2)}s</span>
      {result.model && (
        <>
          <span className="text-(--color-muted)">·</span>
          <span className="text-(--color-muted)">{result.model}</span>
        </>
      )}
      {!result.ok && result.errorMessage && (
        <span
          className="block w-full truncate text-red-500/80"
          title={result.errorMessage}
        >
          {result.errorMessage}
        </span>
      )}
    </div>
  );
}

function labelForErrorCode(code: string | undefined): string {
  if (!code) return '失败';
  if (code === 'timeout') return '超时';
  if (code === 'no-config') return '未配置';
  if (code === 'no-choices') return '响应无内容';
  if (code === 'unknown') return '网络/未知错误';
  if (/^\d+$/.test(code)) return `HTTP ${code}`;
  return code;
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-(--color-muted)">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold sm:text-2xl">{value}</div>
        <div className="mt-0.5 text-[10px] text-(--color-muted) sm:text-[11px]">{detail}</div>
      </CardContent>
    </Card>
  );
}

function KbCard({
  to,
  icon: Icon,
  label,
  count,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-(--color-accent)/50">
        <CardContent className="p-3 text-center">
          <Icon className="mx-auto h-4 w-4 text-(--color-muted)" />
          <div className="mt-1 text-lg font-semibold">{count}</div>
          <div className="text-[10px] text-(--color-muted)">{label}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-6 text-center text-sm text-(--color-muted)">{text}</div>
  );
}

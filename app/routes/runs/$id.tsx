import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  PlayCircle,
  StopCircle,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { fmtTokens } from '~/lib/format';
import { cancelRunFn, fetchRunTreeFn, replayRunFn } from '~/server/fns/runs';

export const Route = createFileRoute('/runs/$id')({
  component: RunDetail,
  loader: async ({ params }) => fetchRunTreeFn({ data: { id: params.id } }),
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
  running: 'text-blue-500',
  success: 'text-emerald-500',
  failure: 'text-red-500',
  cancelled: 'text-amber-500',
};

interface RunRow {
  id: string;
  kind: string;
  status: string;
  parentId: string | null;
  bookId: string | null;
  promptTokens: number;
  completionTokens: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMd: string | null;
  input: unknown;
  output: unknown;
}

interface LlmCallRow {
  id: string;
  runId: string | null;
  model: string;
  prompt: unknown;
  response: string | null;
  responseJson: unknown;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number | null;
  errorMd: string | null;
  createdAt: Date;
}

interface ToolCallRow {
  id: string;
  runId: string;
  parentLlmCallId: string | null;
  seq: number;
  toolName: string;
  argsJson: unknown;
  resultMd: string;
  errorMd: string | null;
  durationMs: number | null;
  createdAt: Date;
}

function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start) return '—';
  const t0 = new Date(start).getTime();
  const t1 = end ? new Date(end).getTime() : Date.now();
  const ms = t1 - t0;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function buildTree(rows: RunRow[], rootId: string) {
  const byParent = new Map<string | null, RunRow[]>();
  for (const r of rows) {
    const arr = byParent.get(r.parentId) ?? [];
    arr.push(r);
    byParent.set(r.parentId, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return ta - tb;
    });
  }
  const root = rows.find((r) => r.id === rootId);
  if (!root) return null;
  function walk(node: RunRow): { node: RunRow; children: ReturnType<typeof walk>[] } {
    const kids = byParent.get(node.id) ?? [];
    return { node, children: kids.map(walk) };
  }
  return walk(root);
}

interface RunTreeData {
  focusRunId: string;
  rootRunId: string;
  runs: RunRow[];
  llmCallsByRun: Record<string, LlmCallRow[]>;
  toolCallsByRun: Record<string, ToolCallRow[]>;
}

function RunDetail() {
  const data = Route.useLoaderData() as unknown as RunTreeData;
  const router = useRouter();
  const tree = buildTree(data.runs, data.rootRunId);
  const [selectedId, setSelectedId] = useState<string>(data.focusRunId);
  const [replaying, setReplaying] = useState(false);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  const hasActive = data.runs.some(
    (r) => r.status === 'running' || r.status === 'pending',
  );
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      router.invalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [hasActive, router]);

  const selectedRun = data.runs.find((r) => r.id === selectedId);
  const llmCalls = data.llmCallsByRun[selectedId] ?? [];
  const toolCalls = data.toolCallsByRun[selectedId] ?? [];
  // 按 createdAt 交错合并 llmCalls 与 toolCalls，渲染成 harness 时间序
  const timeline: Array<{ kind: 'llm'; row: LlmCallRow } | { kind: 'tool'; row: ToolCallRow }> = [
    ...llmCalls.map((c) => ({ kind: 'llm' as const, row: c, ts: new Date(c.createdAt).getTime() })),
    ...toolCalls.map((t) => ({ kind: 'tool' as const, row: t, ts: new Date(t.createdAt).getTime() })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .map(({ kind, row }) => (kind === 'llm' ? { kind, row } : { kind, row }));

  const root = tree?.node;
  const canReplay =
    !!root &&
    (root.kind === 'produce-book' ||
      root.kind === 'produce-book-existing' ||
      root.kind === 'produce-book-resume' ||
      root.kind === 'write-next-chapter');
  const replayLabel = root?.kind === 'produce-book' ? '用相同输入回放' : '重试 / 续跑';
  const canCancel =
    !!root && (root.status === 'running' || root.status === 'pending');

  async function replay() {
    if (!canReplay || !root) return;
    setReplayErr(null);
    setReplaying(true);
    try {
      const r = await replayRunFn({ data: { runId: root.id } });
      router.navigate({ to: '/runs/$id', params: { id: r.newRootRunId } });
    } catch (e) {
      setReplayErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReplaying(false);
    }
  }

  async function cancel() {
    if (!canCancel || !root) return;
    if (!window.confirm(`确认中断这次 ${root.kind}？正在飞的 LLM 请求会立即 abort，已写入的章节保留。`)) {
      return;
    }
    setCancelErr(null);
    setCancelling(true);
    try {
      await cancelRunFn({ data: { runId: root.id } });
      router.invalidate();
    } catch (e) {
      setCancelErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  }

  if (!tree) {
    return <div className="text-sm text-(--color-muted)">run 不存在</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/runs"
          search={{ page: 1, pageSize: 20, status: 'all' }}
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> 跑批列表
        </Link>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button
              onClick={cancel}
              disabled={cancelling}
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <StopCircle className="h-4 w-4" />
              {cancelling ? '中断中…' : '停止'}
            </Button>
          )}
          {canReplay && (
            <Button onClick={replay} disabled={replaying} variant="outline">
              <PlayCircle className="h-4 w-4" />
              {replaying ? '处理中…' : replayLabel}
            </Button>
          )}
        </div>
      </div>

      <header>
        <h1 className="font-mono text-xl font-semibold">{root!.kind}</h1>
        <p className="mt-1 text-xs text-(--color-muted)">
          {root!.id} · {root!.status} ·{' '}
          {fmtDuration(root!.startedAt, root!.finishedAt)} ·{' '}
          {fmtTokens((root!.promptTokens ?? 0) + (root!.completionTokens ?? 0))}
          {hasActive && (
            <span className="ml-2 text-(--color-accent)">· 自动刷新中</span>
          )}
        </p>
      </header>

      {replayErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {replayErr}
        </div>
      )}

      {cancelErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {cancelErr}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">trace 树</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-auto p-2">
            <TreeNode
              tree={tree}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {selectedRun && (
            <Card>
              <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-sm font-mono break-all">{selectedRun.kind}</CardTitle>
                <span className="text-[10px] text-(--color-muted)">
                  {selectedRun.status} ·{' '}
                  {fmtDuration(selectedRun.startedAt, selectedRun.finishedAt)} ·{' '}
                  {fmtTokens((selectedRun.promptTokens ?? 0) + (selectedRun.completionTokens ?? 0))}
                </span>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {selectedRun.errorMd && (
                  <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                    {selectedRun.errorMd}
                  </pre>
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-(--color-muted) hover:text-(--color-fg)">
                    input
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-(--color-bg) p-2 text-[11px]">
                    {JSON.stringify(selectedRun.input, null, 2)}
                  </pre>
                </details>
                <details>
                  <summary className="cursor-pointer text-xs text-(--color-muted) hover:text-(--color-fg)">
                    output
                  </summary>
                  <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                    {JSON.stringify(selectedRun.output, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )}

          {timeline.map((item, i) =>
            item.kind === 'llm' ? (
              <Card key={item.row.id}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Turn #{i + 1} · {item.row.model}
                  </CardTitle>
                  <p className="text-[10px] text-(--color-muted)">
                    {item.row.latencyMs != null ? `${item.row.latencyMs} ms` : '—'} ·{' '}
                    {fmtTokens((item.row.promptTokens ?? 0) + (item.row.completionTokens ?? 0))}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {item.row.errorMd && (
                    <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                      {item.row.errorMd}
                    </pre>
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs text-(--color-muted) hover:text-(--color-fg)">
                      prompt
                    </summary>
                    <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                      {renderPrompt(item.row.prompt)}
                    </pre>
                  </details>
                  <details open>
                    <summary className="cursor-pointer text-xs text-(--color-muted) hover:text-(--color-fg)">
                      response
                    </summary>
                    <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                      {item.row.response ?? JSON.stringify(item.row.responseJson, null, 2)}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            ) : (
              <Card
                key={item.row.id}
                className={
                  item.row.errorMd
                    ? 'border-red-300 bg-red-50/40'
                    : 'border-(--color-accent)/30 bg-(--color-accent)/5'
                }
              >
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-sm font-mono">
                    🔧 {item.row.toolName}
                    <span className="ml-2 text-[10px] font-normal text-(--color-muted)">
                      seq #{item.row.seq} ·{' '}
                      {item.row.durationMs != null ? `${item.row.durationMs} ms` : '—'}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 p-3 pt-1">
                  <details>
                    <summary className="cursor-pointer text-[11px] text-(--color-muted) hover:text-(--color-fg)">
                      args
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-(--color-bg) p-2 text-[11px]">
                      {JSON.stringify(item.row.argsJson, null, 2)}
                    </pre>
                  </details>
                  <details open>
                    <summary className="cursor-pointer text-[11px] text-(--color-muted) hover:text-(--color-fg)">
                      result {item.row.errorMd ? '· ⚠ error' : ''}
                    </summary>
                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                      {item.row.resultMd}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            ),
          )}
          {selectedRun && timeline.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-xs text-(--color-muted)">
                这个节点没有 LLM / 工具调用（容器节点）。
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNode(props: {
  tree: { node: RunRow; children: { node: RunRow; children: unknown[] }[] };
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { tree, depth, selectedId, onSelect } = props;
  const Icon = STATUS_ICON[tree.node.status as keyof typeof STATUS_ICON] ?? CircleDot;
  const active = tree.node.id === selectedId;
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(tree.node.id)}
        className={`flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs hover:bg-(--color-bg) ${
          active ? 'bg-(--color-bg) font-medium' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
        <Icon className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLOR[tree.node.status] ?? ''}`} />
        <span className="font-mono">{tree.node.kind}</span>
        <span className="ml-auto pl-2 text-[10px] text-(--color-muted)">
          {fmtDuration(tree.node.startedAt, tree.node.finishedAt)}
        </span>
      </button>
      {tree.children.map((child) => (
        <TreeNode
          key={child.node.id}
          tree={child as never}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function renderPrompt(p: unknown): string {
  if (!p) return '（空）';
  if (typeof p === 'string') return p;
  if (typeof p === 'object' && p !== null && 'messages' in (p as Record<string, unknown>)) {
    const o = p as { messages?: Array<{ role: string; content: string }>; agent?: string };
    const head = o.agent ? `# agent: ${o.agent}\n\n` : '';
    const body = (o.messages ?? [])
      .map((m) => `### ${m.role}\n${m.content}`)
      .join('\n\n');
    return head + body;
  }
  return JSON.stringify(p, null, 2);
}

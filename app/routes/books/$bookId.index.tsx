import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  Copy,
  FileText,
  History,
  Layers,
  Loader2,
  PenTool,
  Sparkles,
  RotateCcw,
  Rocket,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { fmtTokens } from '~/lib/format';
import {
  fetchBookFn,
  writeNextChapterFn,
  deleteLastChapterFn,
} from '~/server/fns/books';
import {
  listArcSummariesFn,
  listOutlineRevisionsFn,
} from '~/server/fns/book-maintenance';
import { approveGateFn, listGatesForBookFn, rejectGateFn } from '~/server/fns/gates';
import { listThreadsForBookFn } from '~/server/fns/plot-threads';
import { listOutlineNodesForBookFn } from '~/server/fns/outline-nodes';
import { listVolumeSummariesForBookFn } from '~/server/fns/volume-summaries';
import { listRunsForBookFn } from '~/server/fns/runs';
import { listSnapshotsFn, restoreToChapterFn } from '~/server/fns/snapshots';
import { enqueuePilotForBookFn } from '~/server/fns/batches';
import { OwnerOnly, useIsBookOwner } from '~/components/auth/gates';
import { useBookBusy } from '~/lib/use-book-busy';

export const Route = createFileRoute('/books/$bookId/')({
  component: BookDetail,
  loader: async ({ params }) => {
    const [
      main,
      arcSummaries,
      outlineRevisions,
      gates,
      threads,
      outlineNodes,
      volumeSummaries,
      bookRuns,
      snapshots,
    ] = await Promise.all([
      fetchBookFn({ data: { id: params.bookId } }),
      listArcSummariesFn({ data: { bookId: params.bookId } }),
      listOutlineRevisionsFn({ data: { bookId: params.bookId } }),
      listGatesForBookFn({ data: { bookId: params.bookId } }),
      listThreadsForBookFn({ data: { bookId: params.bookId } }),
      listOutlineNodesForBookFn({ data: { bookId: params.bookId } }),
      listVolumeSummariesForBookFn({ data: { bookId: params.bookId } }),
      listRunsForBookFn({ data: { bookId: params.bookId, limit: 8, rootsOnly: true } }),
      listSnapshotsFn({ data: { bookId: params.bookId } }),
    ]);
    return {
      ...main,
      arcSummaries,
      outlineRevisions,
      gates,
      threads,
      outlineNodes,
      volumeSummaries,
      bookRuns,
      snapshots,
    };
  },
});

function BookDetail() {
  const {
    book,
    chapters,
    states,
    arcSummaries,
    outlineRevisions,
    gates,
    threads,
    outlineNodes,
    volumeSummaries,
    bookRuns,
    snapshots,
  } = Route.useLoaderData();
  const router = useRouter();
  const isOwner = useIsBookOwner(book.ownerId);
  const [busyGate, setBusyGate] = useState<string | null>(null);
  const [gateErr, setGateErr] = useState<string | null>(null);

  // busy 状态以服务端 runs / batch_jobs 为准；避免本地按钮态在刷新后丢失。
  const busy = useBookBusy(book.id);
  const hasActiveRun = busy.any || bookRuns.some(
    (r) => r.status === 'running' || r.status === 'pending',
  );
  const isProducing = hasActiveRun || book.status === 'writing';
  useEffect(() => {
    if (!isProducing) return;
    const id = setInterval(() => {
      router.invalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [isProducing, router]);

  const totalChars = chapters.reduce((acc, c) => acc + c.charCount, 0);
  const avgChars = chapters.length ? Math.round(totalChars / chapters.length) : 0;
  const pendingGates = gates.filter((g) => g.status === 'pending');

  // 'planning' 通常意味着没立项；但如果已有章节还卡在 'planning'（多见于 produceForExistingBook 被重跑、
  // status 被回写又没人触发 resume），让按钮仍然可用——writeNextChapter 内部会把 status 修回 'writing'。
  const canWriteNext =
    pendingGates.length === 0 &&
    book.status !== 'killed' &&
    book.status !== 'completed' &&
    (book.status !== 'planning' || chapters.length > 0);
  const [writingNext, setWritingNext] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  async function writeNext() {
    setWriteErr(null);
    setWritingNext(true);
    try {
      await writeNextChapterFn({ data: { bookId: book.id } });
      router.invalidate();
    } catch (e) {
      setWriteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWritingNext(false);
    }
  }

  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Pilot 跑批
  const [pilotOpen, setPilotOpen] = useState(false);
  const [pilotCount, setPilotCount] = useState(20);
  const [pilotBusy, setPilotBusy] = useState(false);
  const [pilotErr, setPilotErr] = useState<string | null>(null);

  async function startPilot() {
    setPilotErr(null);
    setPilotBusy(true);
    try {
      await enqueuePilotForBookFn({
        data: { bookId: book.id, chapterCount: pilotCount },
      });
      setPilotOpen(false);
      router.invalidate();
    } catch (e) {
      setPilotErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPilotBusy(false);
    }
  }

  // Snapshot 回退
  const [restoreBusy, setRestoreBusy] = useState<number | null>(null);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);

  async function rollback(idx: number) {
    if (!confirm(`回退到第 ${idx} 章快照？\n之后的章节会被软删（status=killed），文档/状态还原到当时。`)) return;
    setRestoreErr(null);
    setRestoreBusy(idx);
    try {
      await restoreToChapterFn({ data: { bookId: book.id, chapterIdx: idx } });
      router.invalidate();
    } catch (e) {
      setRestoreErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoreBusy(null);
    }
  }

  async function deleteLast() {
    if (!confirm('确认删除最后一章？此操作不可撤销。')) return;
    setDeleteErr(null);
    setDeleting(true);
    try {
      const result = await deleteLastChapterFn({ data: { bookId: book.id } });
      alert(`已删除第 ${result.deletedIdx} 章「${result.deletedTitle}」`);
      router.invalidate();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  async function approve(gateId: string) {
    setGateErr(null);
    setBusyGate(gateId);
    try {
      await approveGateFn({ data: { gateId } });
      router.invalidate();
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyGate(null);
    }
  }

  async function reject(gateId: string) {
    if (!confirm('确认拒绝？后续流程将停在此处。')) return;
    setGateErr(null);
    setBusyGate(gateId);
    try {
      await rejectGateFn({ data: { gateId } });
      router.invalidate();
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyGate(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link
          to="/books"
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> 书架
        </Link>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            hasActiveRun
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-(--color-border) text-(--color-muted)'
          }`}
        >
          {hasActiveRun && <CircleDot className="h-3 w-3 animate-pulse" />}
          {book.status}
          {isProducing && <span className="text-[10px] opacity-70">· 实时</span>}
        </span>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{book.title}</h1>
        <p className="mt-1 text-xs text-(--color-muted)">
          {book.elementSlugs.join(' · ') || '—'} · {chapters.length} 章 · 平均 {avgChars} 字
        </p>
        {book.mainCategory && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-(--color-accent) bg-(--color-accent)/10 px-2 py-0.5 font-medium text-(--color-accent)">
              {book.mainCategory}
            </span>
            {book.themes.map((t) => (
              <span key={t} className="rounded-full border border-(--color-border) px-2 py-0.5 text-(--color-muted)">
                {t}
              </span>
            ))}
            {book.characterTypes.map((t) => (
              <span key={t} className="rounded-full border border-(--color-border) px-2 py-0.5 text-(--color-muted)">
                {t}
              </span>
            ))}
            {book.plotElements.map((t) => (
              <span key={t} className="rounded-full border border-(--color-border) px-2 py-0.5 text-(--color-muted)">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <Link
              to="/books/$bookId/chat"
              params={{ bookId: book.id }}
              className="text-(--color-accent) hover:underline"
            >
              立项 chat →
            </Link>
            <Link
              to="/books/$bookId/design"
              params={{ bookId: book.id }}
              className="text-(--color-accent) hover:underline"
            >
              故事设计 →
            </Link>
            <Link
              to="/books/$bookId/files"
              params={{ bookId: book.id }}
              className="text-(--color-accent) hover:underline"
            >
              活文档 →
            </Link>
            <Link
              to="/books/$bookId/threads"
              params={{ bookId: book.id }}
              className="text-(--color-accent) hover:underline"
            >
              伏笔看板（{threads.length}）→
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {!isOwner && (
              <span
                className="rounded-full bg-(--color-surface) px-2 py-0.5 text-[10px] text-(--color-muted)"
                title="他人创建，仅可查看"
              >
                只读
              </span>
            )}
            <OwnerOnly ownerId={book.ownerId}>
              {chapters.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={deleteLast}
                  disabled={deleting || busy.writing || busy.loading}
                  title={busy.writing ? '正在生成章节，无法删末章' : undefined}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {deleting ? '删除中…' : '删末章'}
                </Button>
              )}
              {canWriteNext && (
                <>
                  <Link
                    to="/books/$bookId/scout/$idx"
                    params={{ bookId: book.id, idx: String(chapters.length + 1) }}
                    aria-disabled={busy.writing || busy.brainstorm || busy.loading}
                    onClick={(e) => {
                      if (busy.writing || busy.brainstorm || busy.loading) e.preventDefault();
                    }}
                    className={busy.writing || busy.brainstorm || busy.loading ? 'pointer-events-none opacity-50' : ''}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy.writing || busy.brainstorm || busy.loading}
                      title={busy.writing ? '正在生成章节' : busy.brainstorm ? 'scout 正在跑' : undefined}
                      className="text-(--color-accent) hover:bg-(--color-accent)/10"
                    >
                      <Sparkles className="h-3 w-3" />
                      scout 下一章
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPilotOpen((v) => !v)}
                    disabled={busy.writing || busy.loading}
                    title={busy.writing ? '已有写章 / pilot 在跑' : undefined}
                    className="text-(--color-accent) hover:bg-(--color-accent)/10"
                  >
                    <Rocket className="h-3 w-3" />
                    Pilot 跑批
                  </Button>
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={writeNext}
                    disabled={writingNext || busy.writing || busy.loading}
                    title={busy.writing ? '已有写章 / pilot 在跑' : undefined}
                  >
                    {writingNext || busy.writing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenTool className="h-3 w-3" />}
                    {writingNext
                      ? '生成中…'
                      : busy.writing
                        ? '后台跑批中…'
                        : `写第 ${chapters.length + 1} 章`}
                  </Button>
                </>
              )}
            </OwnerOnly>
          </div>
        </div>
        {isOwner && (writeErr || deleteErr || pilotErr || restoreErr) && (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {writeErr || deleteErr || pilotErr || restoreErr}
          </div>
        )}
        {pilotOpen && isOwner && (
          <Card className="mt-3 border-(--color-accent)/40 bg-(--color-accent)/5">
            <CardContent className="flex flex-col gap-2 p-3 text-xs">
              <div className="flex items-center gap-2 font-medium text-(--color-fg)">
                <Rocket className="h-3.5 w-3.5 text-(--color-accent)" />
                Pilot 模式：自动跑 N 章 + 每章打快照
              </div>
              <p className="text-[11px] text-(--color-muted)">
                每写完一章会打一份全量快照（state + 全部活文档），跑完后可以在下面「快照面板」一键回退到任意一章。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-(--color-muted)">章数（1-20）</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={pilotCount}
                  onChange={(e) => {
                    const n = Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1)));
                    setPilotCount(n);
                  }}
                  className="w-16 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 text-xs"
                />
                <Button
                  size="sm"
                  variant="accent"
                  onClick={startPilot}
                  disabled={pilotBusy || busy.writing || busy.loading}
                  title={busy.writing ? '已有写章 / pilot 在跑' : undefined}
                >
                  {pilotBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  {pilotBusy ? '排队中…' : `开跑 ${pilotCount} 章`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPilotOpen(false)} disabled={pilotBusy}>
                  取消
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </header>

      {pendingGates.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm text-amber-900">
              ⏸ 等待 gate 确认（{pendingGates.length}）
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-3 pt-1">
            {gateErr && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                {gateErr}
              </div>
            )}
            {pendingGates.map((g) => (
              <div
                key={g.id}
                className="flex items-start justify-between gap-2 rounded border border-amber-200 bg-white p-2 text-xs"
              >
                <div className="flex-1">
                  <div className="font-mono text-[10px] text-amber-900">{g.kind}</div>
                  <div className="mt-0.5 text-(--color-fg)">{g.noteMd}</div>
                  <div className="mt-0.5 text-[10px] text-(--color-muted)">
                    {new Date(g.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="flex gap-1">
                  <OwnerOnly
                    ownerId={book.ownerId}
                    fallback={
                      <span className="rounded-full bg-(--color-surface) px-2 py-1 text-[10px] text-(--color-muted)">
                        仅创建者可处理
                      </span>
                    }
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => reject(g.id)}
                      disabled={busyGate === g.id}
                    >
                      <XCircle className="h-3 w-3" />
                      拒绝
                    </Button>
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => approve(g.id)}
                      disabled={busyGate === g.id}
                    >
                      {busyGate === g.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      确认
                    </Button>
                  </OwnerOnly>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <BookRunsSection runs={bookRuns} live={isProducing} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-(--color-muted)">总字数</div>
            <div className="mt-1 text-xl font-semibold">{totalChars.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-(--color-muted)">平均/章</div>
            <div className="mt-1 text-xl font-semibold">{avgChars}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-(--color-muted)">状态快照数</div>
            <div className="mt-1 text-xl font-semibold">{states.length}</div>
          </CardContent>
        </Card>
      </div>

      <CollapsibleSection
        icon={BookOpen}
        title={`章节（${chapters.length}）· 倒序`}
        defaultOpen
      >
        <ChapterList chapters={chapters} />
      </CollapsibleSection>

      {snapshots.length > 0 && (
        <CollapsibleSection
          icon={RotateCcw}
          title={`快照面板（${snapshots.length}）· pilot 跑批每章自动打`}
        >
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="border-b border-(--color-border) text-left text-(--color-muted)">
                  <tr>
                    <th className="px-3 py-1.5">章</th>
                    <th className="px-3 py-1.5">阶段</th>
                    <th className="px-3 py-1.5">上一章核心事件</th>
                    <th className="px-3 py-1.5">活文档</th>
                    <th className="px-3 py-1.5">时间</th>
                    {isOwner && <th className="px-3 py-1.5"></th>}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-(--color-border) last:border-0 hover:bg-(--color-accent)/5"
                    >
                      <td className="px-3 py-1.5 align-top font-mono">{s.chapterIdx}</td>
                      <td className="px-3 py-1.5 align-top">{s.arcStage || '—'}</td>
                      <td className="px-3 py-1.5 align-top">
                        {s.lastEventSummaryMd
                          ? s.lastEventSummaryMd.length > 60
                            ? s.lastEventSummaryMd.slice(0, 60) + '…'
                            : s.lastEventSummaryMd
                          : '—'}
                      </td>
                      <td className="px-3 py-1.5 align-top text-(--color-muted)">{s.docCount} 份</td>
                      <td className="px-3 py-1.5 align-top text-[10px] text-(--color-muted)">
                        {new Date(s.createdAt).toLocaleString('zh-CN')}
                      </td>
                      {isOwner && (
                        <td className="px-3 py-1.5 align-top">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6"
                            onClick={() => rollback(s.chapterIdx)}
                            disabled={restoreBusy !== null || busy.writing || busy.loading}
                            title={busy.writing ? '正在写章 / pilot 跑批中，无法回退' : undefined}
                          >
                            {restoreBusy === s.chapterIdx ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            回退到此处
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      {outlineNodes.length > 0 && (
        <CollapsibleSection
          icon={Layers}
          title={`分层大纲（${outlineNodes.length} 节点）`}
        >
          <Card>
            <CardContent className="p-3">
              <OutlineTree nodes={outlineNodes} />
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      {volumeSummaries.length > 0 && (
        <CollapsibleSection
          icon={Layers}
          title={`卷摘要（${volumeSummaries.length}）`}
        >
          <div className="flex flex-col gap-2">
            {volumeSummaries.map((v) => (
              <Card key={v.id}>
                <CardContent className="flex flex-col gap-1 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      卷 {v.volumeIdx} {v.volumeName}
                    </span>
                    <span className="text-[10px] text-(--color-muted)">
                      第 {v.rangeStart}-{v.rangeEnd} 章
                    </span>
                  </div>
                  <p className="text-[11px] whitespace-pre-wrap text-(--color-muted)">
                    {v.summaryMd}
                  </p>
                  {v.styleDriftNotesMd && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      <b>风格漂移：</b>{v.styleDriftNotesMd}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        icon={Layers}
        title={`Arc 摘要（${arcSummaries.length}）`}
      >
        {arcSummaries.length > 0 ? (
          <div className="flex flex-col gap-2">
            {arcSummaries.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex flex-col gap-1 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      Arc {a.arcIdx} {a.arcName}
                    </span>
                    <span className="text-[10px] text-(--color-muted)">
                      第 {a.rangeStart}-{a.rangeEnd} 章
                    </span>
                  </div>
                  <p className="text-[11px] whitespace-pre-wrap text-(--color-muted)">
                    {a.summaryMd}
                  </p>
                  {a.pivotsMd && (
                    <p className="mt-1 text-[11px] text-(--color-fg)">
                      <span className="font-medium">关键转折：</span>
                      {a.pivotsMd}
                    </p>
                  )}
                  {a.openThreads.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-(--color-muted)">
                      {a.openThreads.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-(--color-border) px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-xs italic text-(--color-muted)">（暂无 arc 摘要）</div>
        )}
      </CollapsibleSection>

      {outlineRevisions.length > 0 && (
        <CollapsibleSection
          icon={History}
          title={`大纲修订历史（${outlineRevisions.length}）`}
        >
          <div className="flex flex-col gap-2">
            {outlineRevisions.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-1 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">v{r.version}</span>
                    <span className="text-[10px] text-(--color-muted)">
                      {r.triggeredAtChapterIdx != null
                        ? `触发于 ch${r.triggeredAtChapterIdx}`
                        : '初版'}{' '}
                      · {new Date(r.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {r.reasonMd && (
                    <p className="text-[11px] text-(--color-muted)">{r.reasonMd}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {book.pacingPlanMd && (
        <CollapsibleSection title="整本节拍曲线">
          <Card>
            <CardContent className="p-4">
              <p className="whitespace-pre-wrap text-xs text-(--color-fg)">
                {book.pacingPlanMd}
              </p>
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      {book.bookSummaryMd && (
        <CollapsibleSection title="整本摘要">
          <Card>
            <CardContent className="p-4">
              <p className="whitespace-pre-wrap text-xs text-(--color-fg)">
                {book.bookSummaryMd}
              </p>
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        icon={Sparkles}
        title={`书内工作记忆轨迹（${states.length}）`}
      >
        <div className="overflow-x-auto rounded-md border border-(--color-border) bg-(--color-card)">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="border-b border-(--color-border) text-left text-(--color-muted)">
              <tr>
                <th className="px-2 py-1.5">章</th>
                <th className="px-2 py-1.5">阶段</th>
                <th className="px-2 py-1.5">上一章核心事件</th>
                <th className="px-2 py-1.5">下一章意图</th>
              </tr>
            </thead>
            <tbody>
              {states.map((s) => (
                <tr key={s.chapterIdx} className="border-b border-(--color-border) last:border-0">
                  <td className="px-2 py-1.5 align-top font-mono">{s.chapterIdx}</td>
                  <td className="px-2 py-1.5 align-top">{s.arcStage}</td>
                  <td className="px-2 py-1.5 align-top">{s.lastEventSummaryMd}</td>
                  <td className="px-2 py-1.5 align-top">{s.nextChapterIntentMd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div>
  );
}

/* ── 通用折叠 section：默认折叠（章节传 defaultOpen 强制打开） ── */

function CollapsibleSection({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-left text-sm font-medium tracking-wide text-(--color-muted) hover:text-(--color-fg)"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0" />
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span>{title}</span>
      </button>
      {open && children}
    </section>
  );
}

/* ── 章节列表：倒序，最新一章默认展开 ── */

interface ChapterItem {
  id: string;
  idx: number;
  title: string;
  contentMd: string;
  charCount: number;
  status: string;
  createdAt: Date;
}

const CHAPTER_PAGE_SIZE = 10;

function ChapterList({ chapters }: { chapters: ChapterItem[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedTitleId, setCopiedTitleId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  function copyContent(c: ChapterItem) {
    navigator.clipboard.writeText(c.contentMd).then(() => {
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function copyTitle(c: ChapterItem) {
    navigator.clipboard.writeText(c.title).then(() => {
      setCopiedTitleId(c.id);
      setTimeout(() => setCopiedTitleId(null), 2000);
    });
  }

  if (chapters.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-(--color-muted)">
          还没生成任何章节。
        </CardContent>
      </Card>
    );
  }

  const maxIdx = chapters.reduce((acc, c) => Math.max(acc, c.idx), -Infinity);
  const ordered = [...chapters].sort((a, b) => b.idx - a.idx);
  const totalPages = Math.ceil(ordered.length / CHAPTER_PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * CHAPTER_PAGE_SIZE;
  const visible = ordered.slice(start, start + CHAPTER_PAGE_SIZE);
  const headIdx = visible[0]?.idx;
  const tailIdx = visible[visible.length - 1]?.idx;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((c) => {
        const inRange = c.charCount >= 2700 && c.charCount <= 3300;
        const isLast = c.idx === maxIdx;
        return (
          <Card key={c.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3 pb-1">
              <CardTitle className="min-w-0 flex-1 truncate text-sm">
                第 {c.idx} 章 {c.title}
              </CardTitle>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-xs ${inRange ? 'text-(--color-muted)' : 'text-amber-600'}`}>
                  {c.charCount} 字
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => copyTitle(c)}
                  title="复制标题"
                >
                  {copiedTitleId === c.id ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => copyContent(c)}
                  title="复制正文"
                >
                  {copiedId === c.id ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <details {...(isLast ? { open: true } : {})}>
                <summary className="cursor-pointer text-xs text-(--color-muted) hover:text-(--color-fg)">
                  展开正文
                </summary>
                <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-3 text-xs leading-relaxed sm:max-h-96">
                  {c.contentMd}
                </pre>
              </details>
            </CardContent>
          </Card>
        );
      })}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1 text-xs text-(--color-muted)">
          <Button
            size="sm"
            variant="ghost"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← 上一页
          </Button>
          <span>
            第 {safePage + 1} / {totalPages} 页 · 章 {tailIdx}-{headIdx}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            下一页 →
          </Button>
        </div>
      )}
    </div>
  );
}

interface OutlineNodeView {
  id: string;
  parentId: string | null;
  level: 'volume' | 'arc' | 'chapter';
  idx: number;
  title: string;
  summaryMd: string;
  intent: string;
  pacingPhase: string;
}

function OutlineTree({ nodes }: { nodes: OutlineNodeView[] }) {
  // 按 parentId 分桶，递归渲染
  const byParent = new Map<string | null, OutlineNodeView[]>();
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.idx - b.idx);

  function render(parentId: string | null, depth: number): React.ReactNode[] {
    const kids = byParent.get(parentId) ?? [];
    return kids.flatMap((n) => {
      const indent = depth * 12;
      const tag =
        n.level === 'volume' ? '卷' : n.level === 'arc' ? '弧' : 'ch';
      return [
        <div
          key={n.id}
          className="border-l border-(--color-border) py-0.5 text-xs"
          style={{ paddingLeft: indent + 8 }}
        >
          <span className="font-mono text-[10px] text-(--color-muted)">
            {tag}
            {n.idx}
          </span>{' '}
          <span className="text-(--color-fg)">{n.title || '（无标题）'}</span>
          {n.pacingPhase && (
            <span className="ml-2 text-[10px] text-(--color-muted)">[{n.pacingPhase}]</span>
          )}
          {n.summaryMd && (
            <div
              className="mt-0.5 text-[10px] text-(--color-muted)"
              style={{ paddingLeft: 0 }}
            >
              {n.summaryMd.length > 80 ? n.summaryMd.slice(0, 80) + '…' : n.summaryMd}
            </div>
          )}
        </div>,
        ...render(n.id, depth + 1),
      ];
    });
  }

  // 顶层 = parentId === null（卷或扁平 chapter 都可能）
  const tree = render(null, 0);
  if (tree.length === 0) {
    return <div className="text-xs italic text-(--color-muted)">（暂无节点）</div>;
  }
  return <div className="flex flex-col gap-0.5">{tree}</div>;
}

/* ── 当前书的近期 root run 列表，可直接跳到 /runs/$id ── */

const RUN_STATUS_ICON = {
  pending: CirclePause,
  running: CircleDot,
  success: CircleCheck,
  failure: CircleAlert,
  cancelled: CircleAlert,
} as const;

const RUN_STATUS_COLOR: Record<string, string> = {
  pending: 'text-(--color-muted)',
  running: 'text-blue-500 animate-pulse',
  success: 'text-emerald-500',
  failure: 'text-red-500',
  cancelled: 'text-amber-500',
};

interface BookRunRow {
  id: string;
  kind: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  promptTokens: number;
  completionTokens: number;
  errorMd: string | null;
  createdAt: Date;
}

function fmtRunDuration(start: Date | null, end: Date | null): string {
  if (!start) return '—';
  const t0 = new Date(start).getTime();
  const t1 = end ? new Date(end).getTime() : Date.now();
  const ms = t1 - t0;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function BookRunsSection({ runs, live }: { runs: BookRunRow[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-left text-sm font-medium tracking-wide text-(--color-muted) hover:text-(--color-fg)"
      >
        <Chevron className="h-3.5 w-3.5" />
        <Activity className="h-3.5 w-3.5" />
        <span>近期跑批（{runs.length}）</span>
        {live && (
          <span className="ml-2 text-(--color-accent)">· 自动刷新</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {runs.map((r) => {
            const Icon = RUN_STATUS_ICON[r.status as keyof typeof RUN_STATUS_ICON] ?? CircleDot;
            return (
              <Link key={r.id} to="/runs/$id" params={{ id: r.id }}>
                <Card className="transition-colors hover:border-(--color-accent)/50">
                  <CardContent className="flex items-center gap-3 p-2.5">
                    <Icon className={`h-3.5 w-3.5 ${RUN_STATUS_COLOR[r.status] ?? ''}`} />
                    <div className="flex-1">
                      <div className="font-mono text-xs">{r.kind}</div>
                      <div className="text-[10px] text-(--color-muted)">
                        {new Date(r.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {fmtRunDuration(r.startedAt, r.finishedAt)} ·{' '}
                        {fmtTokens((r.promptTokens ?? 0) + (r.completionTokens ?? 0))}
                      </div>
                      {r.errorMd && (
                        <div className="mt-0.5 line-clamp-1 text-[10px] text-red-600">
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
        </div>
      )}
    </section>
  );
}

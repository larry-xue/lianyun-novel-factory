import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Card, CardContent } from '~/components/ui/card';
import { listThreadsForBookFn } from '~/server/fns/plot-threads';
import { fetchBookFn } from '~/server/fns/books';

export const Route = createFileRoute('/books/$bookId/threads')({
  component: ThreadsRoute,
  loader: async ({ params }) => {
    const [main, threads] = await Promise.all([
      fetchBookFn({ data: { id: params.bookId } }),
      listThreadsForBookFn({ data: { bookId: params.bookId } }),
    ]);
    return { bookId: params.bookId, book: main.book, chapters: main.chapters, threads };
  },
});

const STATUS_META: Record<
  string,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  open: { label: '待埋', color: 'border-blue-300 text-blue-700 bg-blue-50', icon: Clock },
  hinted: { label: '已暗示', color: 'border-amber-300 text-amber-700 bg-amber-50', icon: AlertTriangle },
  paying: { label: '回收中', color: 'border-violet-300 text-violet-700 bg-violet-50', icon: Clock },
  paid_off: { label: '已回收', color: 'border-emerald-300 text-emerald-700 bg-emerald-50', icon: CheckCircle2 },
  abandoned: { label: '已作废', color: 'border-red-300 text-red-700 bg-red-50', icon: XCircle },
};

const WEIGHT_META: Record<string, { label: string; window: number }> = {
  small: { label: '短线', window: 4 },
  arc: { label: '弧线', window: 10 },
  book: { label: '主线', window: 50 },
};

function ThreadsRoute() {
  const { bookId, book, chapters, threads } = Route.useLoaderData();
  const currentChapterIdx = chapters.length;

  const [statusFilter, setStatusFilter] = useState<string | 'all'>('all');
  const [weightFilter, setWeightFilter] = useState<string | 'all'>('all');

  const filtered = threads.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (weightFilter !== 'all' && t.weight !== weightFilter) return false;
    return true;
  });

  const counts = {
    open: threads.filter((t) => t.status === 'open').length,
    hinted: threads.filter((t) => t.status === 'hinted').length,
    paying: threads.filter((t) => t.status === 'paying').length,
    paid_off: threads.filter((t) => t.status === 'paid_off').length,
    abandoned: threads.filter((t) => t.status === 'abandoned').length,
  };

  const overdue = threads.filter(
    (t) =>
      (t.status === 'open' || t.status === 'hinted') &&
      currentChapterIdx > t.expectedPayoffEnd,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          to="/books/$bookId"
          params={{ bookId }}
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> 返回 {book.title}
        </Link>
        <span className="text-[10px] text-(--color-muted)">当前 ch{currentChapterIdx}</span>
      </div>

      <header>
        <h1 className="text-xl font-semibold tracking-tight">伏笔看板</h1>
        <p className="mt-0.5 text-xs text-(--color-muted)">
          {threads.length} 条伏笔。期望窗口 = [introduce+1, +N]，N 由 weight 决定（短/弧/书 = 4/10/50 章）。
        </p>
      </header>

      {overdue.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ 有 <b>{overdue.length}</b> 条超期未收 / 未作废。下一章 chapter-writer 会优先看到（P0），
          也可以等 5 章 grace 后由 markOverdueAsAbandoned 自动转 abandoned。
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 text-xs scrollbar-none">
        <FilterPill
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          label={`全部 (${threads.length})`}
        />
        {(['open', 'hinted', 'paying', 'paid_off', 'abandoned'] as const).map((s) => (
          <FilterPill
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            label={`${STATUS_META[s]!.label} (${counts[s]})`}
            color={STATUS_META[s]!.color}
          />
        ))}
        <span className="shrink-0 h-4 border-l border-(--color-border)" />
        <FilterPill
          active={weightFilter === 'all'}
          onClick={() => setWeightFilter('all')}
          label="所有权重"
        />
        {(['small', 'arc', 'book'] as const).map((w) => (
          <FilterPill
            key={w}
            active={weightFilter === w}
            onClick={() => setWeightFilter(w)}
            label={WEIGHT_META[w]!.label}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              没有符合筛选条件的伏笔。
            </CardContent>
          </Card>
        )}
        {filtered.map((t) => {
          const sm = STATUS_META[t.status] ?? STATUS_META.open!;
          const Icon = sm.icon;
          const isOverdueOpen =
            (t.status === 'open' || t.status === 'hinted') &&
            currentChapterIdx > t.expectedPayoffEnd;
          const chaptersLeft = t.expectedPayoffEnd - currentChapterIdx;
          return (
            <Card key={t.id}>
              <CardContent className="flex flex-col gap-1.5 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{t.title}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${sm.color}`}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {sm.label}
                  </span>
                  <span className="rounded-full border border-(--color-border) px-1.5 py-0.5 text-[10px] text-(--color-muted)">
                    {WEIGHT_META[t.weight]?.label ?? t.weight}
                  </span>
                  {isOverdueOpen && (
                    <span className="rounded-full border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                      P0 已超 {currentChapterIdx - t.expectedPayoffEnd} 章
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-(--color-muted)">
                  <code className="rounded bg-(--color-bg) px-1">{t.slug}</code>
                  <span>
                    第 {t.introducedAtChapterIdx} 章引入 → 期望 {t.expectedPayoffStart}-
                    {t.expectedPayoffEnd} 章回收
                  </span>
                  {(t.status === 'open' || t.status === 'hinted') && !isOverdueOpen && (
                    <span>{chaptersLeft >= 0 ? `还剩 ${chaptersLeft} 章窗口` : ''}</span>
                  )}
                </div>
                {t.payoffTriggerMd && (
                  <div className="text-[11px] text-(--color-muted)">
                    <b>触发条件：</b>
                    {t.payoffTriggerMd}
                  </div>
                )}
                {t.detailMd && t.detailMd !== t.title && (
                  <div className="text-[11px] text-(--color-fg)">{t.detailMd}</div>
                )}
                {t.status === 'paid_off' && t.payoffNotesMd && (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
                    <b>回收记录：</b>
                    {t.payoffNotesMd}
                  </div>
                )}
                {t.status === 'abandoned' && t.payoffNotesMd && (
                  <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900">
                    {t.payoffNotesMd}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function FilterPill(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 transition-colors ${
        props.active
          ? props.color ?? 'border-(--color-accent) bg-(--color-accent) text-white'
          : 'border-(--color-border) text-(--color-muted) hover:border-(--color-fg)'
      }`}
    >
      {props.label}
    </button>
  );
}

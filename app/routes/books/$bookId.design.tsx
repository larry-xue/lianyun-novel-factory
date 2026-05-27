import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CirclePause,
  FileText,
  Loader2,
  Sparkles,
  Users,
  Globe,
  ScrollText,
  Network,
  Zap,
  XCircle,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Label } from '~/components/ui/label';
import { PageHeader, PageShell } from '~/components/ui/page';
import { fetchBookFn, designBookFn, startProductionFn } from '~/server/fns/books';
import { listDocsForBookFn } from '~/server/fns/book-docs';
import { useBookBusy } from '~/lib/use-book-busy';

/**
 * 4 份硬底线 doc（与 story-designer-harness 的 checkHardFloorDocs 保持一致）：
 * 主角 character 的 slug 不固定（拼音随主角名），所以 character 走"至少 1 份"判定。
 */
type FloorRow =
  | { id: 'protagonist'; label: string; icon: typeof Users; match: 'character-any' }
  | { id: string; label: string; icon: typeof Globe; match: 'kind-slug'; kind: string; slug: string };

const FLOOR_ROWS: FloorRow[] = [
  { id: 'protagonist', label: '主角卡 docs/character/<protagonist>', icon: Users, match: 'character-any' },
  {
    id: 'world-setting',
    label: '世界观 docs/world/setting',
    icon: Globe,
    match: 'kind-slug',
    kind: 'world',
    slug: 'setting',
  },
  {
    id: 'world-rules',
    label: '世界硬规则 docs/world/rules',
    icon: ScrollText,
    match: 'kind-slug',
    kind: 'world',
    slug: 'rules',
  },
  {
    id: 'relations',
    label: '关系图 docs/relations/character-relations',
    icon: Network,
    match: 'kind-slug',
    kind: 'relations',
    slug: 'character-relations',
  },
];

interface DocRow {
  id: string;
  bookId: string;
  kind: string;
  slug: string;
  title: string;
  version: number;
  lastEditedBy: string;
  updatedAt: Date;
}

export const Route = createFileRoute('/books/$bookId/design')({
  component: DesignPage,
  loader: async ({ params }) => {
    const [main, docsResult] = await Promise.all([
      fetchBookFn({ data: { id: params.bookId } }),
      listDocsForBookFn({ data: { bookId: params.bookId } }),
    ]);
    return { ...main, docs: docsResult.docs };
  },
});

function DesignPage() {
  const { book, docs } = Route.useLoaderData();
  const router = useRouter();

  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [producing, setProducing] = useState(false);
  const [produceErr, setProduceErr] = useState<string | null>(null);
  const busy = useBookBusy(book.id);

  // 服务端 design / write 在跑时拉一下页面
  useEffect(() => {
    if (!busy.design && !busy.writing) return;
    const id = setInterval(() => router.invalidate(), 3000);
    return () => clearInterval(id);
  }, [busy.design, busy.writing, router]);

  // 排除运行期衍生 / 主编私人的 kind，只保留 vault
  const vaultDocs = (docs as DocRow[]).filter(
    (d) => d.kind !== 'chapter-plan' && d.kind !== 'milestone' && d.kind !== 'reader_notes',
  );
  const charDocs = vaultDocs.filter((d) => d.kind === 'character');
  const floorState = FLOOR_ROWS.map((row) => {
    if (row.match === 'character-any') {
      const hit = charDocs[0];
      return { ...row, doc: hit, ok: !!hit };
    }
    const hit = vaultDocs.find((d) => d.kind === row.kind && d.slug === row.slug);
    return { ...row, doc: hit, ok: !!hit };
  });
  const allFloorMet = floorState.every((r) => r.ok);

  // 其他 vault docs（不在 4 份硬底线里的）
  const floorDocIds = new Set(
    floorState.map((r) => r.doc?.id).filter((x): x is string => !!x),
  );
  const otherDocs = vaultDocs.filter((d) => !floorDocIds.has(d.id));
  // 按 kind 分组
  const otherByKind = new Map<string, DocRow[]>();
  for (const d of otherDocs) {
    const arr = otherByKind.get(d.kind) ?? [];
    arr.push(d);
    otherByKind.set(d.kind, arr);
  }
  for (const arr of otherByKind.values()) arr.sort((a, b) => a.slug.localeCompare(b.slug));

  async function generate(fb?: string) {
    setGenErr(null);
    setGenerating(true);
    try {
      await designBookFn({ data: { bookId: book.id, feedback: fb || undefined } });
      setFeedback('');
      router.invalidate();
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function startProduction() {
    setProduceErr(null);
    setProducing(true);
    try {
      await startProductionFn({ data: { bookId: book.id, gateMode: 'auto-with-confirm' } });
      router.navigate({ to: '/books/$bookId', params: { bookId: book.id } });
    } catch (e) {
      setProduceErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProducing(false);
    }
  }

  const protagonist = book.protagonist || '（未设）';
  const hasBrief = !!(book.loglineMd || book.mainArcMd);

  return (
    <PageShell>
      <div className="flex items-center gap-3">
        <Link
          to="/books/$bookId"
          params={{ bookId: book.id }}
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> {book.title}
        </Link>
      </div>

      <PageHeader
        title="故事设计"
        description="story-designer 一气呵成产出 vault：character / world / relations + 题材自创 kind。文档编辑请到「活文档」页。"
        eyebrow="创作阶段"
      />

      {/* 操作区 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="accent"
            onClick={() => generate()}
            disabled={generating || busy.design || busy.loading}
            title={busy.design ? '已有设计在跑（可能是另一标签页触发的）' : undefined}
          >
            {generating || busy.design ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating
              ? '生成中…'
              : busy.design
                ? '后台生成中…'
                : allFloorMet
                  ? '重新生成（覆盖现有 vault）'
                  : 'AI 一键生成 vault'}
          </Button>
          {allFloorMet &&
            (busy.awaitingGate?.kind === 'gate-1' ? (
              <Link
                to="/books/$bookId"
                params={{ bookId: book.id }}
                className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
                title="已发起章节循环，正在等你点确认"
              >
                <CirclePause className="h-4 w-4" />
                等 gate-1 确认（去书详情页 →）
              </Link>
            ) : (
              <Button
                variant="accent"
                onClick={startProduction}
                disabled={producing || busy.writing || busy.design || busy.loading}
                title={
                  busy.writing
                    ? '已有写章 / pilot 在跑'
                    : busy.design
                      ? '设计还没跑完'
                      : undefined
                }
              >
                {producing || busy.writing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {producing ? '正在启动生产…' : busy.writing ? '后台生成中…' : '开始章节循环'}
              </Button>
            ))}
          <Link
            to="/books/$bookId/files"
            params={{ bookId: book.id }}
            className="ml-auto inline-flex items-center gap-1 text-xs text-(--color-accent) hover:underline"
          >
            <FileText className="h-3 w-3" />
            完整活文档（{vaultDocs.length}）→
          </Link>
        </div>
        {allFloorMet && (
          <div className="flex flex-col gap-2 rounded-md border border-(--color-border) bg-(--color-card) p-3">
            <Label className="text-xs text-(--color-muted)">反馈修改</Label>
            <textarea
              className="min-h-[60px] w-full rounded-md border border-(--color-border) bg-(--color-bg) p-2 text-xs text-(--color-fg) focus:border-(--color-accent) focus:outline-none"
              placeholder="例如：主角性格太软弱，改成更强势的；世界观改成修仙体系；增加一个关键反派角色…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generate(feedback)}
                disabled={generating || !feedback.trim() || busy.design || busy.loading}
                title={busy.design ? '已有设计在跑' : undefined}
              >
                {generating || busy.design ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                根据反馈重新生成
              </Button>
            </div>
          </div>
        )}
      </div>

      {genErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{genErr}</div>
      )}
      {produceErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{produceErr}</div>
      )}

      {/* 立项 brief 一览（books 表） */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">立项 brief（books 表 · story-designer 落库）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-4 pt-0 text-xs">
          {!hasBrief ? (
            <p className="italic text-(--color-muted)">尚未跑 story-designer。点上方"AI 一键生成 vault"开始。</p>
          ) : (
            <>
              <div>
                <span className="text-(--color-muted)">主角：</span>
                <span className="text-(--color-fg)">{protagonist}</span>
              </div>
              <div>
                <span className="text-(--color-muted)">一句话：</span>
                <span className="text-(--color-fg)">{book.loglineMd || '（未设）'}</span>
              </div>
              <div>
                <span className="text-(--color-muted)">面向：</span>
                <span className="text-(--color-fg)">{book.audience || '（未设）'}</span>
              </div>
              {book.mainArcMd && (
                <div>
                  <span className="text-(--color-muted)">主线：</span>
                  <span className="whitespace-pre-wrap text-(--color-fg)">{book.mainArcMd}</span>
                </div>
              )}
              {book.prohibitedTropes && book.prohibitedTropes.length > 0 && (
                <div>
                  <span className="text-(--color-muted)">题材红线：</span>
                  <ul className="mt-0.5 list-disc pl-5 text-(--color-fg)">
                    {book.prohibitedTropes.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-1 text-[10px] text-(--color-muted)">
                ↑ 这些字段直接进 chapter-planner / chapter-writer prompt 静态区。改动请先重新跑 story-designer 或修改 books 表。
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 4 份硬底线 doc 状态 */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">
            硬底线 vault doc（4 份）
            {allFloorMet ? (
              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                全齐
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                {floorState.filter((r) => r.ok).length} / {floorState.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-4 pt-0">
          {floorState.map((row) => (
            <FloorRowCard key={row.id} bookId={book.id} row={row} />
          ))}
        </CardContent>
      </Card>

      {/* 其他 vault docs（按 kind 分组） */}
      {otherDocs.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">其他 vault docs（{otherDocs.length}）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4 pt-0">
            {Array.from(otherByKind.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([kind, kindDocs]) => (
                <div key={kind} className="flex flex-col gap-1">
                  <div className="text-[11px] font-medium text-(--color-muted)">{kind}/</div>
                  <div className="flex flex-col gap-1">
                    {kindDocs.map((d) => (
                      <DocLine key={d.id} bookId={book.id} doc={d} />
                    ))}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

type FloorRowState = FloorRow & { doc: DocRow | undefined; ok: boolean };

function FloorRowCard({
  bookId,
  row,
}: {
  bookId: string;
  row: FloorRowState;
}) {
  const Icon = row.icon;
  return (
    <div className="flex items-center gap-3 rounded-md border border-(--color-border) bg-(--color-card) p-3">
      {row.ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-(--color-muted)" />
      )}
      <Icon className="h-4 w-4 shrink-0 text-(--color-muted)" />
      <div className="min-w-0 flex-1">
        <div className="text-xs">{row.label}</div>
        {row.doc ? (
          <div className="mt-0.5 text-[10px] text-(--color-muted)">
            <span className="font-mono">{row.doc.kind}/{row.doc.slug}</span> · v{row.doc.version} ·{' '}
            {row.doc.lastEditedBy === 'agent' ? 'AI 生成' : '人工编辑'}
          </div>
        ) : (
          <div className="mt-0.5 text-[10px] text-amber-600">未生成</div>
        )}
      </div>
      {row.doc && (
        <Link
          to="/books/$bookId/files/$kind/$"
          params={{ bookId, kind: row.doc.kind, _splat: row.doc.slug }}
          className="shrink-0 text-[11px] text-(--color-accent) hover:underline"
        >
          查看 / 编辑 →
        </Link>
      )}
    </div>
  );
}

function DocLine({ bookId, doc }: { bookId: string; doc: DocRow }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-(--color-border) bg-(--color-card) px-3 py-1.5 text-xs">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-mono text-[10px] text-(--color-muted)">
          {doc.kind}/{doc.slug}
        </span>{' '}
        · {doc.title}
        <span className="ml-2 text-[10px] text-(--color-muted)">
          v{doc.version} · {doc.lastEditedBy === 'agent' ? 'AI' : '人工'}
        </span>
      </div>
      <Link
        to="/books/$bookId/files/$kind/$"
        params={{ bookId, kind: doc.kind, _splat: doc.slug }}
        className="shrink-0 text-(--color-accent) hover:underline"
      >
        查看 →
      </Link>
    </div>
  );
}

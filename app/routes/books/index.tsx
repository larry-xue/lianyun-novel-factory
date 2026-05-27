import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, Copy, Loader2, MessageSquare, PenLine, Pin, PinOff, Sparkles, Square, Trash2, Users, X } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  copyBookFn,
  deleteBookFn,
  deleteBooksFn,
  listBooksFn,
  togglePinBookFn,
} from '~/server/fns/books';
import { startBookFromIdeaFn } from '~/server/fns/negotiations';
import { fetchElementsFn } from '~/server/fns/elements';
import { listStyleSamplesFn } from '~/server/fns/style-samples';
import { useMe } from '~/lib/auth-client';

export const Route = createFileRoute('/books/')({
  component: BooksList,
  loader: async () => ({
    books: await listBooksFn({ data: undefined }),
    elements: await fetchElementsFn({ data: undefined }),
    styleSamples: await listStyleSamplesFn(),
  }),
});

function BooksList() {
  const { books, elements, styleSamples } = Route.useLoaderData();
  const router = useRouter();
  const me = useMe();
  const canEditBook = (ownerId: string | null | undefined) => {
    if (!me) return false;
    if (me.role === 'admin') return true;
    return !!ownerId && ownerId === me.id;
  };
  // 多选模式下只允许选自己有权操作的书；勾过的书若失去权限自动取消
  const editableBookIds = useMemo(
    () => new Set(books.filter((b) => canEditBook(b.ownerId)).map((b) => b.id)),
    [books, me?.id, me?.role],
  );

  const [idea, setIdea] = useState('');
  const [totalChapters, setTotalChapters] = useState(20);
  const [charsPerChapter, setCharsPerChapter] = useState(3000);
  const [pickedElementSlugs, setPickedElementSlugs] = useState<Set<string>>(() => new Set());
  const [pickedSampleIds, setPickedSampleIds] = useState<Set<string>>(() => new Set());
  const [pickerSearch, setPickerSearch] = useState('');
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const elementsByCategory = useMemo(() => {
    const filtered = pickerSearch.trim()
      ? elements.filter(
          (e) =>
            e.zh.includes(pickerSearch) ||
            e.slug.toLowerCase().includes(pickerSearch.toLowerCase()),
        )
      : elements;
    const grouped = new Map<string, typeof elements>();
    for (const el of filtered) {
      const cat = el.category || '其他';
      const arr = grouped.get(cat) ?? [];
      arr.push(el);
      grouped.set(cat, arr);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh'));
  }, [elements, pickerSearch]);

  function toggleElement(slug: string) {
    setPickedElementSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < 20) next.add(slug);
      return next;
    });
  }
  function toggleSample(id: string) {
    setPickedSampleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  }
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  function toggleSelect(bookId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function selectAll() {
    setSelected(new Set(editableBookIds));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `确认批量删除 ${selected.size} 本书？这会一并删除它们的章节、设定和运行工作区数据，不可恢复。`,
      )
    ) {
      return;
    }
    setErr(null);
    setBatchDeleting(true);
    try {
      const r = await deleteBooksFn({ data: { bookIds: Array.from(selected) } });
      exitSelectMode();
      router.invalidate();
      if (r.deletedCount < selected.size) {
        setErr(`已删 ${r.deletedCount} 本（${selected.size - r.deletedCount} 本未命中，可能已被其他地方删除）`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchDeleting(false);
    }
  }

  async function start() {
    setErr(null);
    setStarting(true);
    try {
      const { bookId } = await startBookFromIdeaFn({
        data: {
          briefIdeaMd: idea,
          targetTotalChapters: totalChapters,
          targetCharsPerChapter: charsPerChapter,
          elementSlugs: Array.from(pickedElementSlugs),
          styleSampleIds: Array.from(pickedSampleIds),
        },
      });
      router.navigate({ to: '/books/$bookId/chat', params: { bookId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function copyBook(bookId: string) {
    setCopyingId(bookId);
    try {
      const { newBookId } = await copyBookFn({ data: { bookId } });
      router.navigate({ to: '/books/$bookId', params: { bookId: newBookId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingId(null);
    }
  }

  async function togglePin(bookId: string, pinned: boolean) {
    setPinningId(bookId);
    try {
      await togglePinBookFn({ data: { bookId, pinned: !pinned } });
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPinningId(null);
    }
  }

  async function deleteBook(bookId: string, title: string) {
    if (!confirm(`确认删除《${title}》？这会删除这本书的章节、设定和运行工作区数据。`)) {
      return;
    }
    setErr(null);
    setDeletingId(bookId);
    try {
      await deleteBookFn({ data: { bookId } });
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">书架</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          已立项 {books.length} 本。给一段想法 → 跟选题侦察聊出方向 → 开始写作。
        </p>
      </header>

      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            aria-expanded={formOpen}
            className="flex w-full items-center justify-between text-left"
          >
            <CardTitle>
              <Sparkles className="mr-2 inline h-4 w-4" />
              从一段想法立项
            </CardTitle>
            {formOpen ? (
              <ChevronDown className="h-4 w-4 text-(--color-muted)" />
            ) : (
              <ChevronRight className="h-4 w-4 text-(--color-muted)" />
            )}
          </button>
        </CardHeader>
        {formOpen && (
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label>你的想法 / 文案 / 要求（≥10 字）</Label>
            <Textarea
              rows={4}
              value={idea}
              placeholder="想写一本社畜重生末世前 7 天的男频，主角靠前世记忆 + 现代理财思维抢先囤货，希望节奏快、爽点密、不要恋爱线…"
              onChange={(e) => setIdea(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>目标章数</Label>
            <Input
              type="number"
              min={1}
              max={2000}
              value={totalChapters}
              onChange={(e) => setTotalChapters(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>每章字数</Label>
            <Input
              type="number"
              min={500}
              max={8000}
              step={100}
              value={charsPerChapter}
              onChange={(e) => setCharsPerChapter(Number(e.target.value))}
            />
          </div>

          <div className="md:col-span-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>
                元素词典 <span className="text-(--color-muted)">（多选，最多 20 个；可选）</span>
              </Label>
              <span className="text-xs text-(--color-muted)">
                已选 {pickedElementSlugs.size}
              </span>
            </div>
            <Input
              placeholder="搜中文名 / slug…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto rounded-md border border-(--color-border) bg-(--color-surface) p-2">
              {elementsByCategory.length === 0 ? (
                <div className="px-2 py-3 text-xs text-(--color-muted)">没有匹配的元素</div>
              ) : (
                elementsByCategory.map(([cat, list]) => (
                  <div key={cat} className="mb-2 last:mb-0">
                    <div className="mb-1 text-[10px] font-medium tracking-wide text-(--color-muted)">
                      {cat}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((el) => {
                        const on = pickedElementSlugs.has(el.slug);
                        return (
                          <button
                            key={el.id}
                            type="button"
                            onClick={() => toggleElement(el.slug)}
                            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                              on
                                ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                                : 'border-(--color-border) text-(--color-muted) hover:border-(--color-accent)/50 hover:text-(--color-fg)'
                            }`}
                            title={el.slug}
                          >
                            {el.zh}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>
                范文 <span className="text-(--color-muted)">（多选，最多 10 篇；可选）</span>
              </Label>
              <span className="text-xs text-(--color-muted)">已选 {pickedSampleIds.size}</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-(--color-border) bg-(--color-surface) p-2">
              {styleSamples.length === 0 ? (
                <div className="px-2 py-3 text-xs text-(--color-muted)">
                  还没有范文。可去 <Link to="/styles/samples" className="underline">/styles/samples</Link> 添加。
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {styleSamples.map((s) => {
                    const on = pickedSampleIds.has(s.id);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => toggleSample(s.id)}
                          className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                            on
                              ? 'border-(--color-accent) bg-(--color-accent)/10'
                              : 'border-(--color-border) hover:border-(--color-accent)/50'
                          }`}
                        >
                          {on ? (
                            <CheckSquare className="h-3 w-3 shrink-0 text-(--color-accent)" />
                          ) : (
                            <Square className="h-3 w-3 shrink-0 text-(--color-muted)" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium">{s.author}</span>
                            <span className="mx-1 text-(--color-muted)">·</span>
                            <span>{s.title}</span>
                          </span>
                          {s.tags.length > 0 && (
                            <span className="shrink-0 text-[10px] text-(--color-muted)">
                              {s.tags.slice(0, 2).join('/')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {err && (
            <div className="md:col-span-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="md:col-span-2 flex justify-end">
            <Button variant="accent" onClick={start} disabled={starting || idea.trim().length < 10}>
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              进入立项 chat
            </Button>
          </div>
        </CardContent>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium tracking-wide text-(--color-muted)">
            已立项{selectMode && (
              <span className="ml-2 text-(--color-accent)">
                · 已选 {selected.size} / {books.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectAll}
                  disabled={editableBookIds.size === 0 || selected.size === editableBookIds.size}
                  title="只选我有权操作的书"
                >
                  全选
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                >
                  清空
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={deleteSelected}
                  disabled={selected.size === 0 || batchDeleting}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  {batchDeleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  删 {selected.size} 本
                </Button>
                <Button size="sm" variant="ghost" onClick={exitSelectMode}>
                  <X className="h-3 w-3" />
                  退出选择
                </Button>
              </>
            ) : (
              books.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectMode(true)}
                >
                  <CheckSquare className="h-3 w-3" />
                  多选
                </Button>
              )
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {books.map((b) => {
            const pinned = !!b.pinnedAt;
            const isSelected = selected.has(b.id);
            const editable = canEditBook(b.ownerId);
            // 移动端 action 按钮（pin/copy/delete）会一直浮在右上角，
            // 给标题行预留 pr-24 的让位区，并把状态徽章下移到 meta 行避开它。
            const actionPad = !selectMode && editable ? 'pr-24 sm:pr-0' : '';
            const cardInner = (
              <Card
                className={`transition-colors hover:border-(--color-accent)/50 ${
                  selectMode && isSelected
                    ? 'border-red-400 bg-red-50/40'
                    : pinned
                      ? 'border-(--color-accent)/60 bg-(--color-accent)/5'
                      : ''
                } ${selectMode && !editable ? 'opacity-60' : ''}`}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  {selectMode && (
                    <div className="mt-0.5 shrink-0">
                      {!editable ? (
                        <Square className="h-4 w-4 text-(--color-muted)/40" />
                      ) : isSelected ? (
                        <CheckSquare className="h-4 w-4 text-red-600" />
                      ) : (
                        <Square className="h-4 w-4 text-(--color-muted)" />
                      )}
                    </div>
                  )}
                  <div className={`flex min-w-0 flex-1 flex-col gap-1 ${actionPad}`}>
                    <div className="flex min-w-0 items-center gap-1.5 font-semibold">
                      {pinned && (
                        <Pin className="h-3 w-3 shrink-0 fill-current text-(--color-accent)" />
                      )}
                      <span className="min-w-0 truncate">{b.title}</span>
                      {!editable && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-(--color-surface) px-1.5 py-0.5 text-[9px] font-normal text-(--color-muted)"
                          title="他人创建，只读"
                        >
                          <Users className="h-2.5 w-2.5" />
                          他人
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-(--color-muted) break-all">
                      {b.elementSlugs.join(' · ') || '—'}
                    </div>
                    {b.mainCategory && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="rounded-full border border-(--color-accent) bg-(--color-accent)/10 px-1.5 py-0.5 font-medium text-(--color-accent)">
                          {b.mainCategory}
                        </span>
                        {b.themes.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full border border-(--color-border) px-1.5 py-0.5 text-(--color-muted)">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-(--color-muted)">
                      <span className="rounded-full border border-(--color-border) px-2 py-0.5">
                        {b.status}
                      </span>
                      <span className="truncate">
                        {new Date(b.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
            return (
            <div key={b.id} className="relative group">
              {selectMode ? (
                editable ? (
                  <button
                    type="button"
                    onClick={() => toggleSelect(b.id)}
                    className="block w-full text-left"
                    aria-pressed={isSelected}
                  >
                    {cardInner}
                  </button>
                ) : (
                  // 不可编辑的书在多选模式下不可勾选，但保留卡片展示
                  <div className="block w-full cursor-not-allowed">{cardInner}</div>
                )
              ) : (
                <Link to="/books/$bookId" params={{ bookId: b.id }}>
                  {cardInner}
                </Link>
              )}
              {!selectMode && editable && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      togglePin(b.id, pinned);
                    }}
                    disabled={pinningId === b.id}
                    className={`absolute top-3 right-[5.25rem] rounded-md border border-(--color-border) bg-(--color-bg) p-1 transition-opacity hover:text-(--color-accent) ${
                      pinned
                        ? 'text-(--color-accent) opacity-100'
                        : 'text-(--color-muted) opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
                    }`}
                    title={pinned ? '取消置顶' : '置顶'}
                    aria-label={pinned ? `取消置顶 ${b.title}` : `置顶 ${b.title}`}
                  >
                    {pinningId === b.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : pinned ? (
                      <PinOff className="h-3 w-3" />
                    ) : (
                      <Pin className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyBook(b.id);
                    }}
                    disabled={copyingId === b.id}
                    className="absolute top-3 right-12 rounded-md border border-(--color-border) bg-(--color-bg) p-1 text-(--color-muted) opacity-100 transition-opacity hover:text-(--color-fg) sm:opacity-0 sm:group-hover:opacity-100"
                    title="复制这本书"
                  >
                    {copyingId === b.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteBook(b.id, b.title);
                    }}
                    disabled={deletingId === b.id}
                    className="absolute top-3 right-3 rounded-md border border-(--color-border) bg-(--color-bg) p-1 text-(--color-muted) opacity-100 transition-opacity hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                    title="删除这本书"
                    aria-label={`删除 ${b.title}`}
                  >
                    {deletingId === b.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </>
              )}
            </div>
            );
          })}
          {books.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-(--color-muted)">
                <PenLine className="mx-auto mb-2 h-5 w-5 opacity-60" />
                还没有书。在上面写一段想法 → 进入立项 chat。
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}

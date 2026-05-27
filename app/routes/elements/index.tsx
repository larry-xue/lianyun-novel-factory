import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

const CATEGORY_ORDER = ['世界设定', '主角设定', '桥段', '金手指', '基调'];
import {
  createElementFn,
  deleteElementFn,
  fetchElementsFn,
} from '~/server/fns/elements';
import { useMe } from '~/lib/auth-client';

export const Route = createFileRoute('/elements/')({
  component: ElementsList,
  loader: async () => fetchElementsFn({ data: undefined }),
});

function ElementsList() {
  const elements = Route.useLoaderData();
  const router = useRouter();
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    slug: '',
    zh: '',
    category: '',
    hotScore: '0.5',
    definitionMd: '',
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? elements.filter(
          (e) => e.zh.includes(search) || e.slug.includes(q) || e.category.includes(search),
        )
      : elements;
    const byCategory = new Map<string, typeof filtered>();
    for (const e of filtered) {
      const list = byCategory.get(e.category) ?? [];
      list.push(e);
      byCategory.set(e.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => b.hotScore - a.hotScore);
    }
    const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const unknown = [...byCategory.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort();
    return [...known, ...unknown].map(
      (c) => [c, byCategory.get(c)!] as const,
    );
  }, [elements, search]);

  const toggleCollapsed = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const collapseAll = () => setCollapsed(new Set(groups.map(([c]) => c)));
  const expandAll = () => setCollapsed(new Set());
  const searching = search.trim().length > 0;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErr(null);
    setCreating(true);
    try {
      const created = await createElementFn({
        data: {
          slug: draft.slug.trim(),
          zh: draft.zh.trim(),
          category: draft.category.trim(),
          hotScore: Number(draft.hotScore),
          definitionMd: draft.definitionMd,
        },
      });
      router.navigate({ to: '/elements/$id', params: { id: created.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, zh: string) {
    if (!confirm(`确认删除元素「${zh}」？`)) return;
    setDeletingId(id);
    try {
      await deleteElementFn({ data: { id } });
      router.invalidate();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">元素词典</h1>
          <p className="mt-1 text-sm text-(--color-muted)">
            选题冷启动的关键词原子。共 {elements.length} 条。
          </p>
        </div>
      </header>

      {isAdmin && (
      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="mr-2 inline h-4 w-4" />
            手动新建元素
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-6" onSubmit={handleCreate}>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor="new-zh">中文名</Label>
              <Input
                id="new-zh"
                value={draft.zh}
                onChange={(e) => setDraft((d) => ({ ...d, zh: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor="new-slug">slug</Label>
              <Input
                id="new-slug"
                placeholder="urban-rebirth"
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-1">
              <Label htmlFor="new-category">分类</Label>
              <Input
                id="new-category"
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-1">
              <Label htmlFor="new-hot">热度</Label>
              <Input
                id="new-hot"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={draft.hotScore}
                onChange={(e) => setDraft((d) => ({ ...d, hotScore: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-6">
              <Label htmlFor="new-definition">定义（Markdown，可先空着）</Label>
              <Textarea
                id="new-definition"
                rows={5}
                value={draft.definitionMd}
                onChange={(e) => setDraft((d) => ({ ...d, definitionMd: e.target.value }))}
              />
            </div>
            {err && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 md:col-span-6">
                {err}
              </div>
            )}
            <div className="flex justify-end md:col-span-6">
              <Button
                type="submit"
                variant="accent"
                disabled={creating || !draft.slug || !draft.zh || !draft.category}
              >
                <Plus className="h-4 w-4" />
                {creating ? '创建中…' : '创建并编辑'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="relative w-full sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-(--color-muted)" />
            <Input
              className="pl-8"
              placeholder="搜索 中文 / slug / 分类"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={expandAll}>展开全部</Button>
            <Button variant="ghost" size="sm" onClick={collapseAll}>收起全部</Button>
          </div>
        </div>

        {groups.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              没有匹配的元素。
            </CardContent>
          </Card>
        )}

        {groups.map(([category, items]) => {
          const isCollapsed = !searching && collapsed.has(category);
          return (
            <div key={category} className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => toggleCollapsed(category)}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-(--color-surface)"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-(--color-muted)" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-(--color-muted)" />
                )}
                <span className="text-sm font-semibold">{category}</span>
                <span className="text-xs text-(--color-muted)">{items.length} 条</span>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((e) => (
                    <Card
                      key={e.id}
                      className="transition-colors hover:border-(--color-accent)/50"
                    >
                      <CardContent className="flex h-full flex-col gap-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            to="/elements/$id"
                            params={{ id: e.id }}
                            className="min-w-0 flex-1 hover:underline"
                          >
                            <span className="block truncate text-base font-semibold">{e.zh}</span>
                          </Link>
                          <span className="shrink-0 text-[10px] text-(--color-muted)">
                            hot {e.hotScore.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 text-xs text-(--color-muted)">
                          <code className="truncate rounded bg-(--color-bg) px-1 py-0.5">{e.slug}</code>
                        </div>
                        <p className="line-clamp-2 flex-1 text-xs text-(--color-muted)">
                          {e.definitionMd.split('\n').find((l) => l.trim() && !l.startsWith('#')) ??
                            '（暂无定义）'}
                        </p>
                        <div className="flex justify-between gap-2 pt-1">
                          <Button asChild variant="outline" size="sm">
                            <Link to="/elements/$id" params={{ id: e.id }}>
                              {isAdmin ? '手动修改' : '查看详情'}
                            </Link>
                          </Button>
                          {isAdmin && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`删除 ${e.zh}`}
                              disabled={deletingId === e.id}
                              onClick={() => handleDelete(e.id, e.zh)}
                              className="text-(--color-muted) hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

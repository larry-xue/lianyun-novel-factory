import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, Eye, History, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { MarkdownView } from '~/components/markdown-view';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { deleteDocFn, fetchDocFn, saveDocFn } from '~/server/fns/book-docs';

export const Route = createFileRoute('/books/$bookId/files/$kind/$')({
  component: DocEditorRoute,
  loader: async ({ params }) => {
    const slug = params._splat ?? '';
    const r = await fetchDocFn({
      data: { bookId: params.bookId, kind: params.kind, slug },
    });
    return {
      bookId: params.bookId,
      kind: params.kind,
      slug,
      doc: r?.doc ?? null,
      revisions: r?.revisions ?? [],
    };
  },
});

function DocEditorRoute() {
  const { kind, slug } = Route.useLoaderData();
  return <DocEditor key={`${kind}/${slug}`} />;
}

function DocEditor() {
  const { bookId, kind, slug, doc, revisions } = Route.useLoaderData();
  const router = useRouter();

  const [title, setTitle] = useState(doc?.title ?? '');
  const [contentMd, setContentMd] = useState(doc?.contentMd ?? '');
  const [reasonMd, setReasonMd] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');

  const dirty = doc ? title !== doc.title || contentMd !== doc.contentMd : false;

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await saveDocFn({
        data: { bookId, kind, slug, title, contentMd, reasonMd: reasonMd || undefined },
      });
      router.invalidate();
      setReasonMd('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!doc) return;
    if (!confirm(`真的删除 ${doc.kind}/${doc.slug}.md 吗？此操作不可恢复。`)) return;
    setErr(null);
    try {
      await deleteDocFn({ data: { id: doc.id } });
      router.navigate({ to: '/books/$bookId/files', params: { bookId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!doc) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm text-(--color-muted)">
          没找到 <code className="rounded bg-(--color-bg) px-1">{kind}/{slug}.md</code>
        </p>
        <Link
          to="/books/$bookId/files"
          params={{ bookId }}
          className="inline-flex items-center gap-1 text-xs text-(--color-muted) hover:text-(--color-fg) self-start"
        >
          <ArrowLeft className="h-3 w-3" /> 回文件树
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] text-(--color-muted) font-mono">
            {kind}/{slug}.md
          </p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight truncate">{doc.title}</h1>
        </div>
        <span className="shrink-0 text-[10px] text-(--color-muted)">
          v{doc.version} · {doc.lastEditedBy} · {new Date(doc.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">正文</Label>
              <div className="flex items-center gap-1">
                <Button
                  variant={mode === 'preview' ? 'accent' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setMode('preview')}
                >
                  <Eye className="h-3 w-3" />
                  预览
                </Button>
                <Button
                  variant={mode === 'edit' ? 'accent' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setMode('edit')}
                >
                  <Pencil className="h-3 w-3" />
                  编辑
                </Button>
              </div>
            </div>
            {mode === 'edit' ? (
              <>
                <Textarea
                  rows={28}
                  value={contentMd}
                  onChange={(e) => setContentMd(e.target.value)}
                  className="font-mono text-xs"
                />
                <span className="text-[10px] text-(--color-muted)">
                  {contentMd.length} 字符 · {contentMd.split('\n').length} 行
                </span>
              </>
            ) : (
              <Card>
                <CardContent className="prose prose-sm dark:prose-invert max-w-none p-4 text-xs leading-relaxed">
                  <MarkdownView>{contentMd || '（空文档）'}</MarkdownView>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">改动原因（可选，会进 revision）</Label>
            <Input
              value={reasonMd}
              placeholder="如：补充第 3 章新揭露的地理信息"
              onChange={(e) => setReasonMd(e.target.value)}
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              删除
            </Button>
            <Button variant="accent" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {dirty ? '保存（写新版本）' : '无改动'}
            </Button>
          </div>
        </div>

        <aside className="flex flex-col gap-2">
          <Card>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-(--color-muted)">
                <History className="h-3 w-3" /> 版本历史（{revisions.length}）
              </div>
              <div className="flex flex-col gap-1.5 text-[11px]">
                {revisions.map((r) => (
                  <div
                    key={r.version}
                    className="flex items-baseline justify-between rounded border border-(--color-border) px-2 py-1"
                  >
                    <span className="font-mono text-(--color-fg)">v{r.version}</span>
                    <span className="text-(--color-muted)">{r.editedBy}</span>
                    <span className="text-[9px] text-(--color-muted)">
                      {new Date(r.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

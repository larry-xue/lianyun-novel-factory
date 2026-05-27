import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  createAntiPatternFn,
  deleteAntiPatternFn,
  listAntiPatternsFn,
} from '~/server/fns/anti-patterns';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

export const Route = createFileRoute('/anti-patterns/')({
  beforeLoad: requireAdminBeforeLoad,
  component: AntiPatternsList,
  loader: async () => listAntiPatternsFn({ data: undefined }),
});

function AntiPatternsList() {
  const rows = Route.useLoaderData();
  const router = useRouter();

  const [kind, setKind] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    setBusy(true);
    try {
      await createAntiPatternFn({ data: { kind, contentMd } });
      setKind('');
      setContentMd('');
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('删除这条反例？')) return;
    await deleteAntiPatternFn({ data: { id } });
    router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">反例库</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          扑街/翻车/踩雷的 negative few-shot 素材。共 {rows.length} 条。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="mr-2 inline h-4 w-4" />
            添加反例
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>类型（如 opening-too-slow / dialogue-stiff / world-rule-break）</Label>
            <Input value={kind} onChange={(e) => setKind(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>反例正文 + 为什么扑街</Label>
            <Textarea
              rows={6}
              value={contentMd}
              onChange={(e) => setContentMd(e.target.value)}
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              variant="accent"
              onClick={add}
              disabled={busy || !kind || contentMd.length < 8}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              添加
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {rows.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-col gap-1.5 p-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted)">
                  {a.kind}
                </span>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className="text-[11px] text-(--color-muted) hover:text-red-600"
                >
                  删除
                </button>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                {a.contentMd}
              </pre>
              <div className="text-[10px] text-(--color-muted)">
                {new Date(a.createdAt).toLocaleString('zh-CN')}
                {a.sourceRunId && ' · 来自 run'}
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              还没有反例。
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { createHookFn, deleteHookFn, listHooksFn } from '~/server/fns/hooks';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

const KIND_LABEL: Record<string, string> = {
  open: '开篇',
  close: '章末',
  cliff: '悬念升级',
  reveal: '信息差揭穿',
};

export const Route = createFileRoute('/hooks/')({
  beforeLoad: requireAdminBeforeLoad,
  component: HooksList,
  loader: async () => listHooksFn({ data: undefined }),
});

function HooksList() {
  const hooks = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'open' | 'close' | 'cliff' | 'reveal'>('open');
  const [templateMd, setTemplateMd] = useState('');
  const [scenarios, setScenarios] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    setBusy(true);
    try {
      await createHookFn({
        data: {
          name,
          kind,
          templateMd,
          scenarios: scenarios.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        },
      });
      setName('');
      setTemplateMd('');
      setScenarios('');
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('删除这条 hook？')) return;
    await deleteHookFn({ data: { id } });
    router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hook 模板</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          开篇/章末/悬念升级/信息差揭穿。共 {hooks.length} 条。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="mr-2 inline h-4 w-4" />
            新增 hook
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>类型</Label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-card) px-2 text-sm"
            >
              <option value="open">开篇</option>
              <option value="close">章末</option>
              <option value="cliff">悬念升级</option>
              <option value="reveal">信息差揭穿</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>适配场景（标签，逗号分隔）</Label>
            <Input
              placeholder="末世, 系统流, 都市重生"
              value={scenarios}
              onChange={(e) => setScenarios(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>模板（templateMd）</Label>
            <Textarea
              rows={6}
              placeholder="> 例：主角在 X 时空背景下，被一段不属于自己的记忆突然刺中…"
              value={templateMd}
              onChange={(e) => setTemplateMd(e.target.value)}
            />
          </div>
          {err && (
            <div className="md:col-span-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="md:col-span-2 flex justify-end">
            <Button variant="accent" onClick={add} disabled={busy || !name || templateMd.length < 8}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              添加
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {hooks.map((h) => (
          <Card key={h.id}>
            <CardContent className="flex flex-col gap-1.5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {h.name}
                  <span className="ml-2 rounded-full border border-(--color-border) px-1.5 py-0.5 text-[10px] text-(--color-muted)">
                    {KIND_LABEL[h.kind] ?? h.kind}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => remove(h.id)}
                  className="text-[11px] text-(--color-muted) hover:text-red-600"
                >
                  删除
                </button>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-(--color-bg) p-2 text-[11px]">
                {h.templateMd}
              </pre>
              {h.scenarios.length > 0 && (
                <div className="flex flex-wrap gap-1 text-[10px] text-(--color-muted)">
                  {h.scenarios.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-(--color-border) px-1.5 py-0.5"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {hooks.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              还没有 hook 模板。
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

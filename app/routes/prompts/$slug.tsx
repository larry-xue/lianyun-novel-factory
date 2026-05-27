import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, History, Loader2, RotateCcw, Save } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { fetchPromptFn, rollbackPromptFn, savePromptFn } from '~/server/fns/prompts';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

export const Route = createFileRoute('/prompts/$slug')({
  beforeLoad: requireAdminBeforeLoad,
  component: PromptEditor,
  loader: async ({ params }) => {
    const r = await fetchPromptFn({ data: { slug: params.slug } });
    return { slug: params.slug, prompt: r?.prompt ?? null, revisions: r?.revisions ?? [] };
  },
});

function PromptEditor() {
  const { slug, prompt, revisions } = Route.useLoaderData();
  const router = useRouter();

  const [title, setTitle] = useState(prompt?.title ?? '');
  const [templateMd, setTemplateMd] = useState(prompt?.templateMd ?? '');
  const [reasonMd, setReasonMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = prompt ? title !== prompt.title || templateMd !== prompt.templateMd : false;

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await savePromptFn({
        data: { slug, title, templateMd, reasonMd: reasonMd || undefined },
      });
      setReasonMd('');
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(toVersion: number) {
    if (!confirm(`回滚到 v${toVersion}？会写一条新版（v${(prompt?.version ?? 1) + 1}）。`)) return;
    setErr(null);
    setBusy(true);
    try {
      await rollbackPromptFn({ data: { slug, toVersion } });
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!prompt) {
    return (
      <div className="flex flex-col gap-3">
        <Link to="/prompts" className="text-sm text-(--color-muted)">
          <ArrowLeft className="mr-1 inline h-4 w-4" /> Prompt 仓
        </Link>
        <p className="text-sm text-(--color-muted)">
          没找到 prompt <code className="rounded bg-(--color-bg) px-1">{slug}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link to="/prompts" className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)">
          <ArrowLeft className="h-4 w-4" /> Prompt 仓
        </Link>
        <span className="text-[10px] text-(--color-muted)">
          v{prompt.version} · agent={prompt.agentId} · role={prompt.role}
        </span>
      </div>

      <header>
        <p className="text-[10px] text-(--color-muted)">
          <code>{slug}</code>
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{prompt.title}</h1>
        {prompt.notesMd && (
          <p className="mt-1 text-xs text-(--color-muted)">{prompt.notesMd}</p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              模板（含 {`{{var}}`} 占位符；TS 端 renderPrompt(slug, vars) 注入）
            </Label>
            <Textarea
              rows={32}
              value={templateMd}
              onChange={(e) => setTemplateMd(e.target.value)}
              className="font-mono text-xs"
            />
            <span className="text-[10px] text-(--color-muted)">
              {templateMd.length} 字符 · {templateMd.split('\n').length} 行
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">改动原因（可选，进 revision 历史）</Label>
            <Input
              value={reasonMd}
              placeholder="如：钩子节奏说明改成更具体的字数区间"
              onChange={(e) => setReasonMd(e.target.value)}
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="accent" onClick={save} disabled={!dirty || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
                {revisions
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div
                      key={r.version}
                      className="flex items-center justify-between gap-1 rounded border border-(--color-border) px-2 py-1"
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-(--color-fg)">v{r.version}</span>
                        <span className="text-[9px] text-(--color-muted)">
                          {r.editedBy} · {new Date(r.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {r.version !== prompt.version && (
                        <button
                          type="button"
                          onClick={() => rollback(r.version)}
                          disabled={busy}
                          className="text-[10px] text-(--color-accent) hover:underline"
                        >
                          <RotateCcw className="mr-0.5 inline h-2.5 w-2.5" />
                          回滚
                        </button>
                      )}
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

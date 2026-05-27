import { createFileRoute, Link } from '@tanstack/react-router';
import { FileCode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { listPromptsFn } from '~/server/fns/prompts';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

export const Route = createFileRoute('/prompts/')({
  beforeLoad: requireAdminBeforeLoad,
  component: PromptsList,
  loader: async () => ({ prompts: await listPromptsFn({ data: undefined }) }),
});

function PromptsList() {
  const { prompts } = Route.useLoaderData();
  const byAgent = new Map<string, typeof prompts>();
  for (const p of prompts) {
    const arr = byAgent.get(p.agentId) ?? [];
    arr.push(p);
    byAgent.set(p.agentId, arr);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Prompt 仓</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          所有 agent 的模板：可看 / 可改 / 可回滚。改完保存即生效（loadPrompt(slug) 实时取最新版）。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3">
        {[...byAgent.entries()].map(([agentId, list]) => (
          <Card key={agentId}>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm">
                <FileCode className="mr-1.5 inline h-3.5 w-3.5 text-(--color-muted)" />
                {agentId}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 p-3 pt-0">
              {list.map((p) => (
                <Link
                  key={p.slug}
                  to="/prompts/$slug"
                  params={{ slug: p.slug }}
                  className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-(--color-surface)"
                >
                  <span className="flex items-center gap-2">
                    <code className="text-(--color-fg)">{p.slug}</code>
                    <span className="text-(--color-muted)">·</span>
                    <span className="text-(--color-muted)">{p.title}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-(--color-muted)">
                    <span className="rounded-full border border-(--color-border) px-1.5 py-0.5">
                      {p.role}
                    </span>
                    <span>v{p.version}</span>
                    <span>{p.isActive ? '✓' : '○'}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
        {prompts.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              prompts 表为空。跑 <code>pnpm tsx scripts/seed-prompts.ts</code> seed 现有 agent 模板。
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

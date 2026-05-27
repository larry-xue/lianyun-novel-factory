import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Loader2, PlayCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { enqueueBatchFn, listBatchesFn } from '~/server/fns/batches';
import { fetchElementsFn } from '~/server/fns/elements';

interface JobDraft {
  topicTitle: string;
  pitch: string;
  elementSlugs: string[];
}

export const Route = createFileRoute('/batches/')({
  component: BatchesList,
  loader: async () => {
    const [batches, elements] = await Promise.all([
      listBatchesFn({ data: undefined }),
      fetchElementsFn({ data: undefined }),
    ]);
    return { batches, elements };
  },
});

function BatchesList() {
  const { batches, elements } = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [killThreshold, setKillThreshold] = useState(2200);
  const [jobs, setJobs] = useState<JobDraft[]>([
    { topicTitle: '', pitch: '', elementSlugs: [] },
  ]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addJob() {
    setJobs((j) => [...j, { topicTitle: '', pitch: '', elementSlugs: [] }]);
  }
  function removeJob(idx: number) {
    setJobs((j) => j.filter((_, i) => i !== idx));
  }
  function updateJob(idx: number, patch: Partial<JobDraft>) {
    setJobs((j) => j.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }
  function toggleSlug(idx: number, slug: string) {
    updateJob(idx, {
      elementSlugs: jobs[idx]!.elementSlugs.includes(slug)
        ? jobs[idx]!.elementSlugs.filter((x) => x !== slug)
        : [...jobs[idx]!.elementSlugs, slug],
    });
  }

  async function start() {
    setErr(null);
    setRunning(true);
    try {
      const r = await enqueueBatchFn({
        data: {
          name,
          concurrency,
          earlyKillBelowChars: killThreshold,
          jobs,
        },
      });
      router.navigate({ to: '/batches/$id', params: { id: r.batchId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const canSubmit =
    name.length >= 2 &&
    jobs.length > 0 &&
    jobs.every(
      (j) => j.topicTitle.length >= 2 && j.pitch.length >= 10 && j.elementSlugs.length > 0,
    );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">铺量批次</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          一次扔 N 个选题进 pg-boss，差选题首章字数不达标自动 kill。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>新建批次</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1 md:col-span-1">
              <Label>批次名</Label>
              <Input
                value={name}
                placeholder="2026-W18 末世铺量"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>
                并发
                <span className="ml-1 text-[9px] font-normal text-(--color-muted)">
                  （记录值；实际由 BATCH_CONCURRENCY env 控制）
                </span>
              </Label>
              <Input
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>首章 kill 阈值（字）</Label>
              <Input
                type="number"
                min={0}
                max={6000}
                step={100}
                value={killThreshold}
                onChange={(e) => setKillThreshold(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {jobs.map((j, i) => (
              <Card key={i} className="border-dashed">
                <CardContent className="flex flex-col gap-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-(--color-muted)">选题 #{i + 1}</span>
                    {jobs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeJob(i)}
                        className="text-(--color-muted) hover:text-red-600"
                        aria-label="删除选题"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="选题名"
                    value={j.topicTitle}
                    onChange={(e) => updateJob(i, { topicTitle: e.target.value })}
                  />
                  <Textarea
                    rows={2}
                    placeholder="pitch（一句话主推）"
                    value={j.pitch}
                    onChange={(e) => updateJob(i, { pitch: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-1">
                    {elements.map((el) => {
                      const on = j.elementSlugs.includes(el.slug);
                      return (
                        <button
                          key={el.id}
                          type="button"
                          onClick={() => toggleSlug(i, el.slug)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                            on
                              ? 'border-(--color-accent) bg-(--color-accent) text-white'
                              : 'border-(--color-border) text-(--color-muted) hover:border-(--color-fg)'
                          }`}
                        >
                          {el.zh}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" onClick={addJob}>
              <Plus className="h-4 w-4" /> 加一个选题
            </Button>
          </div>

          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="accent" onClick={start} disabled={running || !canSubmit}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {running ? '入队中…' : `入队 ${jobs.length} 个选题`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wide text-(--color-muted)">最近批次</h2>
        <div className="flex flex-col gap-2">
          {batches.map((b) => (
            <Link key={b.id} to="/batches/$id" params={{ id: b.id }}>
              <Card className="transition-colors hover:border-(--color-accent)/50">
                <CardContent className="flex items-center gap-3 p-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-[10px] text-(--color-muted)">
                      并发 {b.concurrency} · 总 {b.jobsTotal} ·{' '}
                      <span className="text-emerald-600">完成 {b.jobsCompleted}</span> ·{' '}
                      <span className="text-amber-600">淘汰 {b.jobsKilled}</span> ·{' '}
                      <span className="text-red-600">失败 {b.jobsFailed}</span>
                    </div>
                  </div>
                  <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted)">
                    {b.status}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
          {batches.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-(--color-muted)">
                还没有批次。
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}

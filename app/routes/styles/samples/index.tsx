import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { FileUp, Loader2, Plus } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  createStyleSampleFn,
  deleteStyleSampleFn,
  listStyleSamplesFn,
} from '~/server/fns/style-samples';
import { requireAdminBeforeLoad } from '~/lib/auth-client';
import { parseNovelTxt } from '~/lib/novel-txt-import';

export const Route = createFileRoute('/styles/samples/')({
  beforeLoad: requireAdminBeforeLoad,
  component: SamplesList,
  loader: async () => listStyleSamplesFn({ data: undefined }),
});

function SamplesList() {
  const samples = Route.useLoaderData();
  const router = useRouter();

  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function importTxt(file: File) {
    setImportErr(null);
    setImportInfo(null);
    if (!/\.txt$/i.test(file.name)) {
      setImportErr('请选择 TXT 文件');
      return;
    }
    try {
      const content = await file.text();
      const r = parseNovelTxt(content, file.name);
      setAuthor(r.author);
      setTitle(r.title);
      setTags(r.tags.join(', '));
      setContentMd(r.contentMd);
      setSourceUrl(r.sourceUrl ?? '');
      setImportInfo(
        r.meta.chapterCount
          ? `已解析 ${r.meta.chapterCount} 章（${r.contentMd.length.toLocaleString()} 字），请确认后点击"添加"`
          : `已读取 ${r.contentMd.length.toLocaleString()} 字，请确认后点击"添加"`,
      );
    } catch (e) {
      setImportErr(`解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function add() {
    setErr(null);
    setBusy(true);
    try {
      await createStyleSampleFn({
        data: {
          author,
          title,
          tags: tags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
          contentMd,
          sourceUrl: sourceUrl || undefined,
        },
      });
      setAuthor('');
      setTitle('');
      setTags('');
      setContentMd('');
      setSourceUrl('');
      setImportInfo(null);
      setImportErr(null);
      router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('删除这条范文？')) return;
    await deleteStyleSampleFn({ data: { id } });
    router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">范文库</h1>
        <p className="mt-1 text-sm text-(--color-muted)">
          蒸馏指纹的素材源。共 {samples.length} 篇。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="mr-2 inline h-4 w-4" />
            添加范文
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2 flex flex-col gap-1 rounded-md border border-dashed border-(--color-border) bg-(--color-muted-bg)/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileUp className="h-4 w-4" />
                导入 Novel TXT
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                选择文件
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importTxt(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="text-[11px] text-(--color-muted)">
              选择你拥有版权或已获授权处理的本地 TXT 文件，自动解析作者/书名/章节并预填下方表单；不会自动入库。
            </div>
            {importInfo && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                {importInfo}
              </div>
            )}
            {importErr && (
              <div className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                {importErr}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label>作者</Label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>书名/篇名</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>标签（逗号或空格分隔）</Label>
            <Input
              placeholder="末世, 系统流, 第三人称限知"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>来源 URL（可空）</Label>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>正文（contentMd，至少 40 字）</Label>
            <Textarea
              rows={8}
              value={contentMd}
              onChange={(e) => setContentMd(e.target.value)}
            />
          </div>
          {err && (
            <div className="md:col-span-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <div className="md:col-span-2 flex justify-end">
            <Button
              variant="accent"
              onClick={add}
              disabled={busy || !author || !title || contentMd.length < 40}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              添加
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wide text-(--color-muted)">已收录</h2>
        {samples.map((s) => (
          <Card key={s.id}>
            <CardContent className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {s.author} —《{s.title}》
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-(--color-muted)">
                  {s.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-(--color-border) px-1.5 py-0.5"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 text-[10px] text-(--color-muted)">
                  {new Date(s.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="text-[11px] text-(--color-muted) hover:text-red-600"
              >
                删除
              </button>
            </CardContent>
          </Card>
        ))}
        {samples.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-(--color-muted)">
              范文库还没素材。
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

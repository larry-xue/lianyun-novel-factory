import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, Eye, Pencil, Save, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { MarkdownView } from '~/components/markdown-view';
import {
  deleteElementFn,
  fetchElementFn,
  refineElementFn,
  updateElementFn,
} from '~/server/fns/elements';
import { useMe } from '~/lib/auth-client';

export const Route = createFileRoute('/elements/$id')({
  component: ElementDetail,
  loader: async ({ params }) => fetchElementFn({ data: { id: params.id } }),
});

function ElementDetail() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const [zh, setZh] = useState(initial.zh);
  const [slug, setSlug] = useState(initial.slug);
  const [category, setCategory] = useState(initial.category);
  const [hotScore, setHotScore] = useState(initial.hotScore);
  const [comboFriendly, setComboFriendly] = useState(initial.comboFriendly.join(', '));
  const [comboAvoid, setComboAvoid] = useState(initial.comboAvoid.join(', '));
  const [definitionMd, setDefinitionMd] = useState(initial.definitionMd);
  const [defMode, setDefMode] = useState<'preview' | 'edit'>('preview');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineErr, setRefineErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    try {
      await updateElementFn({
        data: {
          id: initial.id,
          patch: {
            zh,
            slug,
            category,
            hotScore,
            comboFriendly: comboFriendly
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            comboAvoid: comboAvoid
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            definitionMd,
          },
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
      router.invalidate();
    } finally {
      setSaving(false);
    }
  }

  async function handleRefine() {
    setRefineErr(null);
    setRefining(true);
    try {
      const hint = prompt('给 AI 一个补齐方向（可空）', '');
      const draft = await refineElementFn({
        data: { slug, zh, category, hint: hint ?? undefined },
      });
      setSlug(draft.slug);
      setZh(draft.zh);
      setCategory(draft.category);
      setHotScore(draft.hotScore);
      setComboFriendly(draft.comboFriendly.join(', '));
      setComboAvoid(draft.comboAvoid.join(', '));
      setDefinitionMd(draft.definitionMd);
    } catch (err) {
      setRefineErr(err instanceof Error ? err.message : String(err));
    } finally {
      setRefining(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`确认删除元素「${initial.zh}」？`)) return;
    await deleteElementFn({ data: { id: initial.id } });
    router.navigate({ to: '/elements' });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/elements"
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> 返回列表
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {savedAt && (
            <span className="text-xs text-(--color-muted)">已保存 {savedAt}</span>
          )}
          {isAdmin ? (
            <>
              <Button variant="outline" onClick={handleRefine} disabled={refining}>
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">{refining ? 'AI 补齐中…' : 'AI 补齐'}</span>
              </Button>
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">删除</span>
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">保存</span>
              </Button>
            </>
          ) : (
            <span className="text-xs text-(--color-muted)">只读 · 仅管理员可编辑</span>
          )}
        </div>
      </div>

      {refineErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          AI 补齐失败：{refineErr}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>基础信息</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="zh">中文名</Label>
            <Input id="zh" value={zh} readOnly={!isAdmin} onChange={(e) => setZh(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="slug">slug</Label>
            <Input id="slug" value={slug} readOnly={!isAdmin} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="category">分类</Label>
            <Input
              id="category"
              value={category}
              readOnly={!isAdmin}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hot">热度（0-1）</Label>
            <Input
              id="hot"
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={hotScore}
              readOnly={!isAdmin}
              onChange={(e) => setHotScore(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="cf">兼容元素（slug 逗号分隔）</Label>
            <Input
              id="cf"
              value={comboFriendly}
              readOnly={!isAdmin}
              onChange={(e) => setComboFriendly(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="ca">冲突元素（slug 逗号分隔）</Label>
            <Input
              id="ca"
              value={comboAvoid}
              readOnly={!isAdmin}
              onChange={(e) => setComboAvoid(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>定义（Markdown）</CardTitle>
          {isAdmin && (
            <div className="flex items-center gap-1">
              <Button
                variant={defMode === 'preview' ? 'accent' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setDefMode('preview')}
              >
                <Eye className="h-3 w-3" />
                预览
              </Button>
              <Button
                variant={defMode === 'edit' ? 'accent' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setDefMode('edit')}
              >
                <Pencil className="h-3 w-3" />
                编辑
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isAdmin && defMode === 'edit' ? (
            <>
              <Textarea
                rows={20}
                className="min-h-96 font-mono text-xs"
                value={definitionMd}
                onChange={(e) => setDefinitionMd(e.target.value)}
              />
              <span className="mt-1 block text-[10px] text-(--color-muted)">
                {definitionMd.length} 字符 · {definitionMd.split('\n').length} 行
              </span>
            </>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
              <MarkdownView>{definitionMd || '（暂无定义）'}</MarkdownView>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

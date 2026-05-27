import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Bot,
  FileCode,
  Loader2,
  Save,
  Server,
  Zap,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { PageHeader, PageShell, SectionHeader, SelectControl } from '~/components/ui/page';
import { fetchSettingsFn, saveLlmConfigFn, saveProduceDefaultsFn } from '~/server/fns/settings';
import { useRouter } from '@tanstack/react-router';
import { requireAdminBeforeLoad } from '~/lib/auth-client';

const AGENTS = [
  { id: 'topic-scout', name: '选题侦察', promptSlug: 'topic-scout.system' },
  { id: 'story-designer', name: '故事设计师', promptSlug: 'story-designer.system' },
  { id: 'chapter-planner', name: '章节策划师 (milestone)', promptSlug: 'chapter-planner.system' },
  { id: 'chapter-writer', name: '章节写手 (legacy 单 turn)', promptSlug: 'chapter-writer.system' },
  { id: 'chapter-writer-harness', name: '章节写手 (harness 主链路)', promptSlug: 'chapter-writer.harness.system' },
  { id: 'consistency-guard', name: '一致性守门员', promptSlug: 'consistency-guard.system' },
  { id: 'quality-linter', name: '质检员', promptSlug: 'quality-linter.system' },
  { id: 'living-doc-updater', name: '活文档维护员', promptSlug: 'living-doc-updater.system' },
  { id: 'element-curator', name: '元素词典管理员', promptSlug: null },
  { id: 'hook-smith', name: 'Hook 锻造', promptSlug: null },
  { id: 'arc-summarizer', name: 'Arc 摘要师', promptSlug: null },
  { id: 'book-summarizer', name: '整本摘要师', promptSlug: null },
  { id: 'plan-reviser', name: '大纲修订员', promptSlug: null },
] as const;

interface ProduceDefaults {
  totalChapters: number;
  charsPerChapter: number;
  gateMode: string;
  earlyKillBelowChars: number;
  maxGuardRetries: number;
  useHookSmith: boolean;
  arcSummaryEvery: number;
  planRevisionEvery: number;
  useChapterPlanner: boolean;
  plannerLookbackChapters: number;
}

const DEFAULTS: ProduceDefaults = {
  totalChapters: 1,
  charsPerChapter: 3000,
  gateMode: 'fully-auto',
  earlyKillBelowChars: 2200,
  maxGuardRetries: 1,
  useHookSmith: true,
  arcSummaryEvery: 20,
  planRevisionEvery: 0,
  useChapterPlanner: true,
  plannerLookbackChapters: 3,
};

export const Route = createFileRoute('/settings/')({
  beforeLoad: requireAdminBeforeLoad,
  component: SettingsPage,
  loader: async () => await fetchSettingsFn({ data: undefined }),
});

function SettingsPage() {
  const data = Route.useLoaderData();
  const router = useRouter();

  const [form, setForm] = useState<ProduceDefaults>(() => {
    const saved = data.produceDefaults;
    if (saved && Object.keys(saved).length > 0) {
      return { ...DEFAULTS, ...saved } as ProduceDefaults;
    }
    return DEFAULTS;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // LLM 配置表单
  const [llmForm, setLlmForm] = useState({
    endpoint: data.llm.endpoint,
    model: data.llm.model,
    apiKey: '',
  });
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmErr, setLlmErr] = useState<string | null>(null);
  const [llmSaved, setLlmSaved] = useState(false);

  function patch<K extends keyof ProduceDefaults>(key: K, value: ProduceDefaults[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setErr(null);
    setBusy(true);
    setSaved(false);
    try {
      await saveProduceDefaultsFn({ data: form });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveLlm() {
    setLlmErr(null);
    setLlmBusy(true);
    setLlmSaved(false);
    try {
      await saveLlmConfigFn({ data: llmForm });
      setLlmSaved(true);
      setLlmForm((f) => ({ ...f, apiKey: '' })); // 不保留明文在 form
      router.invalidate();
    } catch (e) {
      setLlmErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLlmBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="配置中心"
        description="查看平台运行配置和 LLM 环境变量，修改生产流水线默认参数。"
        eyebrow="系统设置"
      />

      {/* ── LLM 配置 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Server className="h-4 w-4 text-(--color-muted)" />
            LLM 配置
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${
                data.llm.source === 'db'
                  ? 'bg-emerald-100 text-emerald-700'
                  : data.llm.source === 'env'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              {data.llm.source === 'db'
                ? '数据库'
                : data.llm.source === 'env'
                  ? '.env 兜底'
                  : '未配置'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-(--color-muted)">
            db 配置优先；保存后立即生效，无需重启服务。{' '}
            <code>.env</code> 仅作为首次启动 / db 为空时的 fallback。
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">LLM_API_ENDPOINT</Label>
              <Input
                value={llmForm.endpoint}
                placeholder="https://api.deepseek.com"
                onChange={(e) => {
                  setLlmForm((f) => ({ ...f, endpoint: e.target.value }));
                  setLlmSaved(false);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">LLM_MODEL</Label>
              <Input
                value={llmForm.model}
                placeholder="deepseek-chat"
                onChange={(e) => {
                  setLlmForm((f) => ({ ...f, model: e.target.value }));
                  setLlmSaved(false);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">
                LLM_API_KEY{' '}
                <span className="font-normal text-(--color-muted)">
                  （留空 = 保留现值 {data.llm.keyMasked || '无'}）
                </span>
              </Label>
              <Input
                type="password"
                value={llmForm.apiKey}
                placeholder={data.llm.keyMasked || '尚未配置'}
                onChange={(e) => {
                  setLlmForm((f) => ({ ...f, apiKey: e.target.value }));
                  setLlmSaved(false);
                }}
              />
            </div>
          </div>
          {llmErr && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {llmErr}
            </div>
          )}
          {llmSaved && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              已保存，立即生效（本进程下一次 LLM 调用用新配置）
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="accent" onClick={saveLlm} disabled={llmBusy}>
              {llmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存 LLM 配置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 生产默认参数 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-(--color-muted)" />
            生产默认参数
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-(--color-muted)">
            新建书时的默认配置。可在每本书的 <code>produceBook</code> 调用中覆盖。
          </p>

          {/* 数值参数 */}
          <SectionHeader title="基础参数" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <NumField label="totalChapters" hint="目标章数 (1-5000)" value={form.totalChapters} min={1} max={5000} onChange={(v) => patch('totalChapters', v)} />
            <NumField label="charsPerChapter" hint="每章目标字数 (500-8000)" value={form.charsPerChapter} min={500} max={8000} onChange={(v) => patch('charsPerChapter', v)} />
            <NumField label="earlyKillBelowChars" hint="第1章低于此字数则 kill" value={form.earlyKillBelowChars} min={0} onChange={(v) => patch('earlyKillBelowChars', v)} />
            <NumField label="maxGuardRetries" hint="一致性 guard 最大重写次数 (0-3)" value={form.maxGuardRetries} min={0} max={3} onChange={(v) => patch('maxGuardRetries', v)} />
            <NumField label="arcSummaryEvery" hint="每 N 章触发弧总结 (0=关)" value={form.arcSummaryEvery} min={0} max={50} onChange={(v) => patch('arcSummaryEvery', v)} />
            <NumField label="planRevisionEvery" hint="每 N 章触发大纲修订 (0=关)" value={form.planRevisionEvery} min={0} max={20} onChange={(v) => patch('planRevisionEvery', v)} />
            <NumField label="plannerLookbackChapters" hint="章节策划回看章数 (1-10)" value={form.plannerLookbackChapters} min={1} max={10} onChange={(v) => patch('plannerLookbackChapters', v)} />
          </div>

          {/* 开关参数 */}
          <SectionHeader title="功能开关" className="mt-2" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ToggleField label="useHookSmith" hint="章末 Hook 强化" checked={form.useHookSmith} onChange={(v) => patch('useHookSmith', v)} />
            <ToggleField label="useChapterPlanner" hint="每章战术规划" checked={form.useChapterPlanner} onChange={(v) => patch('useChapterPlanner', v)} />
          </div>

          {/* gateMode */}
          <SectionHeader title="Gate 模式" className="mt-2" />
          <div className="max-w-xs">
            <SelectControl value={form.gateMode} onChange={(e) => patch('gateMode', e.target.value as ProduceDefaults['gateMode'])}>
              <option value="fully-auto">fully-auto（全自动，无暂停）</option>
              <option value="auto-with-confirm">auto-with-confirm（立项暂停确认）</option>
              <option value="manual">manual（全程手动确认）</option>
            </SelectControl>
          </div>

          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          {saved && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              已保存
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="accent" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存生产默认参数
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Agent 总览 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-(--color-muted)" />
            Agent 总览（{AGENTS.length}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border border-(--color-border) px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-(--color-fg)">{a.name}</span>
                  <code className="text-[10px] text-(--color-muted)">{a.id}</code>
                </div>
                {a.promptSlug ? (
                  <Link
                    to="/prompts/$slug"
                    params={{ slug: a.promptSlug }}
                    className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
                  >
                    <FileCode className="h-3 w-3" />
                    编辑 Prompt
                  </Link>
                ) : (
                  <span className="rounded-full bg-(--color-surface) px-2 py-0.5 text-[10px] text-(--color-muted)">
                    硬编码
                  </span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

/* ── 子组件 ── */

function NumField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] font-semibold">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="text-[10px] text-(--color-muted)">{hint}</span>
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-md border border-(--color-border) px-3 py-2 text-left transition-colors hover:border-(--color-accent)"
    >
      <div
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-(--color-accent)' : 'bg-(--color-border)'}`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-(--color-fg)">{label}</span>
        <span className="text-[10px] text-(--color-muted)">{hint}</span>
      </div>
    </button>
  );
}

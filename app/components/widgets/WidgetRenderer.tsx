import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import type { NegotiationWidget } from '~/server/db/schema/index';

/**
 * Generative-UI WidgetRenderer：仿 Claude Code AskUserQuestion 视觉。
 * agent 在 ask_user / confirm_topic 工具里指定 widget kind，前端按 kind
 * 渲染对应组件。submit 回调把用户答案转成"用户消息"喂回 agent。
 */
export interface WidgetSubmission {
  /** 把用户操作 serialize 成自然语言写到 user 消息里 */
  contentMd: string;
  /** 仅 confirm 类型用：表示用户点了"批准开书"还是"再聊聊" */
  confirmAction?: 'approve' | 'reject';
}

export interface WidgetRendererProps {
  widget: NegotiationWidget;
  /** 用户提交时回调 */
  onSubmit: (s: WidgetSubmission) => void | Promise<void>;
  /** 历史消息上的 widget 已被回答 → 锁定不可再交互 */
  locked?: boolean;
  /** 父组件正在 submit（提交后续 LLM call） */
  busy?: boolean;
}

export function WidgetRenderer({ widget, onSubmit, locked, busy }: WidgetRendererProps) {
  switch (widget.kind) {
    case 'multi-choice':
      return (
        <MultiChoiceWidget widget={widget} onSubmit={onSubmit} locked={locked} busy={busy} />
      );
    case 'multi-pick':
      return (
        <MultiPickWidget widget={widget} onSubmit={onSubmit} locked={locked} busy={busy} />
      );
    case 'free-text':
      return (
        <FreeTextWidget widget={widget} onSubmit={onSubmit} locked={locked} busy={busy} />
      );
    case 'confirm':
      return (
        <ConfirmWidget widget={widget} onSubmit={onSubmit} locked={locked} busy={busy} />
      );
  }
}

/* ─── 共通 chrome：header chip + question 行 ─── */

function WidgetFrame({
  header,
  question,
  children,
}: {
  header: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="rounded-full border border-(--color-accent) bg-(--color-accent)/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-(--color-accent)">
          {header}
        </span>
        <span className="text-sm font-medium">{question}</span>
      </div>
      {children}
    </div>
  );
}

/* ─── multi-choice：单选 2-4 项 ─── */

function MultiChoiceWidget({
  widget,
  onSubmit,
  locked,
  busy,
}: {
  widget: Extract<NegotiationWidget, { kind: 'multi-choice' }>;
  onSubmit: WidgetRendererProps['onSubmit'];
  locked?: boolean;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [otherText, setOtherText] = useState('');
  const [showOther, setShowOther] = useState(false);

  function submit(idx: number) {
    if (locked || busy) return;
    setPicked(idx);
    void onSubmit({
      contentMd: `[已选] ${widget.options[idx]!.label}`,
    });
  }

  function submitOther() {
    if (locked || busy || otherText.trim().length === 0) return;
    void onSubmit({ contentMd: `[其他] ${otherText.trim()}` });
  }

  return (
    <WidgetFrame header={widget.header} question={widget.question}>
      <div className="flex flex-col gap-1.5">
        {widget.options.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => submit(i)}
            disabled={locked || busy}
            className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
              picked === i
                ? 'border-(--color-accent) bg-(--color-accent)/10'
                : 'border-(--color-border) hover:border-(--color-accent)/60 hover:bg-(--color-accent)/5'
            } ${locked || busy ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <span className="font-medium">{o.label}</span>
            {o.description && (
              <span className="text-[11px] text-(--color-muted)">{o.description}</span>
            )}
          </button>
        ))}
        {!locked && (
          <>
            {!showOther ? (
              <button
                type="button"
                onClick={() => setShowOther(true)}
                disabled={busy}
                className="self-start text-[11px] text-(--color-muted) hover:text-(--color-fg)"
              >
                其他（自定义）→
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input
                  className="flex-1 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 text-xs"
                  placeholder="自定义答复…"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitOther();
                  }}
                  disabled={busy}
                />
                <Button size="sm" variant="accent" onClick={submitOther} disabled={busy}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '提交'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}

/* ─── multi-pick：多选 2-4 项 ─── */

function MultiPickWidget({
  widget,
  onSubmit,
  locked,
  busy,
}: {
  widget: Extract<NegotiationWidget, { kind: 'multi-pick' }>;
  onSubmit: WidgetRendererProps['onSubmit'];
  locked?: boolean;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set());

  function toggle(idx: number) {
    if (locked || busy) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function submit() {
    if (locked || busy || picked.size === 0) return;
    const labels = [...picked]
      .sort((a, b) => a - b)
      .map((i) => widget.options[i]!.label);
    void onSubmit({ contentMd: `[已选多个] ${labels.join('、')}` });
  }

  return (
    <WidgetFrame header={widget.header} question={widget.question}>
      <div className="flex flex-col gap-1.5">
        {widget.options.map((o, i) => {
          const on = picked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              disabled={locked || busy}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                on
                  ? 'border-(--color-accent) bg-(--color-accent)/10'
                  : 'border-(--color-border) hover:border-(--color-accent)/60 hover:bg-(--color-accent)/5'
              } ${locked || busy ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <span
                className={`mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm border ${
                  on ? 'border-(--color-accent) bg-(--color-accent)' : 'border-(--color-border)'
                }`}
              >
                {on && <Check className="h-3 w-3 text-white" />}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{o.label}</span>
                {o.description && (
                  <span className="text-[11px] text-(--color-muted)">{o.description}</span>
                )}
              </span>
            </button>
          );
        })}
        {!locked && (
          <Button
            size="sm"
            variant="accent"
            onClick={submit}
            disabled={busy || picked.size === 0}
            className="self-end"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            提交（{picked.size}）
          </Button>
        )}
      </div>
    </WidgetFrame>
  );
}

/* ─── free-text：开放文本输入 ─── */

function FreeTextWidget({
  widget,
  onSubmit,
  locked,
  busy,
}: {
  widget: Extract<NegotiationWidget, { kind: 'free-text' }>;
  onSubmit: WidgetRendererProps['onSubmit'];
  locked?: boolean;
  busy?: boolean;
}) {
  const [text, setText] = useState('');

  function submit() {
    if (locked || busy || text.trim().length === 0) return;
    void onSubmit({ contentMd: text.trim() });
  }

  return (
    <WidgetFrame header={widget.header} question={widget.question}>
      {locked ? (
        <p className="text-[11px] italic text-(--color-muted)">（已回答，见下方用户消息）</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={widget.placeholder ?? '在这里输入你的回复…'}
            disabled={busy}
          />
          <Button
            size="sm"
            variant="accent"
            onClick={submit}
            disabled={busy || text.trim().length === 0}
            className="self-end"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            提交
          </Button>
        </div>
      )}
    </WidgetFrame>
  );
}

/* ─── confirm：最终批准 / 拒绝 ─── */

function ConfirmWidget({
  widget,
  onSubmit,
  locked,
  busy,
}: {
  widget: Extract<NegotiationWidget, { kind: 'confirm' }>;
  onSubmit: WidgetRendererProps['onSubmit'];
  locked?: boolean;
  busy?: boolean;
}) {
  const [rejectText, setRejectText] = useState('');
  const [showReject, setShowReject] = useState(false);

  const approveLabel = widget.approveLabel ?? '批准开书';

  function approve() {
    if (locked || busy) return;
    void onSubmit({ contentMd: `[已批准] ${approveLabel}`, confirmAction: 'approve' });
  }
  function reject() {
    if (locked || busy || rejectText.trim().length === 0) return;
    void onSubmit({
      contentMd: `[再聊聊] ${rejectText.trim()}`,
      confirmAction: 'reject',
    });
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="rounded-full border border-amber-500 bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-800">
          {widget.header}
        </span>
        <span className="text-sm font-medium text-amber-900">最终批准</span>
      </div>
      <pre className="mb-3 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-relaxed">
        {widget.summaryMd}
      </pre>
      {locked ? (
        <p className="text-[11px] italic text-(--color-muted)">（已回应，见下方）</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="accent"
              onClick={approve}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {approveLabel}
            </Button>
            {!showReject ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowReject(true)}
                disabled={busy}
              >
                <X className="h-3 w-3" />
                再聊聊…
              </Button>
            ) : null}
          </div>
          {showReject && (
            <div className="flex gap-1.5">
              <Textarea
                rows={2}
                value={rejectText}
                onChange={(e) => setRejectText(e.target.value)}
                placeholder="哪里要改？scout 会基于反馈重做..."
                disabled={busy}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={reject}
                disabled={busy || rejectText.trim().length === 0}
              >
                提交
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

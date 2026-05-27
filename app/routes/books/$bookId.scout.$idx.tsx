import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Hourglass,
  Loader2,
  PenTool,
  Send,
  Sparkles,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Textarea } from '~/components/ui/textarea';
import { WidgetRenderer, type WidgetSubmission } from '~/components/widgets/WidgetRenderer';
import {
  agentRespondScoutFn,
  confirmChapterPlanFn,
  fetchScoutSessionFn,
  postScoutMessageFn,
} from '~/server/fns/chapter-scout';
import { useBookBusy } from '~/lib/use-book-busy';
import type { NegotiationAction, NegotiationWidget } from '~/server/db/schema/index';

export const Route = createFileRoute('/books/$bookId/scout/$idx')({
  component: ScoutRoute,
  loader: async ({ params }) => {
    const idx = Number(params.idx);
    if (!Number.isInteger(idx) || idx < 1) {
      throw new Error(`无效章节序号：${params.idx}`);
    }
    const { session } = await fetchScoutSessionFn({
      data: { bookId: params.bookId, chapterIdx: idx },
    });
    return { bookId: params.bookId, chapterIdx: idx, session };
  },
});

interface MessageView {
  role: string;
  contentMd: string;
  widget?: NegotiationWidget;
  beatDraft?: Record<string, unknown>;
  actions?: NegotiationAction[];
  ts: string;
  runId?: string;
}

function ScoutRoute() {
  const { bookId, chapterIdx, session: initialSession } = Route.useLoaderData();
  const router = useRouter();

  const [messages, setMessages] = useState<MessageView[]>(
    (initialSession?.messages as unknown as MessageView[]) ?? [],
  );
  const [decisions, setDecisions] = useState<Record<string, unknown>>(
    (initialSession?.decisions as Record<string, unknown>) ?? {},
  );
  const [status, setStatus] = useState(initialSession?.status ?? 'active');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = useBookBusy(bookId, { enabled: status === 'active' });
  const remoteAgentRunning = busy.brainstorm && !agentBusy && !sending;

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // 自动接话：如果是空会话或最后一条是 user，让 scout 推一轮。服务端 brainstorm 在跑就跳过。
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    if (status !== 'active') return;
    if (agentBusy || sending) return;
    if (busy.brainstorm || busy.loading) return;
    const last = messages[messages.length - 1];
    if (messages.length > 0 && (!last || last.role !== 'user')) return;
    autoTriggeredRef.current = true;
    if (messages.length === 0) {
      // 空会话：先打招呼，再让 scout 看看上下文
      void sendUserMessage(`帮我规划第 ${chapterIdx} 章。`);
    } else {
      void justAskAgent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy.brainstorm, busy.loading]);

  async function refresh() {
    const { session } = await fetchScoutSessionFn({
      data: { bookId, chapterIdx },
    });
    if (session) {
      setMessages(session.messages as unknown as MessageView[]);
      setDecisions((session.decisions as Record<string, unknown>) ?? {});
      setStatus(session.status);
    }
  }

  const latestActiveWidgetIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'agent' && m.widget) {
        const answered = messages.slice(i + 1).some((later) => later.role === 'user');
        return answered ? -1 : i;
      }
    }
    return -1;
  }, [messages]);

  async function sendUserMessage(contentMd: string) {
    setErr(null);
    setSending(true);
    try {
      await postScoutMessageFn({ data: { bookId, chapterIdx, contentMd } });
      await refresh();
      setAgentBusy(true);
      try {
        await agentRespondScoutFn({ data: { bookId, chapterIdx } });
      } finally {
        await refresh();
        setAgentBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function handleSendInput() {
    const text = input.trim();
    if (!text || sending || agentBusy || busy.brainstorm) return;
    setInput('');
    await sendUserMessage(text);
  }

  async function handleWidgetSubmit(s: WidgetSubmission) {
    if (sending || agentBusy || confirming || busy.brainstorm) return;
    if (s.confirmAction === 'approve') {
      await approvePlan();
      return;
    }
    await sendUserMessage(s.contentMd);
  }

  async function approvePlan() {
    setErr(null);
    setConfirming(true);
    try {
      await confirmChapterPlanFn({ data: { bookId, chapterIdx } });
      router.navigate({ to: '/books/$bookId', params: { bookId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function justAskAgent() {
    if (agentBusy || sending || busy.brainstorm) return;
    setErr(null);
    setAgentBusy(true);
    try {
      await agentRespondScoutFn({ data: { bookId, chapterIdx } });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentBusy(false);
    }
  }

  const widgetBusy = sending || agentBusy || confirming || busy.brainstorm;

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col gap-3 lg:h-[calc(100dvh-3rem)]">
      <header className="flex items-start justify-between gap-3 border-b border-(--color-border) pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-accent-soft) text-(--color-accent)">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to="/books/$bookId"
                params={{ bookId }}
                className="inline-flex items-center gap-1 text-[11px] text-(--color-muted) transition-colors hover:text-(--color-fg)"
              >
                <ArrowLeft className="h-3 w-3" /> 返回书页
              </Link>
              <span className="text-[11px] text-(--color-border)">/</span>
              <span className="text-[11px] text-(--color-muted)">单章 chapter-scout</span>
            </div>
            <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-(--color-fg)">
              和 scout 一起拍板第 {chapterIdx} 章 beat
            </h1>
          </div>
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium border-emerald-200 bg-emerald-50 text-emerald-700">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'active' ? 'animate-pulse bg-emerald-500' : 'bg-(--color-muted)'
            }`}
          />
          {status === 'active' ? '协商中' : status === 'confirmed' ? '已确认' : status}
        </span>
      </header>

      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-card) p-5 shadow-sm">
            {messages.map((m, i) => (
              <MessageBlock
                key={i}
                m={m}
                isLatestActiveWidget={i === latestActiveWidgetIdx}
                onWidgetSubmit={handleWidgetSubmit}
                widgetBusy={widgetBusy}
              />
            ))}
            {(agentBusy || remoteAgentRunning) && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {err && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <span className="flex-1 break-words">{err}</span>
              <button
                type="button"
                className="rounded p-1 text-red-500 hover:bg-red-100"
                onClick={() => setErr(null)}
                aria-label="关闭"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-(--color-border) bg-(--color-card) shadow-sm transition-shadow focus-within:border-(--color-accent)/50 focus-within:shadow-md">
            <Textarea
              rows={3}
              value={input}
              placeholder={
                status === 'active'
                  ? agentBusy || sending || busy.brainstorm
                    ? 'scout 跑完这一轮再发…'
                    : '随时打断 / 给反馈 / 提要求…'
                  : '已确认本章规划'
              }
              disabled={status !== 'active'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendInput();
              }}
              className="min-h-0 resize-none border-0 bg-transparent px-4 pt-3 font-sans text-sm shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={justAskAgent}
                disabled={status !== 'active' || agentBusy || sending || busy.brainstorm}
                title={remoteAgentRunning ? '服务端正在跑 scout' : undefined}
                className="text-(--color-muted) hover:text-(--color-fg)"
              >
                <Bot className="h-4 w-4" /> <span className="hidden sm:inline">让 scout 推一步</span>
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={handleSendInput}
                disabled={status !== 'active' || !input.trim() || busy.brainstorm}
              >
                {agentBusy || sending || busy.brainstorm ? (
                  <Hourglass className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {agentBusy || sending || busy.brainstorm ? '排队' : '发送'}
              </Button>
            </div>
          </div>
        </div>

        <aside className="hidden min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1 md:flex">
          <DecisionsPanel decisions={decisions} chapterIdx={chapterIdx} />
        </aside>
      </div>
    </div>
  );
}

function DecisionsPanel({
  decisions,
  chapterIdx,
}: {
  decisions: Record<string, unknown>;
  chapterIdx: number;
}) {
  const entries = Object.entries(decisions);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-3.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-(--color-fg)">
            <PenTool className="h-3.5 w-3.5 text-(--color-accent)" />
            第 {chapterIdx} 章 beat
          </div>
          <span className="rounded-full bg-(--color-accent-soft) px-2 py-0.5 font-mono text-[10px] font-medium text-(--color-accent)">
            {entries.length}
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-(--color-border) bg-(--color-bg)/50 p-3 text-[11px] leading-relaxed text-(--color-muted)">
            还没 pin 任何字段。scout 会逐项 pin。
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {entries.map(([k, v]) => (
              <div
                key={k}
                className="rounded-md border border-(--color-border) bg-(--color-bg)/60 p-2"
              >
                <div className="font-mono text-[10px] uppercase tracking-wide text-(--color-muted)">
                  {k}
                </div>
                <div className="mt-1 break-words text-[12px] font-medium leading-snug text-(--color-fg)">
                  {formatDecisionValue(v)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDecisionValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join('、');
  return JSON.stringify(v);
}

function MessageBlock(props: {
  m: MessageView;
  isLatestActiveWidget: boolean;
  onWidgetSubmit: (s: WidgetSubmission) => void | Promise<void>;
  widgetBusy: boolean;
}) {
  const { m, isLatestActiveWidget, onWidgetSubmit, widgetBusy } = props;
  const isUser = m.role === 'user';
  const isSystem = m.role === 'system';

  const bubbleCls = isUser
    ? 'rounded-2xl rounded-br-sm bg-(--color-accent) px-4 py-2.5 text-white shadow-sm'
    : isSystem
      ? 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900 shadow-sm'
      : 'rounded-2xl rounded-bl-sm border border-(--color-border) bg-(--color-card) px-4 py-2.5 text-(--color-fg) shadow-sm';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) ring-1 ring-(--color-accent)/20">
          <Bot className="h-4 w-4 text-(--color-accent)" />
        </div>
      )}
      <div className={`flex max-w-[80%] flex-col gap-2 text-sm ${bubbleCls}`}>
        {!isUser && m.actions && m.actions.length > 0 && <ActionsBlock actions={m.actions} />}
        {m.contentMd && (
          <div className="whitespace-pre-wrap break-words leading-relaxed">{m.contentMd}</div>
        )}
        {m.widget && (
          <WidgetRenderer
            widget={m.widget}
            onSubmit={onWidgetSubmit}
            locked={!isLatestActiveWidget}
            busy={widgetBusy && isLatestActiveWidget}
          />
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--color-accent) shadow-sm">
          <UserIcon className="h-4 w-4 text-white" />
        </div>
      )}
    </div>
  );
}

function ActionsBlock({ actions }: { actions: NegotiationAction[] }) {
  const [open, setOpen] = useState(false);
  const errored = actions.some((a) => a.errorMd);
  const summary = actions.length === 1 ? actions[0]!.tool : `${actions.length} 个动作`;

  return (
    <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg)/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-(--color-accent-soft)/40"
      >
        <Wrench className={`h-3.5 w-3.5 shrink-0 ${errored ? 'text-red-600' : 'text-(--color-muted)'}`} />
        <span className="flex-1 truncate text-(--color-muted)">{summary}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-(--color-muted) transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <ol className="flex flex-col gap-1.5 border-t border-(--color-border) bg-(--color-card)/60 px-3 py-2 text-[11px]">
          {actions.map((a) => (
            <li key={a.seq} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 font-mono text-[9px] text-(--color-muted)">
                {a.seq}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-(--color-fg)">{a.tool}</span>
                  {typeof a.durationMs === 'number' && (
                    <span className="text-[10px] text-(--color-muted)">{a.durationMs}ms</span>
                  )}
                </div>
                <div className="mt-0.5 break-words text-[11px] leading-snug text-(--color-fg)/85">
                  {a.argsSummary}
                </div>
                {a.errorMd && (
                  <div className="mt-0.5 break-words rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                    {a.errorMd}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) ring-1 ring-(--color-accent)/20">
        <Bot className="h-4 w-4 text-(--color-accent)" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-(--color-border) bg-(--color-card) px-4 py-3 shadow-sm">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-accent) [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-accent) [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-accent)" />
        <span className="ml-1 text-[11px] text-(--color-muted)">scout 思考中</span>
      </div>
    </div>
  );
}

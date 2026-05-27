import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BookOpen,
  ChevronDown,
  FolderTree,
  Hourglass,
  Loader2,
  MessageSquareText,
  Pin,
  PinOff,
  RotateCcw,
  Search,
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
  agentRespondFn,
  confirmTopicFn,
  fetchNegotiationFn,
  postUserMessageFn,
  retryConfirmedTopicProductionFn,
  startWritingFn,
} from '~/server/fns/negotiations';
import { listRunsForBookFn } from '~/server/fns/runs';
import { useBookBusy } from '~/lib/use-book-busy';
import type { NegotiationAction, NegotiationWidget } from '~/server/db/schema/index';

export const Route = createFileRoute('/books/$bookId/chat')({
  component: ChatRoute,
  loader: async ({ params }) => {
    const [{ negotiation, brief }, recentRuns] = await Promise.all([
      fetchNegotiationFn({
        data: { bookId: params.bookId },
      }),
      listRunsForBookFn({ data: { bookId: params.bookId, limit: 8 } }),
    ]);
    return { bookId: params.bookId, negotiation, brief, recentRuns };
  },
});

interface MessageView {
  role: string;
  contentMd: string;
  widget?: NegotiationWidget;
  briefDraft?: Record<string, unknown>;
  produceArgs?: { gateMode: 'fully-auto' | 'auto-with-confirm' | 'manual' };
  actions?: NegotiationAction[];
  ts: string;
  runId?: string;
}

interface RunView {
  id: string;
  kind: string;
  status: string;
  parentId: string | null;
  errorMd: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

function ChatRoute() {
  const {
    bookId,
    negotiation: initialNeg,
    recentRuns: initialRuns,
  } = Route.useLoaderData();
  const router = useRouter();

  const [messages, setMessages] = useState<MessageView[]>(
    (initialNeg?.messages as unknown as MessageView[]) ?? [],
  );
  const [decisions, setDecisions] = useState<Record<string, unknown>>(
    (initialNeg?.decisions as Record<string, unknown>) ?? {},
  );
  const [status, setStatus] = useState(initialNeg?.status ?? 'active');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunView[]>(initialRuns as RunView[]);
  const [retrying, setRetrying] = useState(false);
  /** 用户在 agent 跑的时候发的消息：先排队，agent 一空闲自动送出 */
  const [pending, setPending] = useState<string | null>(null);

  // active / designing 阶段都在 chat 里互动；confirmed 阶段（已开写）就不再 chat。
  const isChatting = status === 'active' || status === 'designing';
  // confirmed 阶段不需要继续轮询（chat 已结束）；active / designing 阶段持续监听服务端 harness
  const busy = useBookBusy(bookId, { enabled: isChatting });

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // 自动接话：进 chat 时若最后一条不是 agent（典型场景：
  //  - active：从 /books 立项跳过来，stub negotiation 只有一条用户想法
  //  - designing：confirmTopicFn 刚追加了 system "设计文档已生成"，要让 design-review 先开口
  // ），自动让 agent 推一轮。服务端 / 本地 / 历史 run 在跑就跳过，避免撞车。
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    if (!isChatting) return;
    if (agentBusy || sending) return;
    if (busy.brainstorm || busy.loading) return;
    if (messages.length === 0) return;
    if (recentRuns.some((r) => r.status === 'running')) return;
    const last = messages[messages.length - 1];
    if (!last || last.role === 'agent') return;
    autoTriggeredRef.current = true;
    void justAskAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, status, agentBusy, sending, recentRuns, busy.brainstorm, busy.loading]);

  // 排队释放：agent 空闲且有待发，自动送出。服务端 chat agent 在跑也得等。
  useEffect(() => {
    if (agentBusy || sending) return;
    if (busy.brainstorm) return;
    if (!pending) return;
    if (!isChatting) return;
    const text = pending;
    setPending(null);
    void sendUserMessage(text, '排队消息送达');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBusy, sending, pending, status, busy.brainstorm]);

  // failure-run polling：仅在 confirmed 阶段（design/gate-1 跑批）需要——
  // active 阶段失败由 agentRespondFn 直接 throw，命中 err 状态。
  useEffect(() => {
    if (status !== 'confirmed') return;
    let cancelled = false;
    async function poll() {
      try {
        const rows = await listRunsForBookFn({ data: { bookId, limit: 8 } });
        if (!cancelled) setRecentRuns(rows as RunView[]);
      } catch {
        // 略
      }
    }
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bookId, status]);

  async function refresh() {
    const { negotiation } = await fetchNegotiationFn({ data: { bookId } });
    if (negotiation) {
      setMessages(negotiation.messages as unknown as MessageView[]);
      setDecisions(
        (negotiation.decisions as Record<string, unknown>) ?? {},
      );
      setStatus(negotiation.status);
    }
  }

  /** 仅最新一条 agent 消息上的 widget 是"待回答"的；旧的全部锁定 */
  const latestActiveWidgetIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'agent' && m.widget) {
        // 后面有 user 消息就说明已经回答过了
        const answered = messages.slice(i + 1).some((later) => later.role === 'user');
        return answered ? -1 : i;
      }
    }
    return -1;
  }, [messages]);

  async function sendUserMessage(contentMd: string, _label?: string) {
    setErr(null);
    setSending(true);
    try {
      await postUserMessageFn({ data: { bookId, contentMd } });
      await refresh();
      setAgentBusy(true);
      try {
        await agentRespondFn({ data: { bookId } });
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

  /**
   * 发送：agent 忙时（含服务端 brainstorm-harness）排队，不阻塞输入框。
   */
  async function handleSendInput() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (agentBusy || sending || busy.brainstorm) {
      setPending(text);
      return;
    }
    await sendUserMessage(text);
  }

  /** widget 提交回调：把答复 serialize 成 user 消息发回去 */
  async function handleWidgetSubmit(s: WidgetSubmission) {
    if (sending || agentBusy || confirming || busy.brainstorm) return;
    if (s.confirmAction === 'approve') {
      // 同款 confirm widget 服务两件事：brainstorm.confirm_topic（briefDraft）
      // 和 design-review.start_writing（produceArgs）。按消息上的字段分流。
      const m = latestActiveWidgetIdx >= 0 ? messages[latestActiveWidgetIdx] : null;
      if (m?.produceArgs) {
        await approveStartWriting();
      } else {
        await approveTopic();
      }
      return;
    }
    await sendUserMessage(s.contentMd);
  }

  async function approveTopic() {
    setErr(null);
    setConfirming(true);
    try {
      // 立项 confirm：服务端会落 brief + 跑 story-designer + 推 system 消息。
      // 不再跳到 design 页——design review 在本 chat 里继续。
      await confirmTopicFn({ data: { bookId, startProduction: false } });
      await refresh();
      // 让 design-review-harness 自动接第一轮（进入 designing 状态后由 autoTrigger 触发）
      autoTriggeredRef.current = false;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function approveStartWriting() {
    setErr(null);
    setConfirming(true);
    try {
      await startWritingFn({ data: { bookId } });
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
      await agentRespondFn({ data: { bookId } });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentBusy(false);
    }
  }

  /**
   * 重试当前出错状态：active 阶段就重新跑一轮 brainstorm-harness；
   * confirmed 阶段就重启 design + gate-1。
   */
  async function retryCurrent() {
    if (retrying || sending || agentBusy || confirming) return;
    setErr(null);
    setRetrying(true);

    // active / designing 都属于 chat 阶段，重试 = 重跑 agent 一轮
    if (isChatting) {
      setAgentBusy(true);
      try {
        await agentRespondFn({ data: { bookId } });
        await refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setAgentBusy(false);
        setRetrying(false);
      }
      return;
    }

    setConfirming(true);
    try {
      await retryConfirmedTopicProductionFn({
        data: { bookId, gateMode: 'auto-with-confirm' },
      });
      router.navigate({ to: '/books/$bookId', params: { bookId } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
      setRetrying(false);
    }
  }

  const widgetBusy = sending || agentBusy || confirming || busy.brainstorm;
  const remoteAgentRunning = busy.brainstorm && !agentBusy && !sending;
  const latestFailureRun =
    status === 'confirmed' && recentRuns[0]?.status === 'failure' ? recentRuns[0] : null;

  const statusTone =
    status === 'active'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'designing'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'confirmed'
          ? 'border-(--color-accent)/40 bg-(--color-accent-soft) text-(--color-accent)'
          : 'border-(--color-border) bg-(--color-card) text-(--color-muted)';

  const statusLabel =
    status === 'active'
      ? '协商中'
      : status === 'designing'
        ? '设计 review'
        : status === 'confirmed'
          ? '已确认'
          : status;

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
              <span className="text-[11px] text-(--color-muted)">
                {status === 'designing' ? 'design review' : '立项 brainstorm'}
              </span>
            </div>
            <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-(--color-fg)">
              {status === 'designing'
                ? '审一审 4 份设计文档，再下令开写'
                : '和 scout 聊故事，一题一问拼出立项 brief'}
            </h1>
          </div>
        </div>
        <span
          className={`mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusTone}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'active'
                ? 'animate-pulse bg-emerald-500'
                : status === 'designing'
                  ? 'animate-pulse bg-amber-500'
                  : status === 'confirmed'
                    ? 'bg-(--color-accent)'
                    : 'bg-(--color-muted)'
            }`}
          />
          {statusLabel}
        </span>
      </header>

      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-card) p-5 shadow-sm">
            {messages.length === 0 && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--color-accent-soft) text-(--color-accent)">
                  <MessageSquareText className="h-6 w-6" />
                </div>
                <div className="max-w-sm">
                  <p className="text-sm font-medium text-(--color-fg)">和 scout 聊聊你的故事想法</p>
                  <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
                    一句话也行：题材、目标读者、想看到的桥段。scout 会查 KB、提候选方案、逐项 pin 决策。
                  </p>
                </div>
              </div>
            )}
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

          {(err || latestFailureRun) && (
            <FailureBanner
              message={
                err ??
                `${latestFailureRun?.kind ?? 'run'} 失败：${
                  latestFailureRun?.errorMd?.slice(0, 200) ?? '无错误摘要'
                }`
              }
              retryLabel={isChatting ? '重试这一轮' : '重试立项生产'}
              onRetry={retryCurrent}
              onDismiss={err ? () => setErr(null) : undefined}
              busy={retrying || agentBusy || sending || confirming}
            />
          )}

          {pending && (
            <PendingBanner text={pending} onCancel={() => setPending(null)} />
          )}

          <div className="rounded-2xl border border-(--color-border) bg-(--color-card) shadow-sm transition-shadow focus-within:border-(--color-accent)/50 focus-within:shadow-md">
            <Textarea
              rows={3}
              value={input}
              placeholder={
                isChatting
                  ? agentBusy || sending || busy.brainstorm
                    ? '想补一句？发送会排队，agent 跑完这一轮就送过去…'
                    : status === 'designing'
                      ? '想改哪？说"主角太软，改强势"或"风格再轻松点"…'
                      : '随时打断 / 给反馈 / 提要求…（widget 之外的自由文本）'
                  : '已确认立项'
              }
              disabled={!isChatting}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendInput();
              }}
              className="min-h-0 resize-none border-0 bg-transparent px-4 pt-3 font-sans text-sm shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 border-t border-(--color-border) px-3 py-2">
              <span className="hidden text-[10px] text-(--color-muted) sm:inline">
                <kbd className="rounded border border-(--color-border) bg-(--color-bg) px-1 py-0.5 font-mono text-[9px]">⌘</kbd>
                <span className="mx-0.5">/</span>
                <kbd className="rounded border border-(--color-border) bg-(--color-bg) px-1 py-0.5 font-mono text-[9px]">Ctrl</kbd>
                <span className="mx-1">+</span>
                <kbd className="rounded border border-(--color-border) bg-(--color-bg) px-1 py-0.5 font-mono text-[9px]">Enter</kbd>
                <span className="ml-1.5">发送</span>
              </span>
              <div className="flex gap-2 sm:ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={justAskAgent}
                  disabled={!isChatting || agentBusy || sending || busy.brainstorm}
                  title={remoteAgentRunning ? '服务端正在跑 agent（可能是另一标签页触发的）' : undefined}
                  className="text-(--color-muted) hover:text-(--color-fg)"
                >
                  <Bot className="h-4 w-4" />{' '}
                  <span className="hidden sm:inline">
                    {status === 'designing' ? '让 design-review 推一步' : '让 scout 推一步'}
                  </span>
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={handleSendInput}
                  disabled={!isChatting || !input.trim()}
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
        </div>

        <aside className="hidden min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1 md:flex">
          <DecisionsPanel decisions={decisions} />
        </aside>
      </div>
    </div>
  );
}

/* ─── 失败 banner：inline 红框 + 重试 + 关闭 ─── */

function FailureBanner(props: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  onDismiss?: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 break-words">{props.message}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-100"
          onClick={props.onRetry}
          disabled={props.busy}
        >
          {props.busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          {props.retryLabel}
        </Button>
        {props.onDismiss && (
          <button
            type="button"
            className="rounded p-1 text-red-500 hover:bg-red-100"
            onClick={props.onDismiss}
            aria-label="关闭"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── 排队 banner：用户在 agent 忙的时候发的消息 ─── */

function PendingBanner({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-(--color-accent)/40 bg-(--color-accent-soft)/60 px-3 py-2.5 text-xs text-(--color-fg)">
      <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">已排队 · 等 scout 这一轮跑完就送过去</div>
        <div className="mt-0.5 truncate text-[11px] text-(--color-muted)">「{text}」</div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-(--color-muted) hover:bg-(--color-accent-soft) hover:text-(--color-fg)"
        onClick={onCancel}
        aria-label="取消排队"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ─── 决策表面板（仿 Claude Code memory 面板 mental model） ─── */

function DecisionsPanel({ decisions }: { decisions: Record<string, unknown> }) {
  const entries = Object.entries(decisions);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-3.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-(--color-fg)">
            <Pin className="h-3.5 w-3.5 fill-current text-(--color-accent)" />
            决策表
          </div>
          <span className="rounded-full bg-(--color-accent-soft) px-2 py-0.5 font-mono text-[10px] font-medium text-(--color-accent)">
            {entries.length}
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-(--color-border) bg-(--color-bg)/50 p-3 text-[11px] leading-relaxed text-(--color-muted)">
            还没 pin 任何决策。scout 会随对话推进逐项 pin。
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {entries.map(([k, v]) => (
              <div
                key={k}
                className="rounded-md border border-(--color-border) bg-(--color-bg)/60 p-2 transition-colors hover:border-(--color-accent)/30 hover:bg-(--color-accent-soft)/30"
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

/* ─── 消息块：纯文本 / widget / confirm widget 三态 ─── */

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

/* ─── 行动卡：折叠展示 agent 这一轮的中间 tool calls ─── */

const TOOL_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; tone: string }
> = {
  list_kb: { icon: FolderTree, label: '列目录', tone: 'text-sky-600' },
  read_kb: { icon: BookOpen, label: '读文档', tone: 'text-emerald-600' },
  grep_kb: { icon: Search, label: '搜索', tone: 'text-violet-600' },
  pin_decision: { icon: Pin, label: '钉决策', tone: 'text-(--color-accent)' },
  unpin_decision: { icon: PinOff, label: '撤决策', tone: 'text-(--color-muted)' },
};

function ActionsBlock({ actions }: { actions: NegotiationAction[] }) {
  const [open, setOpen] = useState(false);
  const errored = actions.some((a) => a.errorMd);
  const summary = summarizeActions(actions);

  return (
    <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg)/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-(--color-accent-soft)/40"
      >
        <Wrench className={`h-3.5 w-3.5 shrink-0 ${errored ? 'text-red-600' : 'text-(--color-muted)'}`} />
        <span className="flex-1 truncate text-(--color-muted)">
          <span className="font-mono text-[11px] text-(--color-fg)">{actions.length} 个动作</span>
          <span className="mx-1.5 text-(--color-border)">·</span>
          {summary}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-(--color-muted) transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <ol className="flex flex-col gap-1.5 border-t border-(--color-border) bg-(--color-card)/60 px-3 py-2 text-[11px]">
          {actions.map((a) => {
            const meta = TOOL_META[a.tool] ?? { icon: Wrench, label: a.tool, tone: 'text-(--color-muted)' };
            const Icon = meta.icon;
            return (
              <li key={a.seq} className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 font-mono text-[9px] text-(--color-muted)">
                  {a.seq}
                </span>
                <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${meta.tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-medium text-(--color-fg)">{meta.label}</span>
                    <span className="font-mono text-[10px] text-(--color-muted)">{a.tool}</span>
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
            );
          })}
        </ol>
      )}
    </div>
  );
}

function summarizeActions(actions: NegotiationAction[]): string {
  const counts = new Map<string, number>();
  for (const a of actions) {
    counts.set(a.tool, (counts.get(a.tool) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [tool, n] of counts) {
    const label = TOOL_META[tool]?.label ?? tool;
    parts.push(n > 1 ? `${label}×${n}` : label);
  }
  return parts.join('、');
}

/* ─── 思考中：三点呼吸动画 ─── */

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


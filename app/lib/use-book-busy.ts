import { useEffect, useRef, useState } from 'react';
import { getBookBusyStateFn } from '~/server/fns/book-busy';

export type GateKind = 'gate-1' | 'gate-2' | 'gate-3';

export interface BookBusyView {
  writing: boolean;
  brainstorm: boolean;
  design: boolean;
  /** 任意一组在跑（含 pilot 入队） */
  any: boolean;
  activeKinds: { writing: string[]; brainstorm: string[]; design: string[] };
  pendingBatchJobs: number;
  /**
   * 最早一条 pending 的 gate（FIFO）。用来在按钮 label 上区分
   * "真在后台生成" vs "其实在等用户去书详情页点 gate-N 确认"。
   */
  awaitingGate: { gateId: string; kind: GateKind } | null;
  /** 第一次拉到结果之前为 true，避免按钮在加载期闪一下 enabled */
  loading: boolean;
}

const IDLE: BookBusyView = {
  writing: false,
  brainstorm: false,
  design: false,
  any: false,
  activeKinds: { writing: [], brainstorm: [], design: [] },
  pendingBatchJobs: 0,
  awaitingGate: null,
  loading: true,
};

export interface UseBookBusyOptions {
  /** 暂停轮询（chat/scout 在 status='confirmed' 后可关掉，省点请求） */
  enabled?: boolean;
  /** 轮询间隔；默认 2500ms。busy=true 时仍按这个频率，因为状态可能很快翻转 */
  intervalMs?: number;
}

/**
 * 订阅一本书的 busy state。第一次拉到之前返回 loading=true，所有按钮应当 disabled。
 *
 * 不依赖 react-query —— 跟仓库现有的 router.invalidate + setInterval 模式一致。
 */
export function useBookBusy(
  bookId: string | null | undefined,
  opts: UseBookBusyOptions = {},
): BookBusyView {
  const { enabled = true, intervalMs = 2500 } = opts;
  const [state, setState] = useState<BookBusyView>(IDLE);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!bookId || !enabled) {
      setState(IDLE);
      return () => {
        cancelledRef.current = true;
      };
    }
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const r = await getBookBusyStateFn({ data: { bookId: bookId! } });
        if (cancelledRef.current) return;
        setState({
          writing: r.writing,
          brainstorm: r.brainstorm,
          design: r.design,
          any: r.writing || r.brainstorm || r.design,
          activeKinds: r.activeKinds,
          pendingBatchJobs: r.pendingBatchJobs,
          awaitingGate: r.awaitingGate,
          loading: false,
        });
      } catch {
        // 静默降级：拉不到就当 idle，不阻塞用户
        if (!cancelledRef.current) setState((prev) => ({ ...prev, loading: false }));
      }
      if (!cancelledRef.current) {
        timer = setTimeout(poll, intervalMs);
      }
    }

    poll();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [bookId, enabled, intervalMs]);

  return state;
}

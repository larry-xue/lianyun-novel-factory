import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 用户从 UI 触发的"中断这本书的跑批"。
 *
 * 模型：
 * - 每个根 run（produce-book / produce-book-existing / produce-book-resume / write-next-chapter）
 *   在入口包一层 withCancellation(rootRunId, fn)。
 * - withCancellation 注册 AbortController 到内存 Map，并把 { rootRunId, signal } 放进 ALS。
 * - 子 agent / 工具不需要显式接收 signal：runChildAgent / runHarnessedAgent 从 ALS 取，
 *   传给 client.chat 的 fetch（解决"卡住的 LLM 请求"）。
 * - cancelRunFn 调 requestCancel(rootRunId) → 内存里的 controller.abort()。
 *   - 同进程时：fetch 立即抛 AbortError，run 标 cancelled。
 *   - 不同进程 / 进程已重启时：内存查不到，cancelRunFn 仍然把 DB 标 cancelled
 *     兜底，下一次 checkpoint 也会发现状态是 cancelled 而 throw（如果原进程还活着）。
 */

export class CancelledError extends Error {
  readonly rootRunId: string;
  constructor(rootRunId: string, message?: string) {
    super(message ?? `run ${rootRunId} 被用户中断`);
    this.name = 'CancelledError';
    this.rootRunId = rootRunId;
  }
}

interface CancellationContext {
  rootRunId: string;
  signal: AbortSignal;
}

const als = new AsyncLocalStorage<CancellationContext>();
const controllerByRoot = new Map<string, AbortController>();

/**
 * 注册一个 controller 并把 ctx 放进 ALS。fn 完成后自动清理。
 * 嵌套调用（不大可能但防御性写）使用最内层 controller。
 */
export async function withCancellation<T>(
  rootRunId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  controllerByRoot.set(rootRunId, controller);
  try {
    return await als.run({ rootRunId, signal: controller.signal }, fn);
  } finally {
    // 只有自己塞进去的 controller 才删（防 cancelRun 之后 abort 仍要保留状态）
    if (controllerByRoot.get(rootRunId) === controller) {
      controllerByRoot.delete(rootRunId);
    }
  }
}

export function getCurrentCancellation(): CancellationContext | undefined {
  return als.getStore();
}

export function getCurrentSignal(): AbortSignal | undefined {
  return als.getStore()?.signal;
}

/**
 * 在 ALS 的当前根 run 上抛 CancelledError，如果已经被中断的话。
 * runChildAgent / harness 在每个 checkpoint 调一次。
 */
export function throwIfCancelled(): void {
  const ctx = als.getStore();
  if (ctx?.signal.aborted) {
    throw new CancelledError(ctx.rootRunId);
  }
}

/**
 * 用户触发取消：abort 对应的 controller。
 * 返回是否在本进程内找到 controller（找不到不代表失败，可能进程已重启）。
 */
export function requestCancel(rootRunId: string): boolean {
  const c = controllerByRoot.get(rootRunId);
  if (!c) return false;
  c.abort(new CancelledError(rootRunId));
  return true;
}

export function isAbortLikeError(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    // node fetch 在 abort 时抛 DOMException name=AbortError，但有些 polyfill 抛
    // TypeError 带 "aborted"。两边都兜一下。
    if (/aborted|abort signal/i.test(err.message)) return true;
  }
  return false;
}

/** 仅测试用：清空注册表，避免 test 间污染。 */
export function _resetCancellationForTests(): void {
  controllerByRoot.clear();
}

import { afterEach, describe, expect, it } from 'vitest';
import {
  CancelledError,
  _resetCancellationForTests,
  getCurrentCancellation,
  getCurrentSignal,
  isAbortLikeError,
  requestCancel,
  throwIfCancelled,
  withCancellation,
} from './cancellation.ts';

afterEach(() => {
  _resetCancellationForTests();
});

describe('withCancellation', () => {
  it('暴露 signal + rootRunId 给 ALS 内的代码', async () => {
    await withCancellation('root-1', async () => {
      const ctx = getCurrentCancellation();
      expect(ctx?.rootRunId).toBe('root-1');
      expect(ctx?.signal.aborted).toBe(false);
    });
  });

  it('未在 ALS 内时 getCurrentSignal 返回 undefined', () => {
    expect(getCurrentSignal()).toBeUndefined();
  });

  it('fn 完成后清理注册表，requestCancel 找不到', async () => {
    await withCancellation('root-2', async () => {
      // do nothing
    });
    expect(requestCancel('root-2')).toBe(false);
  });

  it('requestCancel 触发 signal.aborted=true 并让 throwIfCancelled 抛出', async () => {
    let caught: unknown;
    await withCancellation('root-3', async () => {
      // 模拟另一处线程触发 cancel
      const found = requestCancel('root-3');
      expect(found).toBe(true);
      expect(getCurrentSignal()?.aborted).toBe(true);
      try {
        throwIfCancelled();
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(CancelledError);
    expect((caught as CancelledError).rootRunId).toBe('root-3');
  });

  it('信号会被 client.chat 这种异步操作的 await 看到', async () => {
    let signal: AbortSignal | undefined;
    const promise = withCancellation('root-4', async () => {
      signal = getCurrentSignal();
      // 模拟 fetch 等长跑
      await new Promise<void>((resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
        // 不 resolve，等 abort
      });
    });
    // 在 promise 还在等的时候触发
    await Promise.resolve();
    requestCancel('root-4');
    await expect(promise).rejects.toThrow(/aborted/);
    expect(signal?.aborted).toBe(true);
  });

  it('requestCancel 找不到对应 root 时返回 false（进程重启场景）', () => {
    expect(requestCancel('does-not-exist')).toBe(false);
  });
});

describe('isAbortLikeError', () => {
  it('CancelledError → true', () => {
    expect(isAbortLikeError(new CancelledError('r1'))).toBe(true);
  });

  it('AbortError name → true', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortLikeError(err)).toBe(true);
  });

  it('包含 aborted 字样的 Error → true', () => {
    expect(isAbortLikeError(new Error('The operation was aborted'))).toBe(true);
  });

  it('普通 Error → false', () => {
    expect(isAbortLikeError(new Error('boom'))).toBe(false);
  });

  it('非 Error 值 → false', () => {
    expect(isAbortLikeError('aborted')).toBe(false);
    expect(isAbortLikeError(undefined)).toBe(false);
  });
});

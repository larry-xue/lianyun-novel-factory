import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { loadBookBusyState } from '../services/book-busy.ts';

/**
 * 客户端用 useBookBusy hook 订阅。只读查询，登录即可。
 *
 * 注意：此文件只放 createServerFn，不要导出任何 helper —— 否则 TanStack Start 的
 * tssr split 不会把 helper 替换成 RPC stub，会把 db / dotenv 拖进 client bundle，
 * 浏览器里读 process.argv 直接崩。
 */
export const getBookBusyStateFn = createServerFn({ method: 'GET' })
  .inputValidator((raw: unknown) => z.object({ bookId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    await requireUser();
    return await loadBookBusyState(data.bookId);
  });

import { redirect, useRouter } from '@tanstack/react-router';
import type { RootContextUser } from '~/routes/__root';

/**
 * 客户端拿当前用户。从 root route 的 context 取，所有路由都能用。
 * 没登录或还在 SSR 之前 → null。
 */
export function useMe(): RootContextUser | null {
  const router = useRouter();
  const root = router.state.matches[0];
  return ((root?.context as { me?: RootContextUser | null } | undefined)?.me) ?? null;
}

/**
 * `beforeLoad` 守卫：非 admin 重定向到 /403?reason=admin-only。
 * 直接 throw redirect，不让 loader 跑出 403 报错。
 */
export function requireAdminBeforeLoad({ context }: { context: unknown }): void {
  const me = (context as { me?: RootContextUser | null } | undefined)?.me;
  if (!me) {
    throw redirect({ to: '/login' });
  }
  if (me.role !== 'admin') {
    throw redirect({ to: '/403', search: { reason: 'admin-only' } as { reason: string } });
  }
}

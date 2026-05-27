import type { ReactNode } from 'react';
import { useMe } from '~/lib/auth-client';

/**
 * 仅 admin 渲染 children；其他人渲染 fallback（默认 null）。
 */
export function AdminOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const me = useMe();
  return me?.role === 'admin' ? <>{children}</> : <>{fallback}</>;
}

/**
 * 仅书的 owner 或 admin 渲染 children。
 * - ownerId 为 null（系统/历史遗留）→ 仅 admin
 * - ownerId === me.id → 通过
 * - admin → 通过
 */
export function OwnerOnly({
  ownerId,
  children,
  fallback = null,
}: {
  ownerId: string | null | undefined;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const me = useMe();
  if (!me) return <>{fallback}</>;
  const allowed =
    me.role === 'admin' ||
    (ownerId !== null && ownerId !== undefined && ownerId === me.id);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

/**
 * Hook 形式：业务里要根据权限改逻辑（比如禁用按钮）时用。
 */
export function useIsBookOwner(ownerId: string | null | undefined): boolean {
  const me = useMe();
  if (!me) return false;
  if (me.role === 'admin') return true;
  return !!ownerId && ownerId === me.id;
}

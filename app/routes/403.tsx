import { createFileRoute } from '@tanstack/react-router';
import { Lock, ShieldAlert } from 'lucide-react';
import { ErrorScreen } from '~/components/layout/error-screen';

interface ForbiddenSearch {
  reason?: 'admin-only' | 'owner-only' | string;
}

export const Route = createFileRoute('/403')({
  validateSearch: (raw: Record<string, unknown>): ForbiddenSearch => ({
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  }),
  component: ForbiddenPage,
});

function ForbiddenPage() {
  const { reason } = Route.useSearch();

  const copy = REASON_COPY[reason ?? 'default'] ?? REASON_COPY.default!;

  return (
    <ErrorScreen
      code="403"
      title={copy.title}
      icon={reason === 'admin-only' ? <ShieldAlert className="h-7 w-7" /> : <Lock className="h-7 w-7" />}
      tone="rose"
      description={copy.description}
      hint="若认为是误判，可让管理员在 /audit 查日志或在 scripts/create-user.ts 调整角色。"
    />
  );
}

const REASON_COPY: Record<string, { title: string; description: string }> = {
  'admin-only': {
    title: '需要管理员权限',
    description: '这个页面只对管理员开放。你当前是普通用户，不能查看 / 修改平台级配置。',
  },
  'owner-only': {
    title: '不是这本书的所有者',
    description: '只有书籍的创建者或管理员才能进入此操作。',
  },
  default: {
    title: '没有访问权限',
    description: '你的账号没有权限访问这个页面。',
  },
};

import { Link, useRouter } from '@tanstack/react-router';
import {
  BookOpen,
  Boxes,
  FileCode,
  FlaskConical,
  LayoutDashboard,
  Library,
  Lightbulb,
  LogOut,
  PenLine,
  ScrollText,
  Settings,
  ShieldCheck,
  TestTubeDiagonal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { logoutFn } from '~/server/fns/auth';
import { cn } from '~/lib/cn';
import type { RootContextUser } from '~/routes/__root';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  adminOnly?: boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: '核心',
    items: [
      { to: '/', label: '仪表盘', icon: LayoutDashboard },
      { to: '/books', label: '书架', icon: PenLine },
      { to: '/runs', label: '跑批观测', icon: TestTubeDiagonal },
    ],
  },
  {
    title: '工坊',
    items: [
      { to: '/prompts', label: 'Prompt 仓', icon: FileCode, hint: '可编辑', adminOnly: true },
    ],
  },
  {
    title: '知识库',
    items: [
      { to: '/elements', label: '元素词典', icon: Library },
      { to: '/styles/samples', label: '范文库', icon: BookOpen },
      { to: '/hooks', label: 'Hook 模板', icon: Lightbulb },
      { to: '/anti-patterns', label: '反例库', icon: FlaskConical },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/settings', label: '配置中心', icon: Settings, adminOnly: true },
      { to: '/audit', label: '审计日志', icon: ScrollText, adminOnly: true },
    ],
  },
];

function NavContent({
  onNavigate,
  me,
}: {
  onNavigate?: () => void;
  me: RootContextUser;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await logoutFn();
      await router.invalidate();
      router.navigate({ to: '/login' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="shrink-0 px-2">
        <Link to="/" className="group flex items-center gap-2 rounded-md px-1 py-1" onClick={onNavigate}>
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-(--color-border) bg-(--color-surface) text-(--color-accent)">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-semibold tracking-tight">炼云工厂</span>
            <span className="truncate text-xs text-(--color-muted)">小说自动批量生产线</span>
          </span>
        </Link>
      </div>
      <nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
        {SECTIONS.map((section) => {
          const items = section.items.filter((it) => !it.adminOnly || me.role === 'admin');
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="flex flex-col gap-1">
              <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--color-muted)">
                {section.title}
              </div>
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-(--color-fg) transition-colors hover:bg-(--color-surface)"
                  activeProps={{ className: 'bg-(--color-accent-soft) font-semibold text-(--color-fg)' }}
                  activeOptions={{ exact: item.to === '/' }}
                  onClick={onNavigate}
                >
                  <item.icon className={cn('h-4 w-4 shrink-0 text-(--color-muted) group-hover:text-(--color-fg)')} />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && (
                    <span className="rounded-full bg-(--color-surface) px-1.5 py-0.5 text-[10px] text-(--color-muted)">
                      {item.hint}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {me.role === 'admin' ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-(--color-accent)" />
            ) : (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-(--color-muted)/20 text-[9px] text-(--color-muted)">
                U
              </span>
            )}
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium text-(--color-fg)">{me.username}</span>
              <span className="text-[10px] text-(--color-muted)">{me.role === 'admin' ? '管理员' : '普通用户'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            title="登出"
            className="rounded-md p-1 text-(--color-muted) hover:bg-(--color-card) hover:text-(--color-fg) disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-[10px] leading-5 text-(--color-muted)">
          <div className="font-semibold text-(--color-fg)">v0 · {new Date().getFullYear()}</div>
          <div>本地生产工作台</div>
        </div>
      </div>
    </>
  );
}

export function Sidebar({ me }: { me: RootContextUser }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 border-r border-(--color-border) bg-(--color-card)/90 px-3 py-4 shadow-[1px_0_0_rgb(15_23_42/0.02)] backdrop-blur lg:flex">
      <NavContent me={me} />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: RootContextUser;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-5 border-r border-(--color-border) bg-(--color-card) px-3 transition-transform duration-200 lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 rounded-md p-1 text-(--color-muted) hover:bg-(--color-surface) hover:text-(--color-fg)"
        >
          <X className="h-4 w-4" />
        </button>
        <NavContent onNavigate={onClose} me={me} />
      </aside>
    </>
  );
}

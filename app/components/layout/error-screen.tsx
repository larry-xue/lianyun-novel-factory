import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '~/components/ui/button';

interface ErrorScreenProps {
  /** 大号编号，例如 "404" / "403" */
  code: string;
  /** 主标题 */
  title: string;
  /** 描述文案，可多行 */
  description: ReactNode;
  /** 顶部图标节点 */
  icon: ReactNode;
  /** 主操作（默认"回到首页"） */
  primaryAction?: { label: string; to: string };
  /** 次要操作（可选） */
  secondaryAction?: { label: string; to: string };
  /** 底部小字（如"如认为这是误判，联系管理员"） */
  hint?: ReactNode;
  /** 主色调（影响图标和编号渐变） */
  tone?: 'amber' | 'rose' | 'sky';
}

const TONE_STYLES: Record<NonNullable<ErrorScreenProps['tone']>, { ring: string; text: string; soft: string }> = {
  amber: { ring: 'ring-amber-200', text: 'text-amber-600', soft: 'bg-amber-50' },
  rose: { ring: 'ring-rose-200', text: 'text-rose-600', soft: 'bg-rose-50' },
  sky: { ring: 'ring-sky-200', text: 'text-sky-600', soft: 'bg-sky-50' },
};

export function ErrorScreen({
  code,
  title,
  description,
  icon,
  primaryAction = { label: '回到首页', to: '/' },
  secondaryAction,
  hint,
  tone = 'amber',
}: ErrorScreenProps) {
  const t = TONE_STYLES[tone];
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-card) shadow-sm">
        <div className={`absolute inset-x-0 -top-24 h-48 ${t.soft} opacity-70 blur-3xl`} />
        <div className="relative flex flex-col items-center gap-5 px-8 py-12 text-center">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-card) ring-4 ${t.ring} ${t.text}`}
          >
            {icon}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`bg-gradient-to-r from-(--color-fg) ${t.text === 'text-rose-600' ? 'to-rose-500' : t.text === 'text-sky-600' ? 'to-sky-500' : 'to-amber-500'} bg-clip-text font-mono text-6xl font-bold tracking-tight text-transparent`}
            >
              {code}
            </div>
            <h1 className="text-lg font-semibold text-(--color-fg)">{title}</h1>
          </div>
          <div className="max-w-sm text-sm leading-relaxed text-(--color-muted)">
            {description}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="accent" size="sm">
              <Link to={primaryAction.to}>{primaryAction.label}</Link>
            </Button>
            {secondaryAction && (
              <Button asChild variant="outline" size="sm">
                <Link to={secondaryAction.to}>{secondaryAction.label}</Link>
              </Button>
            )}
          </div>
          {hint && (
            <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-(--color-muted)/80">
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

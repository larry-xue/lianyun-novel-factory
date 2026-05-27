import * as React from 'react';
import { cn } from '~/lib/cn';
import { Card, CardContent } from './card';

export function PageShell({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-5', className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b border-(--color-border) pb-5 md:flex-row md:items-end md:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-(--color-muted)">
            {eyebrow}
          </div>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-(--color-fg)">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm leading-6 text-(--color-muted)">
            {description}
          </p>
        )}
        {meta && <div className="mt-2 flex flex-wrap gap-2 text-xs text-(--color-muted)">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-muted)">
          {title}
        </h2>
        {description && <p className="mt-1 text-xs text-(--color-muted)">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const toneClass: Record<string, string> = {
  neutral: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
  accent: 'border-(--color-accent)/30 bg-(--color-accent-soft) text-(--color-accent)',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
};

export function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClass;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--color-muted)">
          {label}
        </div>
        <div
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
            tone === 'success' && 'text-emerald-600',
            tone === 'warning' && 'text-amber-600',
            tone === 'danger' && 'text-red-600',
            tone === 'info' && 'text-blue-600',
            tone === 'accent' && 'text-(--color-accent)',
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-(--color-muted)">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center justify-center gap-2 p-8 text-center">
        {icon && <div className="text-(--color-muted) opacity-70">{icon}</div>}
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="max-w-md text-xs leading-5 text-(--color-muted)">{description}</div>}
        {action && <div className="mt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}

export function FieldGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function SelectControl({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-(--color-border) bg-(--color-card) px-3 text-sm shadow-sm transition-[border-color,box-shadow,background-color] focus-visible:border-(--color-accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}


import * as React from 'react';
import { cn } from '~/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-1 text-sm shadow-sm transition-[border-color,box-shadow,background-color]',
        'placeholder:text-(--color-muted)',
        'focus-visible:border-(--color-accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

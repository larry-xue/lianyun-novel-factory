import * as React from 'react';
import { cn } from '~/lib/cn';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-32 w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow,background-color]',
      'placeholder:text-(--color-muted)',
      'focus-visible:border-(--color-accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/20',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'font-mono leading-relaxed',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export function Chip({ children, className, mono, ...rest }: HTMLAttributes<HTMLSpanElement> & { mono?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-1 text-xs text-[var(--color-ink-1)]',
        mono && 'chip-mono',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
}

export function ChipButton({ active, icon, className, children, ...rest }: ChipButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-[var(--color-amber-400)]/40 bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]'
          : 'border-[var(--color-hairline)] bg-[var(--color-bg-2)] text-[var(--color-ink-1)] hover:bg-[var(--color-bg-3)] hover:text-[var(--color-ink-0)]',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

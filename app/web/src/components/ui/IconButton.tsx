import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'size-7', md: 'size-9', lg: 'size-11' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, active, size = 'md', className, ...rest }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg transition-all duration-150 active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-amber-400)]',
        sizes[size],
        active ? 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-400)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)] hover:bg-white/6',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  ),
);
IconButton.displayName = 'IconButton';

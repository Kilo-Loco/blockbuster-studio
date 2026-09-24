import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-amber-400)] text-black hover:bg-[var(--color-amber-300)] active:bg-[var(--color-amber-500)] shadow-[0_1px_0_rgb(255_255_255_/_0.25)_inset]',
  secondary: 'bg-[var(--color-bg-2)] text-[var(--color-ink-0)] hover:bg-[var(--color-bg-3)] border border-[var(--color-hairline)]',
  ghost: 'bg-transparent text-[var(--color-ink-1)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
  danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 border border-[var(--color-danger)]/30',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-amber-400)]',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="size-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

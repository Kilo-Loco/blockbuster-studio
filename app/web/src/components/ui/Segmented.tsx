import { clsx } from 'clsx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  compact = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  /** Phones: options with an icon show only the icon unless selected. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      // Scrolls sideways instead of overflowing when a narrow screen can't fit every option.
      className={clsx('inline-flex max-w-full shrink-0 overflow-x-auto rounded-lg bg-[var(--color-bg-2)] border border-[var(--color-hairline)] p-0.5 [scrollbar-width:none]', className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          disabled={opt.disabled}
          title={opt.title ?? (compact ? opt.label : undefined)}
          aria-label={opt.label}
          onClick={() => !opt.disabled && onChange(opt.value)}
          className={clsx(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            opt.disabled
              ? 'cursor-not-allowed text-[var(--color-ink-3)]'
              : value === opt.value
                ? 'bg-[var(--color-bg-3)] text-[var(--color-ink-0)] shadow-sm'
                : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
          )}
        >
          {opt.icon}
          <span className={clsx(compact && opt.icon && value !== opt.value && 'hidden sm:inline')}>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

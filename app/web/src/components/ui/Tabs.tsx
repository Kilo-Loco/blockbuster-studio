import { clsx } from 'clsx';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    // Scrolls sideways on narrow screens instead of spilling off the edge.
    <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-hairline)] [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4',
            value === t.value ? 'text-[var(--color-ink-0)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
          )}
        >
          {t.label}
          {value === t.value && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--color-amber-400)]" />}
        </button>
      ))}
    </div>
  );
}

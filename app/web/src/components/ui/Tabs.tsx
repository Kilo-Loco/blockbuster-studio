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
    <div role="tablist" className="flex items-center gap-1 border-b border-[var(--color-hairline)]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'relative px-4 py-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'text-[var(--color-ink-0)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
          )}
        >
          {t.label}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--color-amber-400)]" />}
        </button>
      ))}
    </div>
  );
}

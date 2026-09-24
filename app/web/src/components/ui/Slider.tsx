import { clsx } from 'clsx';

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  formatValue,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={clsx('w-full', className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-ink-2)]">
          <span>{label}</span>
          <span className="chip-mono text-[var(--color-ink-1)]">{formatValue ? formatValue(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-amber-400)] h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--color-amber-400) ${pct}%, var(--color-bg-3) ${pct}%)`,
        }}
      />
    </div>
  );
}

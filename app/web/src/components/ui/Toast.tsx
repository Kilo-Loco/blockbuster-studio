import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToastStore } from '../../lib/store';
import { clsx } from 'clsx';

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[340px] max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            'flex items-start gap-2.5 rounded-xl border border-[var(--color-hairline)] glass-panel px-4 py-3 shadow-xl animate-in slide-in-from-bottom-2 fade-in duration-200',
          )}
        >
          {t.variant === 'success' ? (
            <CheckCircle2 className="size-4 shrink-0 text-[var(--color-success)] mt-0.5" />
          ) : t.variant === 'error' ? (
            <XCircle className="size-4 shrink-0 text-[var(--color-danger)] mt-0.5" />
          ) : (
            <Info className="size-4 shrink-0 text-[var(--color-amber-400)] mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-ink-0)]">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-[var(--color-ink-2)]">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 text-[var(--color-ink-3)] hover:text-[var(--color-ink-0)]">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

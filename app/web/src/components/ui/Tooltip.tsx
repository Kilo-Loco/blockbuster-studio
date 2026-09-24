import { useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' }) {
  const [show, setShow] = useState(false);
  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  };
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      {children}
      {show && (
        <span
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-3)] px-2 py-1 text-xs text-[var(--color-ink-0)] shadow-lg',
            sideClasses[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

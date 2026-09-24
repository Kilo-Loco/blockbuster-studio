import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

export function Popover({
  trigger,
  children,
  align = 'start',
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (props: { onClick: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  className?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + 8;
    let left = rect.left;
    if (align === 'end') left = rect.right;
    if (align === 'center') left = rect.left + rect.width / 2;
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <>
      {trigger({ onClick: () => setOpen(!open), ref: triggerRef })}
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{
              position: 'fixed',
              top: pos.top,
              left: align === 'end' ? undefined : align === 'center' ? pos.left : pos.left,
              right: align === 'end' ? window.innerWidth - pos.left : undefined,
              transform: align === 'center' ? 'translateX(-50%)' : undefined,
            }}
            className={clsx(
              'z-50 rounded-xl border border-[var(--color-hairline)] glass-panel shadow-2xl animate-in fade-in zoom-in-95 duration-150',
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

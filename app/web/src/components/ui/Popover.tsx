import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  // Measure the rendered panel, then keep it on screen: below the trigger, or above it when the
  // bottom has no room (the composer sits at the bottom), and clamped to the viewport sideways.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const rect = trigger.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const m = 8;
      let left = align === 'end' ? rect.right - w : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.left;
      left = Math.max(m, Math.min(left, vw - w - m));
      let top = rect.bottom + m;
      if (top + h > vh - m) top = rect.top - m - h >= m ? rect.top - m - h : Math.max(m, vh - m - h);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
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
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? undefined : 'hidden',
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'calc(100dvh - 16px)',
              overflowY: 'auto',
            }}
            className={clsx(
              'z-50 rounded-xl border border-[var(--color-hairline)] glass-panel shadow-2xl animate-in fade-in zoom-in-95 duration-150 [&>*]:max-w-full',
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

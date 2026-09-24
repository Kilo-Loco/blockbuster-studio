import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Focus trapping + Esc-to-close for dialogs/sheets/popovers. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  // Callers usually pass an inline onClose; keep the latest one in a ref so the effect below runs
  // only when the dialog opens/closes. (Depending on onClose re-ran it on every keystroke, which
  // stole focus from inputs and moved it to the first button — the close X.)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      el?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ) ?? [];

    // Prefer the first form field (what the user wants to type into), then any focusable element.
    const all = Array.from(focusables());
    const firstField = all.find((n) => n.matches('input:not([type=hidden]), textarea, select'));
    if (!el?.contains(document.activeElement)) (firstField ?? all[0] ?? el)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(focusables());
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      prevFocus?.focus?.();
    };
  }, [active, ref]);
}

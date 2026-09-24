import { useEffect, useRef } from 'react';

/**
 * Returns a stable debounced version of `fn`. Any pending call is flushed on unmount so the
 * last edit before navigating away is not silently dropped.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<A | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (lastArgs.current) fnRef.current(...lastArgs.current);
      }
    },
    [],
  );

  return (...args: A) => {
    lastArgs.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current(...args);
    }, delayMs);
  };
}

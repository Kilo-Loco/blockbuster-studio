// Server-sent events bus. Every connected client receives every ServerEvent.
import type { ServerEvent } from '../shared/types';

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: ServerEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // a bad listener shouldn't break the others
    }
  }
}

export function clientCount(): number {
  return listeners.size;
}

/** Format one SSE frame. */
export function frame(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Single EventSource to /api/events with reconnect/backoff; dispatches into react-query caches
// and zustand stores. Falls back to polling /api/jobs?active=1 every 3s if SSE drops.
import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvent } from '@shared/types';
import { api } from './api';
import { useJobsStore, useUIStore } from './store';

let started = false;
let es: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let backoffMs = 1000;

function handleEvent(qc: QueryClient, evt: ServerEvent) {
  switch (evt.type) {
    case 'job': {
      useJobsStore.getState().upsert(evt.job);
      qc.setQueryData(['jobs', 'active'], (old: unknown) => old); // signal listeners; components refetch via invalidate
      qc.invalidateQueries({ queryKey: ['jobs'] });
      if (evt.job.status === 'done') {
        qc.invalidateQueries({ queryKey: ['assets'] });
        if (evt.job.projectId) qc.invalidateQueries({ queryKey: ['project', evt.job.projectId] });
      }
      break;
    }
    case 'asset': {
      qc.invalidateQueries({ queryKey: ['assets'] });
      break;
    }
    case 'asset_deleted': {
      qc.invalidateQueries({ queryKey: ['assets'] });
      break;
    }
    case 'shot': {
      qc.invalidateQueries({ queryKey: ['project', evt.shot.sceneId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'project' });
      break;
    }
    case 'location': {
      qc.invalidateQueries({ queryKey: ['locations'] });
      qc.invalidateQueries({ queryKey: ['location', evt.location.id] });
      break;
    }
    case 'character': {
      qc.invalidateQueries({ queryKey: ['characters'] });
      break;
    }
    case 'lora': {
      qc.invalidateQueries({ queryKey: ['loras'] });
      break;
    }
    case 'models':
    case 'system': {
      qc.invalidateQueries({ queryKey: ['system'] });
      break;
    }
    case 'ping':
    default:
      break;
  }
}

function startPolling(qc: QueryClient) {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const jobs = await api.jobs({ active: true });
      useJobsStore.getState().setAll(jobs);
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch {
      /* ignore transient errors while polling */
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function startEventStream(qc: QueryClient) {
  if (started) return;
  started = true;
  connect(qc);
}

function connect(qc: QueryClient) {
  try {
    es = new EventSource('/api/events', { withCredentials: true });
  } catch {
    startPolling(qc);
    return;
  }
  es.onopen = () => {
    backoffMs = 1000;
    useUIStore.getState().setConnectionOk(true);
    stopPolling();
  };
  es.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data) as ServerEvent;
      handleEvent(qc, evt);
    } catch {
      /* ignore malformed event */
    }
  };
  es.onerror = () => {
    useUIStore.getState().setConnectionOk(false);
    es?.close();
    es = null;
    startPolling(qc);
    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 1.7, 20_000);
      connect(qc);
    }, backoffMs);
  };
}

export function stopEventStream() {
  es?.close();
  es = null;
  stopPolling();
  started = false;
}

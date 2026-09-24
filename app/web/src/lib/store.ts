import { create } from 'zustand';
import type { Asset, EngineId, GenerateRequest, ID, Job } from '@shared/types';

// ───────────────────────────── Toasts ─────────────────────────────

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(t: Omit<Toast, 'id'>) {
  useToastStore.getState().push(t);
}

// ───────────────────────────── Jobs (live via SSE) ─────────────────────────────

interface JobsState {
  jobs: Record<ID, Job>;
  upsert: (job: Job) => void;
  setAll: (jobs: Job[]) => void;
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: {},
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  setAll: (jobs) => set(() => ({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])) })),
}));

// ───────────────────────────── Queue drawer ─────────────────────────────

interface UIState {
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
  connectionOk: boolean;
  setConnectionOk: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  queueOpen: false,
  setQueueOpen: (v) => set({ queueOpen: v }),
  connectionOk: true,
  setConnectionOk: (v) => set({ connectionOk: v }),
}));

// ───────────────────────────── Composer (Create page) ─────────────────────────────

export type ComposerMode = 'image' | 'video' | 'edit' | 'angles';

export interface ComposerState {
  mode: ComposerMode;
  prompt: string;
  engine: EngineId;
  aspect: GenerateRequest['aspect'];
  count: number;
  durationSec: number;
  quality: 'fast' | 'hd';
  cameraMove: GenerateRequest['cameraMove'];
  seed?: number;
  seedLocked: boolean;
  loras: NonNullable<GenerateRequest['loras']>;
  refs: Asset[];
  angle: { azimuth: string; elevation: string; distance: string };
  setMode: (m: ComposerMode) => void;
  setPrompt: (p: string) => void;
  set: (patch: Partial<ComposerState>) => void;
  addRef: (a: Asset) => void;
  removeRef: (id: ID) => void;
  clearRefs: () => void;
  reset: () => void;
  prefillFromAsset: (a: Asset, mode: ComposerMode) => void;
}

const defaults = {
  mode: 'image' as ComposerMode,
  prompt: '',
  engine: 'zimage' as EngineId,
  aspect: '16:9' as GenerateRequest['aspect'],
  count: 1,
  durationSec: 5,
  quality: 'fast' as const,
  cameraMove: 'static' as GenerateRequest['cameraMove'],
  seed: undefined,
  seedLocked: false,
  loras: [] as NonNullable<GenerateRequest['loras']>,
  refs: [] as Asset[],
  angle: { azimuth: 'front-right quarter view', elevation: 'eye-level shot', distance: 'medium shot' },
};

export const useComposerStore = create<ComposerState>((set) => ({
  ...defaults,
  setMode: (mode) => set({ mode }),
  setPrompt: (prompt) => set({ prompt }),
  set: (patch) => set(patch),
  addRef: (a) =>
    set((s) => {
      const max = s.mode === 'edit' ? 3 : 1;
      if (s.refs.find((r) => r.id === a.id)) return s;
      const refs = s.mode === 'edit' ? [...s.refs, a].slice(0, max) : [a];
      return { refs };
    }),
  removeRef: (id) => set((s) => ({ refs: s.refs.filter((r) => r.id !== id) })),
  clearRefs: () => set({ refs: [] }),
  reset: () => set({ ...defaults }),
  prefillFromAsset: (a, mode) =>
    set({
      mode,
      refs: [a],
      prompt: mode === 'video' ? '' : a.prompt ?? '',
      aspect: (a.params as { aspect?: GenerateRequest['aspect'] } | undefined)?.aspect ?? defaults.aspect,
    }),
}));

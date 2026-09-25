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

export type ComposerMode = 'image' | 'video' | 'edit' | 'angles' | 'perform';

export interface ComposerState {
  mode: ComposerMode;
  prompt: string;
  motionPrompt: string;
  /** Perform: appearance text for the chosen character (set when picked from Cast). */
  characterPrompt: string;
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
  /** Perform mode only: the recorded/uploaded clip of the person performing. */
  performanceAsset?: Asset;
  /** Perform mode only: the character reference image. */
  characterAsset?: Asset;
  angle: { azimuth: string; elevation: string; distance: string };
  setMode: (m: ComposerMode) => void;
  setPrompt: (p: string) => void;
  set: (patch: Partial<ComposerState>) => void;
  addRef: (a: Asset) => void;
  removeRef: (id: ID) => void;
  clearRefs: () => void;
  setPerformanceAsset: (a: Asset | undefined) => void;
  setCharacterAsset: (a: Asset | undefined) => void;
  reset: () => void;
  prefillFromAsset: (a: Asset, mode: ComposerMode) => void;
  /** Switch to Perform mode and drop an asset into one slot, leaving the other slot untouched. */
  prefillPerformSlot: (a: Asset, slot: 'performance' | 'character') => void;
}

const defaults = {
  mode: 'image' as ComposerMode,
  prompt: '',
  motionPrompt: '',
  characterPrompt: '',
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
  performanceAsset: undefined as Asset | undefined,
  characterAsset: undefined as Asset | undefined,
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
  setPerformanceAsset: (a) =>
    set(() => ({
      performanceAsset: a,
      // Portrait recording → default to 9:16, otherwise 16:9 (spec default for Perform mode).
      ...(a ? { aspect: a.height > a.width ? ('9:16' as const) : ('16:9' as const) } : {}),
    })),
  setCharacterAsset: (a) => set({ characterAsset: a, characterPrompt: '' }),
  reset: () => set({ ...defaults }),
  prefillFromAsset: (a, mode) =>
    set({
      mode,
      refs: [a],
      prompt: mode === 'video' ? '' : a.prompt ?? '',
      aspect: (a.params as { aspect?: GenerateRequest['aspect'] } | undefined)?.aspect ?? defaults.aspect,
    }),
  prefillPerformSlot: (a, slot) =>
    set((s) => ({
      mode: 'perform',
      performanceAsset: slot === 'performance' ? a : s.performanceAsset,
      characterAsset: slot === 'character' ? a : s.characterAsset,
      aspect: slot === 'performance' ? (a.height > a.width ? ('9:16' as const) : ('16:9' as const)) : s.aspect,
    })),
}));

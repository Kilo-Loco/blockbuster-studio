import type { Character, CharacterMark, LocationMap, Scene, Shot } from '@shared/types';
import { CHARACTER_COLORS } from '@shared/presets';
import { completeBlocking, defaultLocationMap } from '@shared/camera';

export function characterColor(character: Character | undefined, index: number): string {
  return character?.color || CHARACTER_COLORS[index % CHARACTER_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Effective blocking for a shot: its own override if set, else the scene default, filtered to the shot's cast. */
/** The shot's marks, with default spots for cast members the scene's blocking doesn't place (as the server does). */
export function effectiveBlocking(shot: Shot, scene: Scene, map: LocationMap = defaultLocationMap()): CharacterMark[] {
  return completeBlocking(shot.blocking ?? scene.blocking, shot.characterIds, map);
}

export const STATUS_LABEL: Record<Shot['status'], string> = {
  draft: 'Draft',
  keyframe_queued: 'Keyframe…',
  keyframe_ready: 'Keyframe ready',
  video_queued: 'Video…',
  video_ready: 'Video ready',
  error: 'Error',
};

export interface PrevisWindow {
  start: number;
  duration: number;
}

/** Mirrors the server's previsShotWindows (server/pipeline/previs.ts): one [start, duration] window per shot,
 *  from the scene's previsCuts when it matches the shot count, else shots laid back to back by durationSec. */
export function previsShotWindows(shots: Shot[], previsCuts: number[] | undefined, previsDurationSec?: number): PrevisWindow[] {
  if (!shots.length) return [];
  if (previsCuts && previsCuts.length === shots.length - 1) {
    const lastFallback = previsCuts[previsCuts.length - 1]! + Math.max(0.1, shots[shots.length - 1]!.durationSec);
    const bounds = [0, ...previsCuts, previsDurationSec ?? lastFallback];
    return shots.map((_s, i) => ({ start: bounds[i]!, duration: Math.max(0.1, bounds[i + 1]! - bounds[i]!) }));
  }
  let acc = 0;
  return shots.map((s) => {
    const start = acc;
    acc += s.durationSec;
    return { start, duration: s.durationSec };
  });
}

/** Parses the "3.0, 5.0, 7.5" cuts text field into numbers, or undefined if empty/invalid. */
export function parseCutsInput(text: string): number[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(',').map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  for (let i = 1; i < parts.length; i++) if (parts[i]! < parts[i - 1]!) return undefined;
  return parts;
}

/** Mirrors the server's previsCutsFromSequences (server/pipeline/previs.ts): converts the Blender previs
 *  skill's sequences.json ({ shots: [{ start_s, end_s }, …] }) into the interior cut points previsCuts wants. */
export function previsCutsFromSequences(sequences: unknown): number[] | undefined {
  const shots = (sequences as { shots?: unknown })?.shots;
  if (!Array.isArray(shots) || shots.length < 2) return undefined;
  const starts = shots
    .slice(1)
    .map((s) => (s as { start_s?: unknown })?.start_s)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return starts.length === shots.length - 1 ? starts : undefined;
}

export const STATUS_COLOR: Record<Shot['status'], string> = {
  draft: 'bg-[var(--color-ink-3)]/20 text-[var(--color-ink-2)]',
  keyframe_queued: 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]',
  keyframe_ready: 'bg-[var(--color-amber-400)]/20 text-[var(--color-amber-300)]',
  video_queued: 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]',
  video_ready: 'bg-[var(--color-success)]/20 text-[var(--color-success)]',
  error: 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]',
};

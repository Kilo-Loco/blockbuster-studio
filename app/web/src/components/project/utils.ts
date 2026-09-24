import type { Character, CharacterMark, Scene, Shot } from '@shared/types';
import { CHARACTER_COLORS } from '@shared/presets';

export function characterColor(character: Character | undefined, index: number): string {
  return character?.color || CHARACTER_COLORS[index % CHARACTER_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Effective blocking for a shot: its own override if set, else the scene default, filtered to the shot's cast. */
export function effectiveBlocking(shot: Shot, scene: Scene): CharacterMark[] {
  const marks = shot.blocking ?? scene.blocking;
  return marks.filter((m) => shot.characterIds.includes(m.characterId));
}

export const STATUS_LABEL: Record<Shot['status'], string> = {
  draft: 'Draft',
  keyframe_queued: 'Keyframe…',
  keyframe_ready: 'Keyframe ready',
  video_queued: 'Video…',
  video_ready: 'Video ready',
  error: 'Error',
};

export const STATUS_COLOR: Record<Shot['status'], string> = {
  draft: 'bg-[var(--color-ink-3)]/20 text-[var(--color-ink-2)]',
  keyframe_queued: 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]',
  keyframe_ready: 'bg-[var(--color-amber-400)]/20 text-[var(--color-amber-300)]',
  video_queued: 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]',
  video_ready: 'bg-[var(--color-success)]/20 text-[var(--color-success)]',
  error: 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]',
};

// Shared parser for a Blender previs skill's sequences.json, used by both the server (previs import,
// scene-previs render windows) and the web client (the Previs step's file import). Keep this file free of
// runtime imports so both sides can use it (see types.ts).
//
// Our Blender skill writes { fps, sequences: [ { name, file, film_start_s, film_end_s, shots: [ { shot, name,
// beat, camera, start_s, end_s, ... } ] } ] }, with each shot's start_s/end_s relative to its own sequence.
// An older, flatter shape ({ shots: [...] } at the top level) is also accepted.

export interface PrevisSequenceShot {
  name: string;
  beat?: string;
  startSec: number;
  endSec: number;
}

export interface PrevisSequence {
  name: string;
  file?: string;
  shots: PrevisSequenceShot[];
}

function toShot(raw: unknown): PrevisSequenceShot | undefined {
  const r = raw as { name?: unknown; shot?: unknown; beat?: unknown; start_s?: unknown; end_s?: unknown };
  const startSec = r?.start_s;
  const endSec = r?.end_s;
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || typeof endSec !== 'number' || !Number.isFinite(endSec)) return undefined;
  const name = typeof r.name === 'string' && r.name ? r.name : typeof r.shot === 'number' ? `Shot ${r.shot}` : 'Shot';
  const beat = typeof r.beat === 'string' && r.beat ? r.beat : undefined;
  return { name, beat, startSec, endSec };
}

function toSequence(raw: unknown, fallbackName: string): PrevisSequence | undefined {
  const r = raw as { name?: unknown; file?: unknown; shots?: unknown };
  if (!Array.isArray(r?.shots) || r.shots.length === 0) return undefined;
  const shots = r.shots.map(toShot).filter((s): s is PrevisSequenceShot => Boolean(s));
  if (!shots.length) return undefined;
  const name = typeof r.name === 'string' && r.name ? r.name : fallbackName;
  const file = typeof r.file === 'string' && r.file ? r.file : undefined;
  return { name, file, shots };
}

/** Reads a previs sequences.json: our Blender skill's { sequences: [{ shots: [{ start_s, end_s, name, beat
 *  }] }] } and the older flat { shots: [...] }. Shot times are relative to their sequence. undefined if
 *  unreadable (not an object, no usable sequence, or no shots with numeric start_s/end_s). */
export function parsePrevisSequences(json: unknown): PrevisSequence[] | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const obj = json as { sequences?: unknown; shots?: unknown };
  if (Array.isArray(obj.sequences) && obj.sequences.length) {
    const sequences = obj.sequences.map((s, i) => toSequence(s, `Sequence ${i + 1}`)).filter((s): s is PrevisSequence => Boolean(s));
    return sequences.length ? sequences : undefined;
  }
  // Older flat shape: the whole document is one sequence.
  const single = toSequence(obj, 'Sequence 1');
  return single ? [single] : undefined;
}

/** Cut times in seconds: the start of every shot after the first (interior boundaries), the shape Scene.
 *  previsCuts wants. Needs at least 2 shots; otherwise undefined (nothing to cut). */
export function previsCutsFromShots(shots: PrevisSequenceShot[]): number[] | undefined {
  if (shots.length < 2) return undefined;
  return shots.slice(1).map((s) => s.startSec);
}

/** Back-compat thin wrapper over parsePrevisSequences + previsCutsFromShots, for callers that only want the
 *  first sequence's interior cut points (the previous, single-sequence-only shape of this function). */
export function previsCutsFromSequences(json: unknown): number[] | undefined {
  const sequences = parsePrevisSequences(json);
  const shots = sequences?.[0]?.shots;
  return shots ? previsCutsFromShots(shots) : undefined;
}

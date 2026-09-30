import { describe, expect, it } from 'vitest';
import { parsePrevisSequences, previsCutsFromSequences, previsCutsFromShots } from './previs';

// The real Coast Road previs sequences.json (see docs/plans/guided_flow_spec.md "Example sequences.json"),
// trimmed to the fields the parser reads.
const coastRoad = {
  film: 'COAST ROAD',
  fps: 24,
  sequences: [
    {
      name: 'seq',
      file: 'seq.mp4',
      film_start_s: 0.0,
      film_end_s: 10.0,
      duration_s: 10.0,
      shots: [
        { shot: 1, name: 'Aerial', beat: 'establish: the car on the cliff road', start_s: 0.0, end_s: 3.0 },
        { shot: 2, name: 'Close on driver', beat: 'she grips the wheel', start_s: 3.0, end_s: 5.0 },
        { shot: 3, name: 'Wide', beat: 'the road curves ahead', start_s: 5.0, end_s: 7.5 },
        { shot: 4, name: 'Reverse', beat: 'the ocean behind her', start_s: 7.5, end_s: 10.0 },
      ],
    },
  ],
};

describe('parsePrevisSequences (Blender previs skill sequences.json)', () => {
  it('reads the real Blender skill shape ({ sequences: [{ shots: [...] }] }), times relative to the sequence', () => {
    const sequences = parsePrevisSequences(coastRoad);
    expect(sequences).toHaveLength(1);
    const [seq] = sequences!;
    expect(seq!.name).toBe('seq');
    expect(seq!.file).toBe('seq.mp4');
    expect(seq!.shots).toEqual([
      { name: 'Aerial', beat: 'establish: the car on the cliff road', startSec: 0, endSec: 3 },
      { name: 'Close on driver', beat: 'she grips the wheel', startSec: 3, endSec: 5 },
      { name: 'Wide', beat: 'the road curves ahead', startSec: 5, endSec: 7.5 },
      { name: 'Reverse', beat: 'the ocean behind her', startSec: 7.5, endSec: 10 },
    ]);
  });

  it('reads several sequences', () => {
    const two = { sequences: [coastRoad.sequences[0], { name: 'seq2', file: 'seq2.mp4', shots: [{ start_s: 0, end_s: 2 }, { start_s: 2, end_s: 4 }] }] };
    const sequences = parsePrevisSequences(two);
    expect(sequences).toHaveLength(2);
    expect(sequences![1]!.name).toBe('seq2');
    expect(sequences![1]!.shots).toHaveLength(2);
  });

  it('reads the older flat shape ({ shots: [...] } at the top level)', () => {
    const flat = { shots: [{ start_s: 0, end_s: 3, name: 'A' }, { start_s: 3, end_s: 7.5, name: 'B' }] };
    const sequences = parsePrevisSequences(flat);
    expect(sequences).toHaveLength(1);
    expect(sequences![0]!.shots.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('returns undefined for a malformed or unreadable shape', () => {
    expect(parsePrevisSequences(null)).toBeUndefined();
    expect(parsePrevisSequences({})).toBeUndefined();
    expect(parsePrevisSequences({ sequences: [] })).toBeUndefined();
    expect(parsePrevisSequences({ shots: [{ start_s: 0 }] })).toBeUndefined(); // missing end_s
    expect(parsePrevisSequences({ sequences: [{ shots: [] }] })).toBeUndefined();
  });

  it('drops individual shots with non-numeric times but keeps the rest', () => {
    const sequences = parsePrevisSequences({ shots: [{ start_s: 0, end_s: 3 }, { name: 'bad' }, { start_s: 3, end_s: 5 }] });
    expect(sequences![0]!.shots).toHaveLength(2);
  });
});

describe('previsCutsFromShots', () => {
  it('returns the start of every shot after the first', () => {
    const shots = parsePrevisSequences(coastRoad)![0]!.shots;
    expect(previsCutsFromShots(shots)).toEqual([3, 5, 7.5]);
  });

  it('returns undefined with fewer than 2 shots', () => {
    expect(previsCutsFromShots([{ name: 'only', startSec: 0, endSec: 3 }])).toBeUndefined();
    expect(previsCutsFromShots([])).toBeUndefined();
  });
});

describe('previsCutsFromSequences (back-compat wrapper: first sequence only)', () => {
  it('extracts interior cut points from the first sequence', () => {
    expect(previsCutsFromSequences(coastRoad)).toEqual([3, 5, 7.5]);
  });

  it('works with the older flat shape', () => {
    const flat = { shots: [{ start_s: 0, end_s: 3 }, { start_s: 3, end_s: 7.5 }, { start_s: 7.5, end_s: 12 }] };
    expect(previsCutsFromSequences(flat)).toEqual([3, 7.5]);
  });

  it('returns undefined for a malformed or too-short shape', () => {
    expect(previsCutsFromSequences({ shots: [{ start_s: 0 }] })).toBeUndefined();
    expect(previsCutsFromSequences({})).toBeUndefined();
    expect(previsCutsFromSequences(null)).toBeUndefined();
    expect(previsCutsFromSequences({ shots: [{ start_s: 0 }, {}] })).toBeUndefined();
  });
});

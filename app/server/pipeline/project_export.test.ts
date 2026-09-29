// Project.grade 'film' export filter: a sane, conservative ffmpeg filter string that a real ffmpeg accepts
// (Coast Road showcase films are silent-cut-together clips; this verifies the grade step itself, not the
// whole export job, which is covered by the existing shot/keyframe integration tests).
import { describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// Isolate this test's SQLite DB from other test files / the real dev .data dir — project_export.ts's job
// runner registration touches '../db' at import time, though this test only exercises FILM_GRADE_FILTER.
const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-export-test-'));
process.env.DATA_DIR = tmpDbDir;
const { FILM_GRADE_FILTER } = await import('./project_export');

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('FILM_GRADE_FILTER (Project.grade "film")', () => {
  it('is a conservative warm/S-curve/grain pass, not an aggressive look', () => {
    expect(FILM_GRADE_FILTER).toContain('curves=');
    expect(FILM_GRADE_FILTER).toContain('eq=');
    expect(FILM_GRADE_FILTER).toContain('noise=');
    // Kept mild: contrast/saturation bumps stay under 10%, since this runs on every export shot-for-shot,
    // not a single hand-graded frame.
    const contrast = Number(/contrast=([\d.]+)/.exec(FILM_GRADE_FILTER)?.[1]);
    const saturation = Number(/saturation=([\d.]+)/.exec(FILM_GRADE_FILTER)?.[1]);
    expect(contrast).toBeGreaterThan(1);
    expect(contrast).toBeLessThan(1.15);
    expect(saturation).toBeGreaterThan(1);
    expect(saturation).toBeLessThan(1.15);
  });

  it.skipIf(!hasFfmpeg)('a real ffmpeg accepts the filter and produces a graded clip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-grade-test-'));
    const src = path.join(dir, 'in.mp4');
    const out = path.join(dir, 'out.mp4');
    try {
      await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=24:duration=1', '-pix_fmt', 'yuv420p', src]);
      await execFileAsync('ffmpeg', ['-y', '-i', src, '-vf', FILM_GRADE_FILTER, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
      expect(fs.statSync(out).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

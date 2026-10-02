import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_TOOLKIT_COMMIT, INSTALLED_FILE, cloneFailureMessage, installState } from './aiToolkit';

describe('ai-toolkit pin', () => {
  it('matches the commit the locked package list was resolved for', () => {
    const lock = fs.readFileSync(new URL('../../../docker/ai-toolkit/requirements.lock.txt', import.meta.url), 'utf8');
    expect(/^# commit: (\S+)$/m.exec(lock)?.[1]).toBe(AI_TOOLKIT_COMMIT);
  });

  it('is shipped in the image where the server looks for it', () => {
    const dockerfile = fs.readFileSync(new URL('../../../docker/Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toContain('COPY docker/ai-toolkit/requirements.lock.txt /opt/studio/config/ai-toolkit-requirements.lock.txt');
    expect(dockerfile).toContain('AI_TOOLKIT_REQUIREMENTS=/opt/studio/config/ai-toolkit-requirements.lock.txt');
    expect(dockerfile).toContain('TORCH_CONSTRAINTS=/opt/torch-constraints.txt');
  });
});

describe('installState', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  function toolkitDir({ runPy = true, venv = true, installed }: { runPy?: boolean; venv?: boolean; installed?: string }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitk-'));
    dirs.push(dir);
    if (runPy) fs.writeFileSync(path.join(dir, 'run.py'), '');
    if (venv) {
      fs.mkdirSync(path.join(dir, 'venv', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'venv', 'bin', 'python'), '');
    }
    if (installed !== undefined) fs.writeFileSync(path.join(dir, INSTALLED_FILE), installed);
    return dir;
  }

  it('is missing when nothing was installed', () => {
    expect(installState(path.join(os.tmpdir(), 'aitk-does-not-exist'))).toBe('missing');
  });

  it('is ready only once the pinned commit finished installing', () => {
    expect(installState(toolkitDir({ installed: AI_TOOLKIT_COMMIT }))).toBe('ready');
  });

  it('redoes an install that died halfway', () => {
    expect(installState(toolkitDir({}))).toBe('stale'); // pip never finished: no marker
    expect(installState(toolkitDir({ venv: false, installed: AI_TOOLKIT_COMMIT }))).toBe('stale');
  });

  it('replaces an older unpinned checkout or another commit', () => {
    expect(installState(toolkitDir({ installed: 'some-other-commit' }))).toBe('stale');
  });
});

describe('cloneFailureMessage', () => {
  it("blames the pod's network, not the URL, when GitHub is unreachable (issue #24)", () => {
    const tail = [
      "Cloning into '/workspace/ai-toolkit'...",
      "fatal: unable to access 'https://github.com/ostris/ai-toolkit/': Failed to connect to github.com port 443 after 7 ms: Couldn't connect to server",
    ];
    const message = cloneFailureMessage(tail);
    expect(message).toMatch(/^This pod can't reach github\.com/);
    expect(message).toContain('not the ai-toolkit address');
    expect(message).toContain('port 443 after 7 ms');
  });

  it('recognises DNS failures as network problems too', () => {
    expect(cloneFailureMessage(["fatal: unable to access 'https://github.com/ostris/ai-toolkit/': Could not resolve host: github.com"])).toMatch(
      /can't reach github\.com/,
    );
  });

  it('passes other git errors through without claiming a network problem', () => {
    const message = cloneFailureMessage(['fatal: remote error: upload-pack: not our ref ed36edd85b886623377beb5f50c5dd7e3b3eb89a']);
    expect(message).toMatch(/^Downloading ai-toolkit from GitHub failed:/);
    expect(message).not.toMatch(/can't reach/);
  });
});

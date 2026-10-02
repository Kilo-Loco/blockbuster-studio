import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_TOOLKIT_COMMIT, cloneFailureMessage } from './aiToolkit';

describe('ai-toolkit pin', () => {
  it('matches the commit the Docker image installs', () => {
    const dockerfile = fs.readFileSync(new URL('../../../docker/Dockerfile', import.meta.url), 'utf8');
    const pinned = /^ARG AI_TOOLKIT_COMMIT=(\S+)$/m.exec(dockerfile)?.[1];
    expect(pinned).toBe(AI_TOOLKIT_COMMIT);
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

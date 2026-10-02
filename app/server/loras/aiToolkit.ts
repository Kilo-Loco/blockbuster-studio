// Which ai-toolkit the LoRA trainer uses, whether it's installed, and how a failed download of it is explained.
// Kept apart from train.ts (which registers a queue runner on import) so it can be tested on its own.
import fs from 'node:fs';
import path from 'node:path';

/** The ai-toolkit commit the trainer runs: the newest that trains Z-Image Turbo before ai-toolkit moved to
 *  torch 2.13, so it runs on the base image's torch 2.8. docker/ai-toolkit/requirements.lock.txt is resolved
 *  for this commit (its "# commit:" line; aiToolkit.test.ts checks they match). */
export const AI_TOOLKIT_COMMIT = 'ed36edd85b886623377beb5f50c5dd7e3b3eb89a';
export const AI_TOOLKIT_REPO = 'https://github.com/ostris/ai-toolkit';

/** Written once an install finishes, holding the commit it installed. */
export const INSTALLED_FILE = '.studio-installed';

/**
 * 'ready' when this exact commit finished installing. Anything else needs a fresh install: nothing there yet, an
 * install that died halfway (no INSTALLED_FILE), or an older unpinned checkout from before the pin (or another
 * commit), which would otherwise keep running whatever ai-toolkit happened to be the day it was cloned.
 */
export function installState(dir: string): 'ready' | 'missing' | 'stale' {
  if (!fs.existsSync(dir)) return 'missing';
  let installed: string | undefined;
  try {
    installed = fs.readFileSync(path.join(dir, INSTALLED_FILE), 'utf8').trim();
  } catch {
    installed = undefined;
  }
  const complete = fs.existsSync(path.join(dir, 'run.py')) && fs.existsSync(path.join(dir, 'venv', 'bin', 'python'));
  return complete && installed === AI_TOOLKIT_COMMIT ? 'ready' : 'stale';
}

/** Lines git prints when the machine can't reach GitHub at all (as opposed to a bad URL or commit). */
const NETWORK_ERROR = /could not resolve host|failed to connect|couldn't connect|connection (timed out|refused|reset)|network is unreachable|operation timed out/i;

/** The error to show for a failed clone. A network failure says so plainly: it's the pod, not the URL. */
export function cloneFailureMessage(tail: string[]): string {
  const output = tail.join('\n');
  if (NETWORK_ERROR.test(output)) {
    return (
      "This pod can't reach github.com, so the LoRA trainer can't be installed. That's the network on this machine " +
      "(blocked outbound traffic, a proxy or DNS), not the ai-toolkit address. Training needs GitHub once, the first " +
      'time; everything else in the studio works without it. To train, deploy a new pod (it usually lands on a ' +
      'different machine) and try again.\n\n' +
      output
    );
  }
  return `Downloading ai-toolkit from GitHub failed:\n${output}`;
}

// Which ai-toolkit the LoRA trainer uses, and how a failed download of it is explained. Kept apart from
// train.ts (which registers a queue runner on import) so it can be tested on its own.

/** The ai-toolkit commit the trainer runs. The Docker image installs this same commit in /opt/ai-toolkit
 *  (AI_TOOLKIT_COMMIT in docker/Dockerfile; aiToolkit.test.ts checks they match), so on a pod the first-use install in train.ts never runs. */
export const AI_TOOLKIT_COMMIT = 'ed36edd85b886623377beb5f50c5dd7e3b3eb89a';
export const AI_TOOLKIT_REPO = 'https://github.com/ostris/ai-toolkit';

/** Lines git prints when the machine can't reach GitHub at all (as opposed to a bad URL or commit). */
const NETWORK_ERROR = /could not resolve host|failed to connect|couldn't connect|connection (timed out|refused|reset)|network is unreachable|operation timed out/i;

/** The error to show for a failed clone. A network failure says so plainly: it's the pod, not the URL. */
export function cloneFailureMessage(tail: string[]): string {
  const output = tail.join('\n');
  if (NETWORK_ERROR.test(output)) {
    return (
      "This pod can't reach github.com, so the LoRA trainer can't be installed. That's the network on this machine " +
      "(blocked outbound traffic, a proxy or DNS), not the ai-toolkit address. The studio's Docker image ships with the " +
      'trainer built in; deploy the current template image, or try a different machine.\n\n' +
      output
    );
  }
  return `Downloading ai-toolkit from GitHub failed:\n${output}`;
}

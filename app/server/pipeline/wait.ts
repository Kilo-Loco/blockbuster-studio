// Long-poll helpers so an agent can wait for jobs without holding a request past Runpod's 100 s proxy
// limit: each wait returns when the jobs are finished or after at most MAX_WAIT_SEC, whichever is first.
import { jobs as jobsRepo } from '../db';
import { subscribe } from '../events';
import type { ID, Job } from '../../shared/types';

export const MAX_WAIT_SEC = 50;

export function isTerminal(job: Job): boolean {
  return job.status === 'done' || job.status === 'error' || job.status === 'canceled';
}

/** Parse a `wait` query value into milliseconds (0 = don't wait), capped at MAX_WAIT_SEC. */
export function waitMs(raw: string | undefined): number {
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.min(sec, MAX_WAIT_SEC) * 1000;
}

/** Resolve with the jobs once every one is terminal, or with their current state after `timeoutMs`.
 *  Unknown ids are left out. Listens to the queue's events rather than polling. */
export function waitForJobs(ids: ID[], timeoutMs: number, signal?: AbortSignal): Promise<Job[]> {
  const read = () => ids.map((id) => jobsRepo.get(id)).filter((j): j is Job => Boolean(j));
  const initial = read();
  if (timeoutMs <= 0 || initial.every(isTerminal)) return Promise.resolve(initial);
  const pending = new Set(initial.filter((j) => !isTerminal(j)).map((j) => j.id));
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', finish);
      resolve(read());
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = subscribe((event) => {
      if (event.type !== 'job' || !pending.has(event.job.id) || !isTerminal(event.job)) return;
      pending.delete(event.job.id);
      if (pending.size === 0) finish();
    });
    signal?.addEventListener('abort', finish);
    // A job may have finished between the first read and subscribing.
    if (read().every(isTerminal)) finish();
  });
}

/** Where an agent polls a job: returned with every job-creating response. */
export function statusUrl(id: ID): string {
  return `/api/jobs/${id}?wait=${MAX_WAIT_SEC}`;
}

export function withStatusUrl(job: Job): Job & { statusUrl: string } {
  return { ...job, statusUrl: statusUrl(job.id) };
}

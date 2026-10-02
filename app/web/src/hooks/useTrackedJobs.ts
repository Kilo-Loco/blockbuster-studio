import { useEffect, useRef, useState } from 'react';
import type { ID, Job } from '@shared/types';
import { useJobsStore } from '../lib/store';

const finished = (job: Job | undefined) => job?.status === 'done' || job?.status === 'error';

/**
 * Follows any number of jobs started from one screen, so a new render can be queued while
 * earlier ones are still running. Calls onDone / onError once per job as each one finishes.
 */
export function useTrackedJobs(handlers: { onDone?: (job: Job) => void; onError?: (job: Job) => void }) {
  const [ids, setIds] = useState<ID[]>([]);
  const jobs = useJobsStore((s) => s.jobs);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const done = ids.filter((id) => finished(jobs[id]));
    if (done.length === 0) return;
    for (const id of done) {
      const job = jobs[id];
      if (job.status === 'done') handlersRef.current.onDone?.(job);
      else handlersRef.current.onError?.(job);
    }
    setIds((prev) => prev.filter((id) => !done.includes(id)));
  }, [ids, jobs]);

  return {
    /** Jobs still queued or running, oldest first. */
    active: ids.map((id) => jobs[id]).filter((job): job is Job => !!job && !finished(job)),
    track: (job: Job) => {
      useJobsStore.getState().upsert(job);
      setIds((prev) => [...prev, job.id]);
    },
  };
}

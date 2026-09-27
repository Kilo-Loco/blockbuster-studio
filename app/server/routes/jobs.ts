import { Hono } from 'hono';
import { jobs as jobsRepo } from '../db';
import { cancel, enqueue, retry } from '../pipeline/queue';
import { enhancePrompt } from '../ai/breakdown';
import type { GenerateRequest } from '../../shared/types';
import { waitForJobs, waitMs, withStatusUrl } from '../pipeline/wait';

export const jobsRoutes = new Hono();

jobsRoutes.post('/api/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as GenerateRequest;
  if (!body.engine || !body.aspect) return c.json({ error: 'missing engine/aspect' }, 400);
  const job = enqueue({
    type: 'generate',
    title: `${body.engine}: ${body.prompt.slice(0, 60)}`,
    params: { ...body, count: Math.max(1, Math.min(4, body.count || 1)) },
    projectId: body.projectId,
    shotId: body.shotId,
  });
  return c.json(withStatusUrl(job), 202);
});

// ?ids=a,b,c returns those jobs; with &wait=<s> it holds until all are finished or up to 50 s.
jobsRoutes.get('/api/jobs', async (c) => {
  const ids = c.req.query('ids');
  if (ids) {
    const list = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const jobs = await waitForJobs(list, waitMs(c.req.query('wait')), c.req.raw.signal);
    return c.json(jobs);
  }
  const active = c.req.query('active') === '1';
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  return c.json(jobsRepo.list({ active, limit }));
});

// ?wait=<s> holds the request until the job is finished or up to 50 s (Runpod's proxy cuts at 100 s).
jobsRoutes.get('/api/jobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!jobsRepo.get(id)) return c.json({ error: 'not found' }, 404);
  const [job] = await waitForJobs([id], waitMs(c.req.query('wait')), c.req.raw.signal);
  return c.json(job);
});

jobsRoutes.post('/api/jobs/:id/cancel', (c) => {
  const job = cancel(c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json(job);
});

jobsRoutes.post('/api/jobs/:id/retry', (c) => {
  const job = retry(c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json(withStatusUrl(job), 202);
});

jobsRoutes.post('/api/ai/enhance', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.prompt || (body.target !== 'image' && body.target !== 'video')) {
    return c.json({ error: 'missing prompt/target' }, 400);
  }
  try {
    const prompt = await enhancePrompt({ prompt: body.prompt, target: body.target });
    return c.json({ prompt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'LLM not configured' ? 400 : 500;
    return c.json({ error: message }, status);
  }
});

import { Hono } from 'hono';
import { jobs as jobsRepo } from '../db';
import { cancel, enqueue, retry } from '../pipeline/queue';
import { assertPromptsAllowed } from '../pipeline/guard';
import { enhancePrompt } from '../ai/breakdown';
import type { GenerateRequest } from '../../shared/types';

export const jobsRoutes = new Hono();

jobsRoutes.post('/api/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as GenerateRequest;
  if (!body.engine || !body.aspect) return c.json({ error: 'missing engine/aspect' }, 400);
  assertPromptsAllowed(body.prompt, body.negativePrompt);
  const job = enqueue({
    type: 'generate',
    title: `${body.engine}: ${body.prompt.slice(0, 60)}`,
    params: { ...body, count: Math.max(1, Math.min(4, body.count || 1)) },
    projectId: body.projectId,
    shotId: body.shotId,
  });
  return c.json(job);
});

jobsRoutes.get('/api/jobs', (c) => {
  const active = c.req.query('active') === '1';
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  return c.json(jobsRepo.list({ active, limit }));
});

jobsRoutes.get('/api/jobs/:id', (c) => {
  const job = jobsRepo.get(c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
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
  return c.json(job);
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

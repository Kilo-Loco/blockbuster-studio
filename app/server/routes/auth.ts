import { Hono } from 'hono';
import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  claimPassword,
  clearSessionCookie,
  isAuthenticated,
  isClaimed,
  rateLimited,
  setSessionCookie,
  setupOpen,
} from '../auth';

export const authRoutes = new Hono();

authRoutes.post('/api/login', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'local';
  if (rateLimited(ip)) return c.json({ error: 'too many attempts, try again later' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!checkPassword(password)) return c.json({ error: 'incorrect password' }, 401);
  setSessionCookie(c);
  return c.json({ ok: true });
});

// First-visit setup: only while the studio is unclaimed and inside the setup window.
authRoutes.post('/api/setup', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'local';
  if (rateLimited(ip)) return c.json({ error: 'too many attempts, try again later' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const result = claimPassword(typeof body?.password === 'string' ? body.password : '');
  if (result === 'too-short') return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  if (result === 'claimed') return c.json({ error: 'This studio already has a password.' }, 409);
  if (result === 'closed') return c.json({ error: 'Setup has closed. Restart the pod to reopen it.' }, 403);
  setSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/api/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/api/session', async (c) => {
  const claimed = isClaimed();
  return c.json({ authenticated: isAuthenticated(c), claimed, setupOpen: setupOpen() });
});

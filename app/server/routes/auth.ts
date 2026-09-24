import { Hono } from 'hono';
import { checkPassword, clearSessionCookie, isAuthenticated, rateLimited, setSessionCookie } from '../auth';

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

authRoutes.post('/api/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/api/session', async (c) => {
  return c.json({ authenticated: isAuthenticated(c) });
});

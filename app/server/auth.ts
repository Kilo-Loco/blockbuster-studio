// Password login + HMAC-signed session cookie.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { DATA_DIR, SESSION_SECRET, STUDIO_PASSWORD } from './config';

const COOKIE_NAME = 'bb_session';
const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

const WORDS = [
  'amber', 'anchor', 'atlas', 'birch', 'blaze', 'canyon', 'cedar', 'comet', 'coral', 'crest',
  'delta', 'ember', 'falcon', 'forge', 'glacier', 'harbor', 'hazel', 'indigo', 'ivory', 'jasper',
  'kestrel', 'lagoon', 'lumen', 'maple', 'marble', 'meadow', 'nebula', 'onyx', 'opal', 'orchid',
  'pebble', 'quartz', 'raven', 'ridge', 'river', 'rowan', 'saffron', 'sable', 'sequoia', 'slate',
  'summit', 'tiger', 'tundra', 'umber', 'velvet', 'willow', 'zephyr',
];

function generatePassword(): string {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  const digits = crypto.randomInt(1000, 9999);
  return `${pick()}-${pick()}-${digits}`;
}

function resolvePassword(): string {
  if (STUDIO_PASSWORD) return STUDIO_PASSWORD;
  const passwordFile = path.join(DATA_DIR, 'PASSWORD.txt');
  try {
    const existing = fs.readFileSync(passwordFile, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // generate below
  }
  const pw = generatePassword();
  fs.writeFileSync(passwordFile, pw + '\n', { mode: 0o600 });
  // Never log the password itself: logs get copied into bug reports and screenshots.
  // eslint-disable-next-line no-console
  console.log(`No STUDIO_PASSWORD set. Generated a studio password in ${passwordFile}`);
  return pw;
}

export const PASSWORD = resolvePassword();

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // still do a compare to avoid short-circuit timing leak, but result is always false
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function checkPassword(candidate: string): boolean {
  return typeof candidate === 'string' && candidate.length > 0 && timingSafeEqual(candidate, PASSWORD);
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function createSessionToken(): string {
  const payload = `s.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(payload);
  if (!timingSafeEqual(sig, expected)) return false;
  const parts = payload.split('.');
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > THIRTY_DAYS_SEC * 1000) return false;
  return true;
}

export function setSessionCookie(c: Context) {
  const proto = c.req.header('x-forwarded-proto');
  const secure = proto === 'https';
  setCookie(c, COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: THIRTY_DAYS_SEC,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function isAuthenticated(c: Context): boolean {
  const token = getCookie(c, COOKIE_NAME);
  return verifySessionToken(token);
}

// ───────────────────────────── rate limiting ─────────────────────────────

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

export function rateLimited(key: string): boolean {
  const nowMs = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < nowMs) {
    attempts.set(key, { count: 1, resetAt: nowMs + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

// ───────────────────────────── middleware ─────────────────────────────

const PUBLIC_PATHS = new Set(['/api/login', '/api/health', '/api/session']);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/media/')) return false;
  // Static SPA assets (index.html, JS, CSS, favicon) are public; the SPA itself gates on /api/session.
  return true;
}

export async function authMiddleware(c: Context, next: Next) {
  const url = new URL(c.req.url);
  if (isPublicPath(url.pathname)) return next();
  if (!isAuthenticated(c)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
}

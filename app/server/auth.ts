// Password login + HMAC-signed session cookie.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { DATA_DIR, SESSION_SECRET, STUDIO_PASSWORD } from './config';

const COOKIE_NAME = 'bb_session';
const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

// ───────────────────────────── password ─────────────────────────────
//
// Precedence: STUDIO_PASSWORD env var → password chosen on first visit (password.json, scrypt hash)
// → legacy PASSWORD.txt from older images. With none of these the studio is unclaimed and the first
// visitor creates the password, but only during SETUP_WINDOW_MS after the server starts (Portainer's
// approach): the owner opens the studio within minutes of deploying, and a pod nobody claimed in
// time stays locked until it is restarted or STUDIO_PASSWORD is set. There is deliberately no
// shared default password, and the password is never logged.

export const SETUP_WINDOW_MS = Number(process.env.SETUP_WINDOW_MINUTES ?? 15) * 60_000;
export const MIN_PASSWORD_LENGTH = 8;
const startedAt = Date.now();
const hashFile = () => path.join(DATA_DIR, 'password.json');
const legacyFile = () => path.join(DATA_DIR, 'PASSWORD.txt');

interface StoredHash {
  salt: string;
  hash: string;
}

function scrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function readStoredHash(): StoredHash | undefined {
  try {
    const stored = JSON.parse(fs.readFileSync(hashFile(), 'utf8')) as StoredHash;
    return stored.salt && stored.hash ? stored : undefined;
  } catch {
    return undefined;
  }
}

function readLegacyPassword(): string | undefined {
  try {
    return fs.readFileSync(legacyFile(), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

let claimedCache = false;
export function isClaimed(): boolean {
  // Once claimed, stays claimed for this process (saves a file read per request).
  if (!claimedCache) claimedCache = Boolean(STUDIO_PASSWORD || readStoredHash() || readLegacyPassword());
  return claimedCache;
}

if (!isClaimed()) {
  // eslint-disable-next-line no-console
  console.log(`[auth] no password yet: the first visit in the next ${SETUP_WINDOW_MS / 60_000} minutes creates one`);
}

export function setupOpen(): boolean {
  return !isClaimed() && Date.now() - startedAt < SETUP_WINDOW_MS;
}

export type SetupResult = 'ok' | 'claimed' | 'closed' | 'too-short';

/** First-visit setup: stores the chosen password. Exclusive create, so two racing visitors can't both win. */
export function claimPassword(password: string): SetupResult {
  if (isClaimed()) return 'claimed';
  if (!setupOpen()) return 'closed';
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return 'too-short';
  const salt = crypto.randomBytes(16).toString('hex');
  const record: StoredHash = { salt, hash: scrypt(password, salt) };
  try {
    fs.writeFileSync(hashFile(), JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
  } catch {
    return 'claimed';
  }
  claimedCache = true;
  // eslint-disable-next-line no-console
  console.log('[auth] studio password created on first visit');
  return 'ok';
}

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
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (STUDIO_PASSWORD) return timingSafeEqual(candidate, STUDIO_PASSWORD);
  const stored = readStoredHash();
  if (stored) return timingSafeEqual(scrypt(candidate, stored.salt), stored.hash);
  const legacy = readLegacyPassword();
  return legacy ? timingSafeEqual(candidate, legacy) : false;
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
  if (!isClaimed()) return false;
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

const PUBLIC_PATHS = new Set(['/api/login', '/api/setup', '/api/health', '/api/session']);

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

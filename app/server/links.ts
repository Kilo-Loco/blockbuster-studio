// Signed, expiring download links: a full-size file can be fetched with plain curl (or handed to a
// browser) without the long-lived agent token or a session cookie. Signed with the session secret
// under a "dl." prefix so a link can never pass for a session token or the other way round.
import crypto from 'node:crypto';
import { SESSION_SECRET } from './config';
import type { ID } from '../shared/types';

export const LINK_TTL_SEC = 15 * 60;

function sign(id: ID, exp: number): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`dl.${id}.${exp}`).digest('base64url');
}

/** Path for a link to asset `id` that works until `exp` (unix seconds). */
export function signedPath(id: ID, filename: string, nowMs = Date.now()): { path: string; expiresAt: string } {
  const exp = Math.floor(nowMs / 1000) + LINK_TTL_SEC;
  return { path: `/dl/${id}/${exp}/${sign(id, exp)}/${encodeURIComponent(filename)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyLink(id: string, expRaw: string, sig: string, nowMs = Date.now()): boolean {
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 < nowMs) return false;
  const expected = Buffer.from(sign(id, exp));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

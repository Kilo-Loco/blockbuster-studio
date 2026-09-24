// Hard content-policy block: sexual content involving minors. This cannot be turned off and is
// applied to every prompt that reaches generation (user prompts, auto-built shot prompts,
// character/location descriptions). No other content filtering is added.

const SEXUAL_TERMS = [
  'nude', 'naked', 'nsfw', 'sex', 'sexual', 'sexy', 'erotic', 'porn', 'pornographic', 'fetish',
  'hentai', 'lewd', 'orgasm', 'masturbat', 'genital', 'penis', 'vagina', 'breast', 'nipple',
  'topless', 'strip', 'provocative', 'seductive', 'lingerie', 'fondl', 'molest',
];

const MINOR_TERMS = [
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'underage', 'under age', 'under-age',
  'teen', 'teenage', 'teenager', 'tween', 'preteen', 'pre-teen', 'schoolgirl', 'schoolboy',
  'loli', 'lolicon', 'shota', 'shotacon', 'toddler', 'infant', 'baby', 'little girl', 'little boy',
  'young girl', 'young boy', 'elementary school', 'middle school', 'high schooler',
];

// Matches phrases like "13 year old", "13-year-old", "13yo", for ages under 18.
const AGE_PATTERN = /\b(\d{1,2})\s*[-\s]?(?:years?[-\s]?old|y\.?o\.?)\b/gi;

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((t) => text.includes(t));
}

function hasUnderageAge(text: string): boolean {
  for (const m of text.matchAll(AGE_PATTERN)) {
    const age = Number(m[1]);
    if (Number.isFinite(age) && age > 0 && age < 18) return true;
  }
  return false;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/** Reject prompts that combine sexual content with any minor-indicating signal. */
export function checkPrompt(text: string | undefined | null): GuardResult {
  if (!text) return { allowed: true };
  const lower = text.toLowerCase();
  const sexual = containsAny(lower, SEXUAL_TERMS);
  if (!sexual) return { allowed: true };
  const minor = containsAny(lower, MINOR_TERMS) || hasUnderageAge(lower);
  if (minor) return { allowed: false, reason: 'This prompt is not allowed.' };
  return { allowed: true };
}

/** Throws with a message suitable for a 400 response if any of the given texts fail the guard. */
export function assertPromptsAllowed(...texts: (string | undefined | null)[]) {
  for (const t of texts) {
    const result = checkPrompt(t);
    if (!result.allowed) {
      const err = new Error(result.reason ?? 'This prompt is not allowed.') as Error & { status?: number };
      err.status = 400;
      throw err;
    }
  }
}

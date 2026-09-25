// Hard content-policy block: sexual content involving minors. This cannot be turned off and is
// applied to every prompt that reaches generation (user prompts, auto-built shot prompts,
// character/location descriptions). No other content filtering is added.
//
// Matching is on whole words (with plurals / word stems where noted) so adult prompts don't trip on
// look-alikes: "eighteen" is not "teen", "Essex" is not "sex", "breastplate" is not "breast",
// "kidney" is not "kid". The error names the word that triggered it so a false positive can be fixed.

/** `stem*` matches any word starting with the stem; other entries match the word or its plural. */
const SEXUAL_TERMS = [
  'nude', 'naked', 'nsfw', 'sex', 'sexual', 'sexually', 'sexy', 'erotic*', 'porn*', 'fetish*',
  'hentai', 'lewd', 'orgasm*', 'masturbat*', 'genital*', 'penis', 'vagina', 'pussy', 'breast', 'boob',
  'nipple', 'topless', 'bottomless', 'stripping', 'striptease', 'provocative', 'seductive', 'lingerie',
  'fondl*', 'molest*', 'intercourse', 'blowjob', 'cum', 'aroused', 'undress*',
];

const MINOR_TERMS = [
  'child', 'children', 'kid', 'kiddie', 'minors', 'a minor', 'underage', 'under age', 'under-age',
  'teen', 'teenage', 'teenager', 'teenaged', 'tween', 'preteen', 'pre-teen', 'schoolgirl', 'schoolboy',
  'loli', 'lolicon', 'shota', 'shotacon', 'toddler', 'infant', 'little girl', 'little boy',
  'young girl', 'young boy', 'elementary school', 'middle school', 'high schooler', 'prepubescent',
];

// Matches "13 year old", "13-year-old", "13yo", "13 y.o." for ages under 18.
const AGE_PATTERN = /\b(\d{1,2})\s*[-\s]?(?:years?[-\s]?old|y\.?o\.?)(?![a-z])/gi;

function termRegex(term: string): RegExp {
  const stem = term.endsWith('*');
  const body = (stem ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  return new RegExp(stem ? `\\b${body}[a-z]*` : `\\b${body}(?:s|es)?\\b`, 'i');
}

const SEXUAL_RE = SEXUAL_TERMS.map((t) => [t, termRegex(t)] as const);
const MINOR_RE = MINOR_TERMS.map((t) => [t, termRegex(t)] as const);

function firstMatch(text: string, terms: ReadonlyArray<readonly [string, RegExp]>): string | undefined {
  for (const [, re] of terms) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}

function underageAge(text: string): string | undefined {
  for (const m of text.matchAll(AGE_PATTERN)) {
    const age = Number(m[1]);
    if (Number.isFinite(age) && age > 0 && age < 18) return m[0];
  }
  return undefined;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/** Reject prompts that combine sexual content with any minor-indicating signal. */
export function checkPrompt(text: string | undefined | null): GuardResult {
  if (!text) return { allowed: true };
  if (!firstMatch(text, SEXUAL_RE)) return { allowed: true };
  const minor = firstMatch(text, MINOR_RE) ?? underageAge(text);
  if (minor) {
    return {
      allowed: false,
      reason: `Blocked: sexual content involving minors isn't allowed, and this prompt pairs sexual content with "${minor}". If everyone is an adult, remove that word.`,
    };
  }
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

import { describe, expect, it } from 'vitest';
import { checkPrompt } from './guard';

describe('guard', () => {
  it('allows plain prompts', () => {
    expect(checkPrompt('a woman in a red coat walking through rain').allowed).toBe(true);
  });

  it('allows adult sexual content', () => {
    expect(checkPrompt('a sexy woman in lingerie, nude photograph').allowed).toBe(true);
  });

  it('allows minors in non-sexual prompts', () => {
    expect(checkPrompt('a child playing with a dog in the park').allowed).toBe(true);
    expect(checkPrompt('a teenager riding a skateboard').allowed).toBe(true);
  });

  it('blocks sexual content combined with minor terms', () => {
    expect(checkPrompt('a nude child').allowed).toBe(false);
    expect(checkPrompt('sexy schoolgirl').allowed).toBe(false);
    expect(checkPrompt('a naked teen').allowed).toBe(false);
    expect(checkPrompt('erotic loli').allowed).toBe(false);
    expect(checkPrompt('a 13 year old nude').allowed).toBe(false);
    expect(checkPrompt('a 13-year-old in lingerie').allowed).toBe(false);
  });

  it('does not block ages 18+', () => {
    expect(checkPrompt('an 18 year old nude model').allowed).toBe(true);
    expect(checkPrompt('a 25-year-old in lingerie').allowed).toBe(true);
  });

  it('handles empty/undefined input', () => {
    expect(checkPrompt(undefined).allowed).toBe(true);
    expect(checkPrompt('').allowed).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(checkPrompt('NUDE CHILD').allowed).toBe(false);
  });
});

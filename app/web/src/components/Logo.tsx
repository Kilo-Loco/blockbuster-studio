import { useId } from 'react';

// The Blockbuster Studio mark (docs/brand/logo-mark.svg): a clapperboard drawn as one solid block.
// Stripes are masked out, so it takes its color from `fill` and works on any background.
export function Logo({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <mask id={`${id}arm`}>
        <rect width="32" height="32" fill="#fff" />
        <path fill="#000" d="M6 7.5h3l2 4.5H8zm7 0h3l2 4.5h-3zm7 0h3l2 4.5h-3z" />
      </mask>
      <mask id={`${id}body`}>
        <rect width="32" height="32" fill="#fff" />
        <path fill="#000" d="M0 18.5h32V20H0zM8 14h3l-2 4.5H6zm7 0h3l-2 4.5h-3zm7 0h3l-2 4.5h-3z" />
      </mask>
      <rect x="3" y="7.5" width="26" height="4.5" rx="1.5" transform="rotate(-14 3 12)" mask={`url(#${id}arm)`} />
      <rect x="3" y="14" width="26" height="16" rx="1.5" mask={`url(#${id}body)`} />
    </svg>
  );
}

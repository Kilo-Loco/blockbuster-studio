/** The trainer always produces a Z-Image Turbo LoRA (see server/loras/train.ts). */
export function BaseModelNote() {
  return (
    <p className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50 px-3 py-2 text-xs text-[var(--color-ink-2)]">
      <span className="font-medium text-[var(--color-ink-1)]">Base model: Z-Image Turbo</span> (image generation). Use it in Create → Image and
      for shot keyframes. Video models don&apos;t load it.
    </p>
  );
}

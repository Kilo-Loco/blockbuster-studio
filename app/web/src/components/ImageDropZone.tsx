import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/** Wraps an area so images dragged onto it are handed to onFiles. Highlights while dragging. */
export function ImageDropZone({ onFiles, children, className }: { onFiles: (files: File[]) => void; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child element; count them so the highlight doesn't flicker.
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <div
      className={clsx('relative rounded-lg transition-colors', over && 'outline-2 outline-dashed outline-offset-4 outline-[var(--color-amber-400)]/70', className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-xs font-medium text-white">
          Drop images to add them
        </div>
      )}
    </div>
  );
}

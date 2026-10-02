import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react';
import type { ID } from '@shared/types';
import { api, mediaUrl, startDownload } from '../lib/api';
import { IconButton, Skeleton } from './ui';

/**
 * Full-size view of a set of image assets: arrows (or ← →) step through them, Esc closes.
 * Opens on top of dialogs, so it handles its own keys before any dialog underneath sees them.
 */
export function AssetLightbox({
  assetIds,
  index,
  onIndexChange,
  onClose,
  caption,
  onRemove,
  removeLabel = 'Remove',
}: {
  assetIds: ID[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  caption?: (i: number) => ReactNode;
  onRemove?: (assetId: ID) => void;
  removeLabel?: string;
}) {
  const assetId = assetIds[index];
  const { data: asset } = useQuery({ queryKey: ['asset', assetId], queryFn: () => api.asset(assetId), enabled: !!assetId });
  const count = assetIds.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') onIndexChange(Math.min(count - 1, index + 1));
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    // Capture on window runs before the dialogs' document-level handlers, so Esc closes only this.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, count, onClose, onIndexChange]);

  useEffect(() => {
    if (count === 0) onClose();
    else if (index >= count) onIndexChange(count - 1);
  }, [index, count]);

  if (!assetId) return null;
  const src = asset ? mediaUrl(asset.file) : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm animate-in fade-in" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 truncate text-xs text-white/70">
          {count > 1 && <span className="chip-mono mr-3 text-white/50">{index + 1} / {count}</span>}
          {caption?.(index)}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {src && <IconButton icon={<Download className="size-4" />} label="Download" onClick={() => startDownload(src)} />}
          {onRemove && <IconButton icon={<Trash2 className="size-4" />} label={removeLabel} onClick={() => onRemove(assetId)} />}
          <IconButton icon={<X className="size-4" />} label="Close" onClick={onClose} autoFocus />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16" onClick={onClose}>
        {src ? (
          <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        ) : (
          <Skeleton className="aspect-video w-full max-w-4xl" />
        )}
        {index > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index - 1);
            }}
            className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:left-4"
            aria-label="Previous"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {index < count - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index + 1);
            }}
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:right-4"
            aria-label="Next"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

import { Download, Heart, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '../ui';

/** Floating bar that replaces the Composer while assets are selected in the gallery. */
export function SelectionBar({
  count,
  onSelectAll,
  onDownload,
  onFavorite,
  onDelete,
  onClear,
}: {
  count: number;
  onSelectAll: () => void;
  onDownload: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected assets"
      className="glass-panel fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl p-3 sm:bottom-6 sm:p-4"
    >
      <span className="chip-mono text-sm font-medium text-[var(--color-ink-0)]">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          Select all
        </Button>
        <Button variant="secondary" size="sm" icon={<Download className="size-3.5" />} onClick={onDownload}>
          Download
        </Button>
        <Button variant="secondary" size="sm" icon={<Heart className="size-3.5" />} onClick={onFavorite}>
          Favorite
        </Button>
        <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
          Delete
        </Button>
        <IconButton icon={<X className="size-4" />} label="Clear selection" onClick={onClear} />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { Asset, AssetKind, GenerateRequest, Job } from '@shared/types';
import { api, mediaUrl, startDownload } from '../../lib/api';
import { toast, useComposerStore } from '../../lib/store';
import { Skeleton, ProgressRing, Tabs, Menu } from '../ui';
import { Heart, Film, Check, Download } from 'lucide-react';

export type GalleryTab = 'all' | 'images' | 'videos' | 'favorites';

const TABS: { value: GalleryTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'favorites', label: 'Favorites' },
];

/** Query params for the current filter tab — shared with Create's asset query and the
 *  "download all <tab>" action, which pages through the same filter to collect every id. */
export function paramsForTab(tab: GalleryTab): { kind?: AssetKind; favorite?: boolean } {
  if (tab === 'images') return { kind: 'image' };
  if (tab === 'videos') return { kind: 'video' };
  if (tab === 'favorites') return { favorite: true };
  return {};
}

const EXAMPLE_PROMPTS = [
  'A neon-lit ramen bar in the rain, cinematic 35mm',
  'Portrait of a woman with silver hair, studio lighting',
  'A city street at dusk, camera pushing in',
];

export function Gallery({
  assets,
  jobs,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  tab,
  onTabChange,
  selectedIds,
  onToggleSelect,
}: {
  assets: Asset[];
  jobs: Job[];
  onOpen: (index: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  tab: GalleryTab;
  onTabChange: (t: GalleryTab) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, index: number, shiftKey: boolean) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectionMode = selectedIds.size > 0;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const setPrompt = useComposerStore((s) => s.setPrompt);
  const empty = assets.length === 0 && jobs.length === 0;

  function pickExample(p: string) {
    setPrompt(p);
    requestAnimationFrame(() => {
      const el = document.getElementById('composer-prompt') as HTMLTextAreaElement | null;
      el?.focus();
    });
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-56 pt-4 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <Tabs tabs={TABS} value={tab} onChange={onTabChange} />
        <DownloadAllMenu tab={tab} />
      </div>

      {empty ? (
        <div className="mt-24 flex flex-col items-center gap-6 px-4 text-center">
          <p className="font-serif text-3xl text-[var(--color-ink-0)]">Describe a shot to begin</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => pickExample(p)}
                className="max-w-xs rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-4 py-3 text-left text-sm text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-amber-400)]/40 hover:text-[var(--color-ink-0)]"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 columns-2 gap-3 sm:columns-3 lg:columns-4">
          {jobs.map((job) => (
            <JobTile key={job.id} job={job} />
          ))}
          {assets.map((asset, i) => (
            <GalleryTile
              key={asset.id}
              asset={asset}
              index={i}
              selected={selectedIds.has(asset.id)}
              selectionMode={selectionMode}
              onOpen={() => onOpen(i)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}

function DownloadAllMenu({ tab }: { tab: GalleryTab }) {
  const [loading, setLoading] = useState(false);
  const tabLabel = TABS.find((t) => t.value === tab)?.label ?? '';

  async function downloadEverything() {
    if (loading) return;
    setLoading(true);
    toast({ title: 'Preparing download…' });
    try {
      const res = await api.downloadAssets({ all: true });
      startDownload(res.url);
    } catch {
      toast({ title: 'Download failed', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function downloadTab() {
    if (loading) return;
    setLoading(true);
    toast({ title: `Preparing ${tabLabel.toLowerCase()}…` });
    try {
      const params = paramsForTab(tab);
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.assets({ ...params, cursor, limit: 200 });
        ids.push(...page.items.map((a) => a.id));
        cursor = page.nextCursor;
      } while (cursor);
      if (!ids.length) {
        toast({ title: 'Nothing to download', variant: 'error' });
        return;
      }
      const res = await api.downloadAssets({ assetIds: ids });
      startDownload(res.url);
    } catch {
      toast({ title: 'Download failed', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Menu
      label="Download options"
      items={
        tab === 'all'
          ? [{ label: 'Download all (ZIP)', icon: <Download className="size-4" />, onClick: () => void downloadEverything(), disabled: loading }]
          : [{ label: `Download all ${tabLabel}`, icon: <Download className="size-4" />, onClick: () => void downloadTab(), disabled: loading }]
      }
    />
  );
}

function SelectCheckbox({
  asset,
  selected,
  visible,
  onClick,
}: {
  asset: Asset;
  selected: boolean;
  visible: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${selected ? 'Deselect' : 'Select'} ${asset.kind}`}
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        'absolute left-2 top-2 z-10 flex size-6 items-center justify-center rounded-full border transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        selected
          ? 'border-[var(--color-amber-400)] bg-[var(--color-amber-400)] text-black'
          : 'border-white/80 bg-black/40 text-transparent backdrop-blur hover:border-white',
      )}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </button>
  );
}

function GalleryTile({
  asset,
  index,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect,
}: {
  asset: Asset;
  index: number;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggleSelect: (id: string, index: number, shiftKey: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  function handleClick(e: React.MouseEvent) {
    if (selectionMode) {
      e.preventDefault();
      onToggleSelect(asset.id, index, e.shiftKey);
      return;
    }
    onOpen();
  }

  return (
    <div
      className={clsx(
        'group relative mb-3 block w-full cursor-pointer overflow-hidden rounded-xl border bg-[var(--color-bg-1)] transition-transform duration-200 hover:scale-[1.02]',
        selected ? 'border-[var(--color-amber-400)] ring-2 ring-[var(--color-amber-400)]/60' : 'border-[var(--color-hairline)]',
      )}
      style={{ aspectRatio: `${asset.width} / ${asset.height}`, breakInside: 'avoid' }}
      draggable={!selectionMode}
      onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(asset))}
      onClick={handleClick}
      onMouseEnter={() => videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      {asset.kind === 'video' ? (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          poster={mediaUrl(asset.thumb)}
          src={mediaUrl(asset.file)}
          className="h-full w-full object-cover"
        />
      ) : (
        <img src={mediaUrl(asset.thumb ?? asset.file)} alt={asset.prompt ?? ''} className="h-full w-full object-cover" loading="lazy" />
      )}
      <SelectCheckbox
        asset={asset}
        selected={selected}
        visible={selectionMode}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(asset.id, index, e.shiftKey);
        }}
      />
      {asset.favorite && (
        <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/50 backdrop-blur">
          <Heart className="size-3.5 fill-[var(--color-amber-400)] text-[var(--color-amber-400)]" />
        </div>
      )}
      {asset.kind === 'video' && (
        <div className="absolute left-2 bottom-2 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
          <Film className="size-3" />
          {asset.durationSec ? `${Math.round(asset.durationSec)}s` : 'video'}
        </div>
      )}
    </div>
  );
}

function JobTile({ job }: { job: Job }) {
  const params = job.params as Partial<GenerateRequest>;
  const aspect = params.aspect ?? '16:9';
  const [w, h] = aspect.split(':').map(Number);
  return (
    <div
      className="relative mb-3 overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]"
      style={{ aspectRatio: `${w} / ${h}`, breakInside: 'avoid' }}
    >
      <Skeleton className="absolute inset-0 h-full w-full rounded-xl" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
        <ProgressRing value={job.progress} size={36} />
        <span className="line-clamp-2 text-xs text-[var(--color-ink-1)]">{job.status === 'queued'
            ? job.queuePosition && job.queuePosition > 1
              ? `Waiting · ${job.queuePosition - 1} job${job.queuePosition - 1 === 1 ? '' : 's'} ahead`
              : 'Up next…'
            : job.stage ?? 'Starting…'}</span>
      </div>
    </div>
  );
}

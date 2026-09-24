import { useEffect, useRef } from 'react';
import type { Asset, GenerateRequest, Job } from '@shared/types';
import { mediaUrl } from '../../lib/api';
import { useComposerStore } from '../../lib/store';
import { Skeleton, ProgressRing, Tabs } from '../ui';
import { Heart, Film } from 'lucide-react';

export type GalleryTab = 'all' | 'images' | 'videos' | 'favorites';

const TABS: { value: GalleryTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'favorites', label: 'Favorites' },
];

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
}: {
  assets: Asset[];
  jobs: Job[];
  onOpen: (index: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  tab: GalleryTab;
  onTabChange: (t: GalleryTab) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

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
      <Tabs tabs={TABS} value={tab} onChange={onTabChange} />

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
            <GalleryTile key={asset.id} asset={asset} onOpen={() => onOpen(i)} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}

function GalleryTile({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div
      className="group relative mb-3 block w-full cursor-pointer overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] transition-transform duration-200 hover:scale-[1.02]"
      style={{ aspectRatio: `${asset.width} / ${asset.height}`, breakInside: 'avoid' }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(asset))}
      onClick={onOpen}
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
      {asset.favorite && (
        <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/50 backdrop-blur">
          <Heart className="size-3.5 fill-[var(--color-amber-400)] text-[var(--color-amber-400)]" />
        </div>
      )}
      {asset.kind === 'video' && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
          <Film className="size-3" />
          {asset.durationSec ? `${asset.durationSec}s` : 'video'}
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
        <span className="line-clamp-2 text-xs text-[var(--color-ink-1)]">{job.stage ?? 'Queued…'}</span>
      </div>
    </div>
  );
}

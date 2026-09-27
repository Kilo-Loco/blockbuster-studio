import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioLines, Film } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../../lib/api';
import type { AspectRatio, Character, Shot } from '@shared/types';
import { CAMERA_MOVE_BY_ID } from '@shared/presets';
import { lineState } from '@shared/dialogue';
import { characterColor, initials, STATUS_COLOR, STATUS_LABEL } from './utils';

export function ShotCard({
  shot,
  order,
  aspect,
  characters,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  dropIndicator,
}: {
  shot: Shot;
  order: number;
  aspect: AspectRatio;
  characters: Character[];
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  dropIndicator?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { data: keyframe } = useQuery({
    queryKey: ['asset', shot.keyframeAssetId],
    queryFn: () => api.asset(shot.keyframeAssetId!),
    enabled: !!shot.keyframeAssetId,
  });
  const { data: video } = useQuery({
    queryKey: ['asset', shot.videoAssetId],
    queryFn: () => api.asset(shot.videoAssetId!),
    enabled: !!shot.videoAssetId,
  });

  const move = CAMERA_MOVE_BY_ID[shot.cameraMove];
  const [aw, ah] = aspect.split(':').map(Number);
  const portrait = ah > aw;
  const cast = shot.characterIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={clsx(
        'group relative shrink-0 cursor-pointer overflow-hidden rounded-xl border bg-[var(--color-bg-2)] transition-colors',
        portrait ? 'w-40' : 'w-56',
        dropIndicator ? 'border-[var(--color-amber-400)]' : 'border-[var(--color-hairline)] hover:border-[var(--color-hairline-strong)]',
      )}
      onMouseEnter={() => videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      <div className="relative w-full bg-black" style={{ aspectRatio: `${aw} / ${ah}` }}>
        {video ? (
          <video ref={videoRef} src={mediaUrl(video.file)} muted loop playsInline className="size-full object-cover" poster={keyframe ? mediaUrl(keyframe.thumb ?? keyframe.file) : undefined} />
        ) : keyframe ? (
          <img src={mediaUrl(keyframe.thumb ?? keyframe.file)} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Film className="size-6 text-[var(--color-ink-3)]" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
          <p className="chip-mono truncate text-[10px] text-white/90">
            #{order} · {shot.shotSize} · {move?.label ?? shot.cameraMove} · {shot.durationSec}s
          </p>
        </div>
        <span className={clsx('absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLOR[shot.status])}>
          {STATUS_LABEL[shot.status]}
        </span>
        {cast.length > 0 && (
          <div className="absolute left-1.5 top-1.5 flex -space-x-1.5">
            {cast.slice(0, 4).map((c, i) => (
              <span
                key={c.id}
                title={c.name}
                className="flex size-5 items-center justify-center rounded-full border border-black/50 text-[9px] font-bold text-black"
                style={{ background: characterColor(c, i) }}
              >
                {initials(c.name)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex h-[3.75rem] flex-col gap-0.5 px-2.5 py-2">
        <p className={clsx('line-clamp-2 text-xs leading-snug', shot.action ? 'text-[var(--color-ink-1)]' : 'italic text-[var(--color-ink-3)]')}>
          {shot.action || 'No action yet'}
        </p>
        {shot.dialogue && (
          <p className="flex items-center gap-1 truncate text-[11px] italic text-[var(--color-ink-2)]">
            {lineState(shot, cast) === 'ready' && <AudioLines className="size-3 shrink-0 not-italic text-[var(--color-amber-400)]" aria-label="Recorded in the speaker's voice" />}
            <span className="truncate">“{shot.dialogue}”</span>
          </p>
        )}
      </div>
    </div>
  );
}

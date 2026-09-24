import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Film } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../../lib/api';
import type { Character, Shot } from '@shared/types';
import { CAMERA_MOVE_BY_ID } from '@shared/presets';
import { characterColor, initials, STATUS_COLOR, STATUS_LABEL } from './utils';

export function ShotCard({
  shot,
  order,
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
  const cast = shot.characterIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={clsx(
        'group relative w-56 shrink-0 cursor-pointer overflow-hidden rounded-xl border bg-[var(--color-bg-2)] transition-colors',
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
      <div className="relative aspect-video w-full bg-black">
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
    </div>
  );
}

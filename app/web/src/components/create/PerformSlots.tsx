import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, mediaUrl } from '../../lib/api';
import { toast, useComposerStore } from '../../lib/store';
import { IconButton, Popover } from '../ui';
import { Circle, Plus, Upload, Users, X } from 'lucide-react';
import { RecordDialog } from './RecordDialog';

/** The two labeled input slots for Perform mode: a video of the performance and a character reference image. */
export function PerformSlots() {
  const performanceAsset = useComposerStore((s) => s.performanceAsset);
  const characterAsset = useComposerStore((s) => s.characterAsset);
  const setPerformanceAsset = useComposerStore((s) => s.setPerformanceAsset);
  const setCharacterAsset = useComposerStore((s) => s.setCharacterAsset);

  const [recordOpen, setRecordOpen] = useState(false);
  const [performUploading, setPerformUploading] = useState(false);
  const [characterUploading, setCharacterUploading] = useState(false);
  const [castLoadingId, setCastLoadingId] = useState<string | null>(null);
  const perfFileRef = useRef<HTMLInputElement>(null);
  const charFileRef = useRef<HTMLInputElement>(null);

  const { data: videoAssets } = useQuery({
    queryKey: ['assets', 'composer-recent-video'],
    queryFn: () => api.assets({ kind: 'video', limit: 24 }),
  });
  const { data: imageAssets } = useQuery({
    queryKey: ['assets', 'composer-recent'],
    queryFn: () => api.assets({ kind: 'image', limit: 24 }),
  });
  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: api.characters });

  async function uploadPerformance(file: File) {
    setPerformUploading(true);
    try {
      const asset = await api.upload(file);
      setPerformanceAsset(asset);
    } catch {
      toast({ title: 'Upload failed', variant: 'error' });
    } finally {
      setPerformUploading(false);
      if (perfFileRef.current) perfFileRef.current.value = '';
    }
  }

  async function uploadCharacter(file: File) {
    setCharacterUploading(true);
    try {
      const asset = await api.upload(file);
      setCharacterAsset(asset);
    } catch {
      toast({ title: 'Upload failed', variant: 'error' });
    } finally {
      setCharacterUploading(false);
      if (charFileRef.current) charFileRef.current.value = '';
    }
  }

  async function pickFromCast(characterId: string, refAssetId: string) {
    setCastLoadingId(characterId);
    try {
      const asset = await api.asset(refAssetId);
      setCharacterAsset(asset);
      // The Cast description tells Animate 2 what the character looks like (the prompt is the scene).
      const description = (characters ?? []).find((c) => c.id === characterId)?.description ?? '';
      useComposerStore.getState().set({ characterPrompt: description });
    } catch {
      toast({ title: 'Could not load character reference', variant: 'error' });
    } finally {
      setCastLoadingId(null);
    }
  }

  const castWithRefs = (characters ?? []).filter((c) => c.referenceAssetIds.length > 0);

  return (
    <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
      <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]" id="perform-slot-performance">
          Performance
        </span>
        {performanceAsset ? (
          <div className="relative h-24 overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-black">
            <video
              src={mediaUrl(performanceAsset.file)}
              poster={mediaUrl(performanceAsset.thumb)}
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
            <button
              onClick={() => setPerformanceAsset(undefined)}
              aria-label="Remove performance clip"
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <div
            aria-labelledby="perform-slot-performance"
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-1.5"
          >
            {performUploading ? (
              <span className="text-[11px] text-[var(--color-ink-3)]">Uploading…</span>
            ) : (
              <div className="flex items-center gap-1">
                <IconButton size="sm" icon={<Circle className="size-3.5" />} label="Record a performance" onClick={() => setRecordOpen(true)} />
                <IconButton
                  size="sm"
                  icon={<Upload className="size-3.5" />}
                  label="Upload a performance video"
                  onClick={() => perfFileRef.current?.click()}
                />
                <Popover
                  trigger={({ onClick, ref }) => (
                    <IconButton
                      ref={ref}
                      size="sm"
                      icon={<Plus className="size-3.5" />}
                      label="Pick a performance video from your gallery"
                      onClick={onClick}
                    />
                  )}
                >
                  <div className="grid max-h-72 w-64 grid-cols-3 gap-1.5 overflow-y-auto p-2">
                    {(videoAssets?.items ?? []).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setPerformanceAsset(a)}
                        className="aspect-square overflow-hidden rounded-md border border-[var(--color-hairline)]"
                      >
                        <img src={mediaUrl(a.thumb ?? a.file)} className="h-full w-full object-cover" alt="" />
                      </button>
                    ))}
                    {(!videoAssets || videoAssets.items.length === 0) && (
                      <p className="col-span-3 py-4 text-center text-xs text-[var(--color-ink-3)]">No videos yet.</p>
                    )}
                  </div>
                </Popover>
              </div>
            )}
          </div>
        )}
        <input
          ref={perfFileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadPerformance(f);
          }}
        />
      </div>

      <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]" id="perform-slot-character">
          Character
        </span>
        {characterAsset ? (
          <div className="relative h-24 overflow-hidden rounded-lg border border-[var(--color-hairline)]">
            <img src={mediaUrl(characterAsset.thumb ?? characterAsset.file)} className="h-full w-full object-cover" alt="" />
            <button
              onClick={() => setCharacterAsset(undefined)}
              aria-label="Remove character image"
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <div
            aria-labelledby="perform-slot-character"
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-1.5"
          >
            {characterUploading ? (
              <span className="text-[11px] text-[var(--color-ink-3)]">Uploading…</span>
            ) : (
              <div className="flex items-center gap-1">
                <IconButton
                  size="sm"
                  icon={<Upload className="size-3.5" />}
                  label="Upload a character image"
                  onClick={() => charFileRef.current?.click()}
                />
                <Popover
                  trigger={({ onClick, ref }) => (
                    <IconButton
                      ref={ref}
                      size="sm"
                      icon={<Plus className="size-3.5" />}
                      label="Pick a character image from your gallery"
                      onClick={onClick}
                    />
                  )}
                >
                  <div className="grid max-h-72 w-64 grid-cols-4 gap-1.5 overflow-y-auto p-2">
                    {(imageAssets?.items ?? []).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setCharacterAsset(a)}
                        className="aspect-square overflow-hidden rounded-md border border-[var(--color-hairline)]"
                      >
                        <img src={mediaUrl(a.thumb ?? a.file)} className="h-full w-full object-cover" alt="" />
                      </button>
                    ))}
                    {(!imageAssets || imageAssets.items.length === 0) && (
                      <p className="col-span-4 py-4 text-center text-xs text-[var(--color-ink-3)]">No images yet.</p>
                    )}
                  </div>
                </Popover>
                <Popover
                  trigger={({ onClick, ref }) => (
                    <IconButton ref={ref} size="sm" icon={<Users className="size-3.5" />} label="Pick a character from your cast" onClick={onClick} />
                  )}
                >
                  <div className="max-h-72 w-56 overflow-y-auto p-1.5">
                    {castWithRefs.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={castLoadingId === c.id}
                        onClick={() => void pickFromCast(c.id, c.referenceAssetIds[0])}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6 disabled:opacity-50"
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </button>
                    ))}
                    {castWithRefs.length === 0 && <p className="px-2 py-2 text-xs text-[var(--color-ink-3)]">No characters with references yet.</p>}
                  </div>
                </Popover>
              </div>
            )}
          </div>
        )}
        <input
          ref={charFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadCharacter(f);
          }}
        />
      </div>

      {recordOpen && (
        <RecordDialog
          onClose={() => setRecordOpen(false)}
          onUse={(asset) => {
            setPerformanceAsset(asset);
            setRecordOpen(false);
          }}
        />
      )}
    </div>
  );
}

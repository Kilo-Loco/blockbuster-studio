import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Film, Pause, Play } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import type { Project, Scene, Shot } from '@shared/types';
import { Button, Progress } from '../ui';

const PX_PER_SEC = 40;

function TimelineThumb({ shot }: { shot: Shot }) {
  const { data: asset } = useQuery({ queryKey: ['asset', shot.keyframeAssetId], queryFn: () => api.asset(shot.keyframeAssetId!), enabled: !!shot.keyframeAssetId });
  return (
    <div className="relative h-16 shrink-0 overflow-hidden rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-2)]" style={{ width: shot.durationSec * PX_PER_SEC }}>
      {asset ? <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center"><Film className="size-4 text-[var(--color-ink-3)]" /></div>}
      <span className="absolute bottom-0.5 left-1 chip-mono text-[9px] text-white/80">{shot.durationSec}s</span>
    </div>
  );
}

function Player({ shots }: { shots: (Shot & { assetFile?: string })[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shot = shots[index];

  useEffect(() => {
    if (!playing || !shot) return;
    if (shot.assetFile) {
      videoRef.current?.play().catch(() => {});
    } else {
      stillTimer.current = setTimeout(() => advance(), shot.durationSec * 1000);
    }
    return () => {
      if (stillTimer.current) clearTimeout(stillTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index]);

  function advance() {
    setIndex((i) => {
      if (i + 1 >= shots.length) {
        setPlaying(false);
        return 0;
      }
      return i + 1;
    });
  }

  if (shots.length === 0) return <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline)] text-sm text-[var(--color-ink-2)]">No shots yet.</div>;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-black">
        {shot?.assetFile ? (
          <video ref={videoRef} src={mediaUrl(shot.assetFile)} className="size-full object-contain" onEnded={advance} controls={false} />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-[var(--color-ink-3)]">{shot ? 'No footage for this shot yet' : ''}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="text-xs text-[var(--color-ink-2)]">
          Shot {index + 1} / {shots.length}
        </span>
      </div>
    </div>
  );
}

export function TimelineTab({ project, scenes }: { project: Project; scenes: (Scene & { shots: Shot[] })[] }) {
  const allShots = useMemo(() => scenes.flatMap((s) => s.shots), [scenes]);
  const totalSec = allShots.reduce((n, s) => n + s.durationSec, 0);
  const jobs = useJobsStore((s) => s.jobs);
  const exportJob = useMemo(() => Object.values(jobs).find((j) => j.projectId === project.id && j.type === 'project_export'), [jobs, project.id]);

  const exportMutation = useMutation({
    mutationFn: () => api.exportProject(project.id),
    onSuccess: () => toast({ title: 'Export started', variant: 'success' }),
    onError: (err) => toast({ title: 'Export failed', description: (err as Error).message, variant: 'error' }),
  });

  const exportAssetId = project.exportAssetId ?? (exportJob?.status === 'done' ? exportJob.outputAssetIds[0] : undefined);
  const { data: exportAsset } = useQuery({ queryKey: ['asset', exportAssetId], queryFn: () => api.asset(exportAssetId!), enabled: !!exportAssetId });

  // Resolve each shot's playable video file (if any) up front so the player can stay simple.
  const [resolved, setResolved] = useState<(Shot & { assetFile?: string })[]>(allShots);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      allShots.map(async (s) => {
        if (!s.videoAssetId) return s;
        try {
          const asset = await api.asset(s.videoAssetId);
          return { ...s, assetFile: asset.file };
        } catch {
          return s;
        }
      }),
    ).then((r) => !cancelled && setResolved(r));
    return () => {
      cancelled = true;
    };
  }, [allShots]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-[var(--color-ink-0)]">Timeline</h2>
          <p className="text-xs text-[var(--color-ink-2)]">
            {allShots.length} shots · {totalSec}s total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {exportAsset && (
            <a href={mediaUrl(exportAsset.file)} target="_blank" rel="noreferrer" className="inline-flex">
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />}>
                Download export
              </Button>
            </a>
          )}
          <Button size="sm" variant="primary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
            Export film
          </Button>
        </div>
      </div>

      {exportJob && exportJob.status !== 'done' && exportJob.status !== 'error' && (
        <div className="rounded-xl border border-[var(--color-amber-400)]/30 bg-[var(--color-amber-400)]/10 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--color-amber-300)]">
            <span>{exportJob.stage ?? 'Exporting'}</span>
            <span className="chip-mono">{Math.round(exportJob.progress * 100)}%</span>
          </div>
          <Progress value={exportJob.progress} />
        </div>
      )}

      <Player shots={resolved} />

      <div className="flex gap-1.5 overflow-x-auto pb-2">
        {allShots.map((shot) => (
          <TimelineThumb key={shot.id} shot={shot} />
        ))}
      </div>
    </div>
  );
}

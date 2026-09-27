import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, AudioLines, ChevronDown, Download, Palette, Plus, Sparkles, Video } from 'lucide-react';
import { api, mediaUrl, startDownload } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { useEngineState } from '../hooks/useEngineState';
import type { AspectRatio, Style } from '@shared/types';
import { ASPECTS } from '@shared/presets';
import { lineState, resolveSpeaker } from '@shared/dialogue';
import { Button, Dialog, Popover, Segmented, Skeleton, Tabs, Tooltip } from '../components/ui';
import { StoryboardTab } from '../components/project/StoryboardTab';
import { ScriptTab } from '../components/project/ScriptTab';
import { TimelineTab } from '../components/project/TimelineTab';
import { useDebouncedCallback } from '../components/project/hooks';

type TabKey = 'storyboard' | 'script' | 'timeline';

function NewStyleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.createStyle({ name: name.trim() || 'Untitled style', prompt: prompt.trim()}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['styles'] });
      toast({ title: 'Style created', variant: 'success' });
      onClose();
      setName('');
      setPrompt('');
    },
    onError: (err) => toast({ title: 'Could not create style', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New style">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)] outline-none" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Prompt</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="35mm film, anamorphic, teal and orange grade" className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Create style
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function StylePicker({ projectId, styleId }: { projectId: string; styleId: string | undefined }) {
  const [newStyleOpen, setNewStyleOpen] = useState(false);
  const { data: styles } = useQuery({ queryKey: ['styles'], queryFn: api.styles });
  const qc = useQueryClient();
  const setStyle = useMutation({
    mutationFn: (id: string | undefined) => api.updateProject(projectId, { styleId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });
  const current = styles?.find((s: Style) => s.id === styleId);

  return (
    <>
      <Popover
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            onClick={onClick}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-xs text-[var(--color-ink-1)]"
          >
            <Palette className="size-3.5" />
            {current?.name ?? 'No style'}
            <ChevronDown className="size-3.5 text-[var(--color-ink-2)]" />
          </button>
        )}
      >
        <div className="w-56 p-1.5">
          <button onClick={() => setStyle.mutate(undefined)} className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6">
            No style
          </button>
          {(styles ?? []).map((s: Style) => (
            <button key={s.id} onClick={() => setStyle.mutate(s.id)} className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6">
              {s.name}
            </button>
          ))}
          <div className="mt-1 border-t border-[var(--color-hairline)] pt-1">
            <button onClick={() => setNewStyleOpen(true)} className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-amber-300)] hover:bg-white/6">
              <Plus className="size-3.5" /> New style
            </button>
          </div>
        </div>
      </Popover>
      <NewStyleDialog open={newStyleOpen} onClose={() => setNewStyleOpen(false)} />
    </>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // Set by the New Film dialog: run the AI breakdown on the idea right away.
  const [autoBreakdown] = useState(() => Boolean((routerLocation.state as { breakdown?: boolean } | null)?.breakdown));
  const [tab, setTab] = useState<TabKey>(autoBreakdown ? 'script' : 'storyboard');
  const jobs = useJobsStore((s) => s.jobs);
  const { isOff, system } = useEngineState();
  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: api.characters });

  const { data, isLoading } = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id!), enabled: !!id });

  useEffect(() => {
    if (autoBreakdown) navigate(routerLocation.pathname, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A film without scenes starts where the work starts: the script.
  useEffect(() => {
    if (data && data.scenes.length === 0) setTab('script');
  }, [data?.project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [name, setName] = useState('');
  const [logline, setLogline] = useState('');
  useEffect(() => {
    if (data) {
      setName(data.project.name);
      setLogline(data.project.logline);
    }
  }, [data?.project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchProject = useMutation({
    mutationFn: (patch: Partial<{ name: string; logline: string; aspect: AspectRatio }>) => api.updateProject(id!, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  });
  const debouncedName = useDebouncedCallback((v: string) => patchProject.mutate({ name: v }), 700);
  const debouncedLogline = useDebouncedCallback((v: string) => patchProject.mutate({ logline: v }), 700);

  const shots = useMemo(() => data?.scenes.flatMap((s) => s.shots) ?? [], [data]);
  const shotCount = shots.length;
  const busy = (s: (typeof shots)[number]) => s.status === 'keyframe_queued' || s.status === 'video_queued';
  const needFrames = shots.filter((s) => !s.keyframeAssetId && !busy(s)).length;
  const needVideos = shots.filter((s) => s.keyframeAssetId && !s.videoAssetId && !busy(s)).length;
  const hasVideo = shots.some((s) => s.videoAssetId);
  // Lines to record in the speakers' voices: missing or out of date, or waiting on a suggested voice.
  const linesToRecord = shots.filter((s) => {
    const cast = (characters ?? []).filter((c) => s.characterIds.includes(c.id));
    const state = lineState(s, cast);
    return state === 'missing' || state === 'stale' || (state === 'no_voice' && Boolean(resolveSpeaker(s, cast)?.voiceHint));
  }).length;

  const voices = useMutation({
    mutationFn: () => api.projectVoices(id!),
    onSuccess: (res) => {
      toast({
        title: res.voiceJobs ? `Designing ${res.voiceJobs} voice${res.voiceJobs === 1 ? '' : 's'}, then recording the lines` : `Recording ${res.lineJobs} line${res.lineJobs === 1 ? '' : 's'}`,
        description: res.needsVoice.length ? `No voice yet for ${res.needsVoice.join(', ')}: give them one in Cast.` : undefined,
        variant: 'success',
      });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast({ title: 'Could not record lines', description: (err as Error).message, variant: 'error' }),
  });

  const render = useMutation({
    mutationFn: (what: 'keyframes' | 'videos') => api.renderProject(id!, { what, onlyMissing: true }),
    onSuccess: () => {
      toast({ title: 'Render queued', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast({ title: 'Render failed', description: (err as Error).message, variant: 'error' }),
  });

  function animateShots() {
    // Video is the slow part (minutes per shot), so confirm before queueing a whole board.
    if (window.confirm(`Animate ${needVideos} shot${needVideos === 1 ? '' : 's'}? Each takes a few minutes.`)) render.mutate('videos');
  }

  const exportMutation = useMutation({
    mutationFn: () => api.exportProject(id!),
    onSuccess: () => toast({ title: 'Export started', variant: 'success' }),
    onError: (err) => toast({ title: 'Export failed', description: (err as Error).message, variant: 'error' }),
  });
  const backupMutation = useMutation({
    mutationFn: () => api.backupProject(id!),
    onSuccess: (res) => {
      toast({ title: `Preparing ${res.count} file${res.count === 1 ? '' : 's'}…`, variant: 'success' });
      startDownload(res.url);
    },
    onError: (err) => toast({ title: 'Back up failed', description: (err as Error).message, variant: 'error' }),
  });

  const exportJob = Object.values(jobs).find((j) => j.projectId === id && j.type === 'project_export');
  const exportDone = exportJob?.status === 'done';
  const exportAssetId = data?.project.exportAssetId ?? (exportDone ? exportJob?.outputAssetIds[0] : undefined);
  const { data: exportAsset } = useQuery({ queryKey: ['asset', exportAssetId], queryFn: () => api.asset(exportAssetId!), enabled: !!exportAssetId });

  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: api.locations });

  if (isLoading || !data) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { project, scenes } = data;

  return (
    <div className="flex size-full flex-col overflow-y-auto md:overflow-hidden">
      <div className="shrink-0 border-b border-[var(--color-hairline)] px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                debouncedName(e.target.value);
              }}
              className="w-full max-w-xl bg-transparent font-serif text-3xl text-[var(--color-ink-0)] outline-none"
              placeholder="Untitled Film"
            />
            <input
              value={logline}
              onChange={(e) => {
                setLogline(e.target.value);
                debouncedLogline(e.target.value);
              }}
              placeholder="Logline…"
              className="mt-1 w-full max-w-xl bg-transparent text-sm text-[var(--color-ink-2)] outline-none placeholder:text-[var(--color-ink-3)]"
            />
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <div className="max-w-full overflow-x-auto">
              <Segmented options={ASPECTS.map((a) => ({ value: a, label: a }))} value={project.aspect} onChange={(v) => patchProject.mutate({ aspect: v })} size="sm" />
            </div>
            <StylePicker projectId={project.id} styleId={project.styleId} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {needFrames > 0 && (
            <Tooltip label="Creates any missing cast and location references first, so characters look the same in every shot">
              <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} loading={render.isPending} onClick={() => render.mutate('keyframes')}>
                Generate {needFrames} frame{needFrames === 1 ? '' : 's'}
              </Button>
            </Tooltip>
          )}
          {needVideos > 0 && !isOff('wan_i2v') && (
            <Button size="sm" variant={needFrames > 0 ? 'secondary' : 'primary'} icon={<Video className="size-3.5" />} loading={render.isPending} onClick={animateShots}>
              Animate {needVideos} shot{needVideos === 1 ? '' : 's'}
            </Button>
          )}
          {linesToRecord > 0 && system?.voice === 'ready' && (
            <Tooltip label="Records every line in its speaker's voice, designing voices from their suggestions first. Export mixes the lines into silent clips.">
              <Button size="sm" variant="secondary" icon={<AudioLines className="size-3.5" />} loading={voices.isPending} onClick={() => voices.mutate()}>
                Record {linesToRecord} line{linesToRecord === 1 ? '' : 's'}
              </Button>
            </Tooltip>
          )}
          {exportAsset ? (
            <a href={mediaUrl(exportAsset.file)} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />}>
                Download film
              </Button>
            </a>
          ) : (
            hasVideo && (
              <Button size="sm" variant={needFrames + needVideos === 0 ? 'primary' : 'secondary'} loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
                Export film
              </Button>
            )
          )}
          {shotCount > 0 && (
            <Tooltip label="Download everything in this film as a ZIP: final cut, shots, keyframes, cast and locations">
              <Button
                size="sm"
                variant="secondary"
                icon={<Archive className="size-3.5" />}
                loading={backupMutation.isPending}
                onClick={() => backupMutation.mutate()}
              >
                Back up
              </Button>
            </Tooltip>
          )}
        </div>

        <div className="mt-4">
          <Tabs
            tabs={[
              { value: 'script', label: 'Script' },
              { value: 'storyboard', label: 'Storyboard' },
              { value: 'timeline', label: 'Timeline' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="md:flex-1 md:overflow-y-auto">
        {tab === 'storyboard' && (
          <StoryboardTab project={project} scenes={scenes} characters={characters ?? []} locations={locations ?? []} onWriteScript={() => setTab('script')} />
        )}
        {tab === 'script' && <ScriptTab project={project} autoBreakdown={autoBreakdown} onApplied={() => setTab('storyboard')} />}
        {tab === 'timeline' && <TimelineTab project={project} scenes={scenes} />}
      </div>
    </div>
  );
}

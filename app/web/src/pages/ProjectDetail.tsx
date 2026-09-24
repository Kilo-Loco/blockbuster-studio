import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Palette, Plus, Sparkles, Video } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import type { AspectRatio, Style } from '@shared/types';
import { ASPECTS } from '@shared/presets';
import { Button, Dialog, Popover, Segmented, Skeleton, Tabs } from '../components/ui';
import { StoryboardTab } from '../components/project/StoryboardTab';
import { ScriptTab } from '../components/project/ScriptTab';
import { TimelineTab } from '../components/project/TimelineTab';
import { useDebouncedCallback } from '../components/project/hooks';

type TabKey = 'storyboard' | 'script' | 'timeline';

function NewStyleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.createStyle({ name: name.trim() || 'Untitled style', prompt: prompt.trim(), negativePrompt: negativePrompt.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['styles'] });
      toast({ title: 'Style created', variant: 'success' });
      onClose();
      setName('');
      setPrompt('');
      setNegativePrompt('');
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
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Negative prompt</span>
          <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} rows={2} className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none" />
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
  const [tab, setTab] = useState<TabKey>('storyboard');
  const jobs = useJobsStore((s) => s.jobs);

  const { data, isLoading } = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id!), enabled: !!id });

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

  const shotCount = useMemo(() => data?.scenes.reduce((n, s) => n + s.shots.length, 0) ?? 0, [data]);

  const render = useMutation({
    mutationFn: (what: 'keyframes' | 'videos') => api.renderProject(id!, { what, onlyMissing: true }),
    onSuccess: () => {
      toast({ title: 'Render queued', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast({ title: 'Render failed', description: (err as Error).message, variant: 'error' }),
  });

  function confirmRender(what: 'keyframes' | 'videos') {
    const label = what === 'keyframes' ? 'keyframes' : 'videos';
    if (window.confirm(`Render ${label} for all ${shotCount} shot${shotCount === 1 ? '' : 's'} missing them?`)) {
      render.mutate(what);
    }
  }

  const exportMutation = useMutation({
    mutationFn: () => api.exportProject(id!),
    onSuccess: () => toast({ title: 'Export started', variant: 'success' }),
    onError: (err) => toast({ title: 'Export failed', description: (err as Error).message, variant: 'error' }),
  });
  const exportJob = Object.values(jobs).find((j) => j.projectId === id && j.type === 'project_export');
  const exportDone = exportJob?.status === 'done';
  const exportAssetId = data?.project.exportAssetId ?? (exportDone ? exportJob?.outputAssetIds[0] : undefined);
  const { data: exportAsset } = useQuery({ queryKey: ['asset', exportAssetId], queryFn: () => api.asset(exportAssetId!), enabled: !!exportAssetId });

  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: api.locations });

  if (isLoading || !data) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { project, scenes } = data;

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--color-hairline)] px-6 py-4">
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
          <div className="flex flex-wrap items-center gap-2">
            <Segmented options={ASPECTS.map((a) => ({ value: a, label: a }))} value={project.aspect} onChange={(v) => patchProject.mutate({ aspect: v })} size="sm" />
            <StylePicker projectId={project.id} styleId={project.styleId} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Sparkles className="size-3.5" />} loading={render.isPending} onClick={() => confirmRender('keyframes')}>
            Render keyframes
          </Button>
          <Button size="sm" variant="secondary" icon={<Video className="size-3.5" />} loading={render.isPending} onClick={() => confirmRender('videos')}>
            Render videos
          </Button>
          {exportAsset ? (
            <a href={mediaUrl(exportAsset.file)} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />}>
                Download film
              </Button>
            </a>
          ) : (
            <Button size="sm" variant="primary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
              Export film
            </Button>
          )}
        </div>

        <div className="mt-4">
          <Tabs
            tabs={[
              { value: 'storyboard', label: 'Storyboard' },
              { value: 'script', label: 'Script' },
              { value: 'timeline', label: 'Timeline' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'storyboard' && <StoryboardTab project={project} scenes={scenes} characters={characters ?? []} locations={locations ?? []} />}
        {tab === 'script' && <ScriptTab project={project} onApplied={() => setTab('storyboard')} />}
        {tab === 'timeline' && <TimelineTab project={project} scenes={scenes} />}
      </div>
    </div>
  );
}

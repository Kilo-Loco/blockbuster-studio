import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, Film, Plus, Clapperboard, PenLine } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast } from '../lib/store';
import { Button, Dialog, Segmented, Skeleton } from '../components/ui';
import type { AspectRatio, Project } from '@shared/types';
import { ASPECTS } from '@shared/presets';

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: detail } = useQuery({ queryKey: ['project', project.id], queryFn: () => api.project(project.id) });
  const shotCount = detail?.scenes.reduce((n, s) => n + s.shots.length, 0);
  const { data: cover } = useQuery({
    queryKey: ['asset', project.coverAssetId],
    queryFn: () => api.asset(project.coverAssetId!),
    enabled: !!project.coverAssetId,
  });

  return (
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] text-left transition-all hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-bg-2)]"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--color-bg-2)]">
        {cover ? (
          <img
            src={mediaUrl(cover.thumb ?? cover.file)}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-[var(--color-bg-3)] to-[var(--color-bg-1)]">
            <span className="px-4 text-center font-serif text-2xl text-[var(--color-ink-2)]">{project.name}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="truncate font-serif text-lg text-[var(--color-ink-0)]">{project.name}</h3>
        {project.logline && <p className="line-clamp-2 text-sm text-[var(--color-ink-2)]">{project.logline}</p>}
        <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-[var(--color-ink-3)]">
          <span className="chip-mono">{project.aspect}</span>
          {shotCount !== undefined && (
            <span className="flex items-center gap-1">
              <Clapperboard className="size-3" /> {shotCount} {shotCount === 1 ? 'shot' : 'shots'}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

type NewFilmMode = 'previs' | 'script';

function ModeChoice({ onPick }: { onPick: (mode: NewFilmMode) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => onPick('previs')}
        className="flex flex-col gap-1 rounded-xl border border-[var(--color-hairline)] p-4 text-left transition-colors hover:border-[var(--color-amber-400)]/50 hover:bg-[var(--color-amber-400)]/5"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink-0)]">
          <Boxes className="size-4 text-[var(--color-amber-300)]" /> I have a previs
          <span className="rounded-full bg-[var(--color-amber-400)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-amber-300)]">Recommended</span>
        </span>
        <span className="text-xs text-[var(--color-ink-2)]">Your camera moves and cuts come from a 3D blockout made in Blender, or by an AI agent.</span>
      </button>
      <button
        onClick={() => onPick('script')}
        className="flex flex-col gap-1 rounded-xl border border-[var(--color-hairline)] p-4 text-left transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-white/6"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink-0)]">
          <PenLine className="size-4 text-[var(--color-ink-2)]" /> Start from a script
        </span>
        <span className="text-xs text-[var(--color-ink-2)]">Write or paste an idea; the studio plans the shots.</span>
      </button>
    </div>
  );
}

function NewFilmDialog({ open, onClose, initialMode }: { open: boolean; onClose: () => void; initialMode?: NewFilmMode }) {
  const [mode, setMode] = useState<NewFilmMode | null>(initialMode ?? null);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });
  // With an AI connected, the idea goes straight into a breakdown (Script tab → review → storyboard).
  const breakdownNext = mode === 'script' && Boolean(idea.trim() && system?.llmConfigured);
  const navigate = useNavigate();
  const qc = useQueryClient();

  function reset() {
    setMode(initialMode ?? null);
    setName('');
    setIdea('');
    setAspect('16:9');
  }
  useEffect(() => {
    if (open) setMode(initialMode ?? null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: async () => {
      const project = await api.createProject({ name: name.trim() || 'Untitled Film', script: mode === 'script' ? idea.trim() || undefined : undefined, aspect, mode: mode ?? undefined });
      // A previs film starts with its first scene, so the guided steps are the first thing on the page.
      if (mode === 'previs') await api.createScene(project.id, { title: 'Scene 1' });
      return project;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Film created', variant: 'success' });
      onClose();
      reset();
      navigate(`/projects/${project.id}`, { state: { breakdown: breakdownNext } });
    },
    onError: (err) => toast({ title: 'Could not create film', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="New film"
    >
      {mode === null ? (
        <ModeChoice onPick={setMode} />
      ) : (
        <div className="flex flex-col gap-4">
          <button onClick={() => setMode(null)} className="flex items-center gap-1 self-start text-xs text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]">
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled Film"
              className="h-10 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </label>
          {mode === 'script' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--color-ink-2)]">What's it about?</span>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={5}
                placeholder="A one-line idea, a treatment, or a full screenplay…"
                className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
              />
              <span className="text-[11px] text-[var(--color-ink-3)]">
                {system?.llmConfigured
                  ? 'The AI turns it into characters, locations, scenes and shots for you to review.'
                  : 'Connect an AI in Settings to turn this into scenes and shots automatically.'}
              </span>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Aspect ratio</span>
            <Segmented options={ASPECTS.map((a) => ({ value: a, label: a }))} value={aspect} onChange={setAspect} size="sm" />
            <span className="text-[11px] text-[var(--color-ink-3)]">Every shot uses it. Changing it later means re-rendering frames.</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              {breakdownNext ? 'Create and break down' : 'Create film'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function Projects() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<NewFilmMode | undefined>(undefined);
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  function openNewFilm(mode?: NewFilmMode) {
    setDialogMode(mode);
    setDialogOpen(true);
  }

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl text-[var(--color-ink-0)]">Projects</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Your films, from idea to export.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openNewFilm()}>
            New film
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3.4] w-full" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-[var(--color-hairline)] py-20 text-center">
            <Film className="size-10 text-[var(--color-ink-3)]" />
            <div>
              <h2 className="font-serif text-2xl text-[var(--color-ink-0)]">Start your first film</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">Bring a previs, or write your idea and get a storyboard to shape, shot by shot.</p>
            </div>
            <div className="grid w-full max-w-xl grid-cols-1 gap-3 px-4 sm:grid-cols-2">
              <button
                onClick={() => openNewFilm('previs')}
                className="flex flex-col gap-1 rounded-xl border border-[var(--color-hairline)] p-4 text-left transition-colors hover:border-[var(--color-amber-400)]/50 hover:bg-[var(--color-amber-400)]/5"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink-0)]">
                  <Boxes className="size-4 text-[var(--color-amber-300)]" /> I have a previs
                  <span className="rounded-full bg-[var(--color-amber-400)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-amber-300)]">Recommended</span>
                </span>
                <span className="text-xs text-[var(--color-ink-2)]">Camera moves and cuts from a 3D blockout.</span>
              </button>
              <button
                onClick={() => openNewFilm('script')}
                className="flex flex-col gap-1 rounded-xl border border-[var(--color-hairline)] p-4 text-left transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-white/6"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink-0)]">
                  <PenLine className="size-4 text-[var(--color-ink-2)]" /> Start from a script
                </span>
                <span className="text-xs text-[var(--color-ink-2)]">Write or paste an idea; the studio plans the shots.</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <NewFilmDialog open={dialogOpen} onClose={() => setDialogOpen(false)} initialMode={dialogMode} />
    </div>
  );
}

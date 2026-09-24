import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Plus, Clapperboard } from 'lucide-react';
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

function NewFilmDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [logline, setLogline] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.createProject({ name: name.trim() || 'Untitled Film', logline: logline.trim() || undefined, aspect }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Film created', variant: 'success' });
      onClose();
      setName('');
      setLogline('');
      setAspect('16:9');
      navigate(`/projects/${project.id}`);
    },
    onError: (err) => toast({ title: 'Could not create film', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New film">
      <div className="flex flex-col gap-4">
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
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Logline</span>
          <textarea
            value={logline}
            onChange={(e) => setLogline(e.target.value)}
            rows={2}
            placeholder="A one-sentence pitch…"
            className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Aspect ratio</span>
          <Segmented options={ASPECTS.map((a) => ({ value: a, label: a }))} value={aspect} onChange={setAspect} size="sm" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Create film
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function Projects() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl text-[var(--color-ink-0)]">Projects</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Your films, from idea to export.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialogOpen(true)}>
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
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[var(--color-hairline)] py-24 text-center">
            <Film className="size-10 text-[var(--color-ink-3)]" />
            <div>
              <h2 className="font-serif text-2xl text-[var(--color-ink-0)]">Start your first film</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">Give it a name, and build the storyboard shot by shot.</p>
            </div>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialogOpen(true)}>
              New film
            </Button>
          </div>
        )}
      </div>

      <NewFilmDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

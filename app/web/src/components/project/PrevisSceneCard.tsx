import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, GripVertical, Trash2, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { toast } from '../../lib/store';
import type { AspectRatio, Character, Location, Scene, Shot, TimeOfDay } from '@shared/types';
import { TIMES_OF_DAY } from '@shared/presets';
import { Menu, Button } from '../ui';
import { ShotCard } from './ShotCard';
import { PrevisImportStep } from './PrevisImportStep';
import { CastLocationStep } from './CastLocationStep';
import { ReferenceSheetCard } from './ReferenceSheetCard';
import { useDebouncedCallback } from './hooks';
import { STATUS_LABEL } from './utils';

function StepShell({
  index,
  title,
  done,
  open,
  onToggle,
  summary,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-hairline)]">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <span
          className={clsx(
            'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
            done ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]' : 'bg-[var(--color-bg-3)] text-[var(--color-ink-2)]',
          )}
        >
          {done ? <Check className="size-3" /> : index}
        </span>
        <span className="text-sm font-medium text-[var(--color-ink-0)]">{title}</span>
        {!open && summary && <span className="truncate text-xs text-[var(--color-ink-3)]">{summary}</span>}
        <span className="flex-1" />
        {open ? <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-2)]" /> : <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-2)]" />}
      </button>
      {open && <div className="border-t border-[var(--color-hairline)] px-3 py-3">{children}</div>}
    </div>
  );
}

export function PrevisSceneCard({
  scene,
  projectId,
  aspect,
  characters,
  locations,
  onOpenShot,
  dragHandleProps,
}: {
  scene: Scene & { shots: Shot[] };
  projectId: string;
  aspect: AspectRatio;
  characters: Character[];
  locations: Location[];
  onOpenShot: (shot: Shot) => void;
  dragHandleProps?: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState(scene.title);
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'project' });

  const patchScene = useMutation({
    mutationFn: (patch: Partial<Scene>) => api.updateScene(scene.id, patch),
    onSuccess: invalidate,
  });
  const debouncedTitle = useDebouncedCallback((v: string) => patchScene.mutate({ title: v }), 700);

  const deleteScene = useMutation({
    mutationFn: () => api.deleteScene(scene.id),
    onSuccess: invalidate,
  });

  const { data: previsAsset } = useQuery({ queryKey: ['asset', scene.previsAssetId], queryFn: () => api.asset(scene.previsAssetId!), enabled: !!scene.previsAssetId });

  const shots = scene.shots;
  const castIds = scene.castIds ?? [];

  // Step completion, in the order the flow unlocks.
  const previsDone = Boolean(scene.previsAssetId) && shots.length > 0;
  const castLocationDone = Boolean(scene.locationId) || castIds.length > 0;
  const sheetDone = Boolean(scene.referenceSheetAssetId);
  const shotsReady = shots.length > 0 && shots.every((s) => Boolean(s.videoAssetId));
  const renderDone = shots.length > 0 && shotsReady;

  const steps = [previsDone, castLocationDone, sheetDone, renderDone];
  const firstOpenIndex = steps.findIndex((d) => !d);
  const defaultOpen = firstOpenIndex === -1 ? -1 : firstOpenIndex; // -1: everything done, all collapsed
  const [openStep, setOpenStep] = useState(defaultOpen);
  function toggle(i: number) {
    setOpenStep((cur) => (cur === i ? -1 : i));
  }

  const previsDuration = previsAsset?.durationSec ?? shots.reduce((n, s) => n + s.durationSec, 0);
  const previsSummary = previsDone ? `${previsDuration.toFixed(1)} s · ${shots.length} shot${shots.length === 1 ? '' : 's'}` : undefined;
  const location = locations.find((l) => l.id === scene.locationId);
  const castLocationSummary = castLocationDone ? [location?.name, castIds.length ? `${castIds.length} cast` : undefined].filter(Boolean).join(' · ') : undefined;

  const needVideos = shots.filter((s) => !s.videoAssetId && s.status !== 'video_queued').length;
  const animated = shots.filter((s) => s.videoAssetId).length;
  const rendering = shots.filter((s) => s.status === 'video_queued').length;
  const renderPending = Boolean(scene.previsAssetId && scene.referenceSheetAssetId);

  const render = useMutation({
    mutationFn: () => api.renderProject(projectId, { what: 'videos', sceneId: scene.id, onlyMissing: true }),
    onSuccess: () => {
      toast({ title: 'Render queued', variant: 'success' });
      invalidate();
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast({ title: 'Render failed', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {dragHandleProps && (
          <span {...dragHandleProps} className="cursor-grab text-[var(--color-ink-3)] active:cursor-grabbing">
            <GripVertical className="size-4" />
          </span>
        )}
        <button onClick={() => setCollapsed((c) => !c)} className="text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            debouncedTitle(e.target.value);
          }}
          placeholder="INT. LOCATION - DAY"
          className="min-w-[14rem] flex-1 bg-transparent font-serif text-lg text-[var(--color-ink-0)] outline-none placeholder:text-[var(--color-ink-3)]"
        />
        <select
          value={scene.timeOfDay}
          onChange={(e) => patchScene.mutate({ timeOfDay: e.target.value as TimeOfDay })}
          className="h-8 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2 text-xs capitalize text-[var(--color-ink-1)] outline-none"
        >
          {TIMES_OF_DAY.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Menu
          items={[
            {
              label: 'Delete scene',
              icon: <Trash2 className="size-3.5" />,
              danger: true,
              onClick: () => {
                if (confirm(`Delete "${scene.title || 'this scene'}" and its ${shots.length} shot(s)?`)) deleteScene.mutate();
              },
            },
          ]}
        />
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <StepShell index={1} title="Previs" done={previsDone} open={openStep === 0} onToggle={() => toggle(0)} summary={previsSummary}>
            <PrevisImportStep scene={scene} shots={shots} projectId={projectId} />
          </StepShell>

          <StepShell index={2} title="Cast & location" done={castLocationDone} open={openStep === 1} onToggle={() => toggle(1)} summary={castLocationSummary}>
            <CastLocationStep scene={scene} characters={characters} locations={locations} projectId={projectId} />
          </StepShell>

          <StepShell index={3} title="Reference sheet" done={sheetDone} open={openStep === 2} onToggle={() => toggle(2)} summary={sheetDone ? 'Built' : undefined}>
            <ReferenceSheetCard scene={scene} shots={shots} characters={characters} projectId={projectId} requireCast />
          </StepShell>

          <StepShell
            index={4}
            title="Render"
            done={renderDone}
            open={openStep === 3}
            onToggle={() => toggle(3)}
            summary={renderDone ? 'All shots animated' : shots.length ? `${animated}/${shots.length} animated${rendering ? ` · ${rendering} rendering` : ''}` : undefined}
          >
            <div className="flex flex-col gap-3">
              {needVideos > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Video className="size-3.5" />}
                  loading={render.isPending}
                  disabled={!renderPending}
                  onClick={() => render.mutate()}
                  className="self-start"
                >
                  Animate {needVideos} shot{needVideos === 1 ? '' : 's'}
                </Button>
              )}
              {!renderPending && <p className="text-xs text-[var(--color-ink-3)]">Finish the previs and reference sheet steps first.</p>}
              <p className="text-xs text-[var(--color-ink-3)]">Draft at Fast, then switch final shots to HD.</p>
              {shots.length === 0 && <p className="text-xs text-[var(--color-ink-3)]">No shots yet — import a previs first.</p>}
            </div>
          </StepShell>

          {shots.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pt-1">
              {shots.map((shot, i) => (
                <ShotCard key={shot.id} shot={shot} aspect={aspect} order={i + 1} characters={characters} onClick={() => onOpenShot(shot)} previs />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GripVertical, MapPinned, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import type { Character, Location, Scene, Shot, TimeOfDay } from '@shared/types';
import { TIMES_OF_DAY } from '@shared/presets';
import { Menu, Button } from '../ui';
import { ShotCard } from './ShotCard';
import { useDebouncedCallback } from './hooks';

export function SceneCard({
  scene,
  projectId,
  characters,
  locations,
  onOpenShot,
  onOpenBlocking,
  dragHandleProps,
}: {
  scene: Scene & { shots: Shot[] };
  projectId: string;
  characters: Character[];
  locations: Location[];
  onOpenShot: (shot: Shot) => void;
  onOpenBlocking: (scene: Scene & { shots: Shot[] }) => void;
  dragHandleProps?: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState(scene.title);
  const [dragShotId, setDragShotId] = useState<string | null>(null);
  const [overShotId, setOverShotId] = useState<string | null>(null);
  const qc = useQueryClient();

  const patchScene = useMutation({
    mutationFn: (patch: Partial<Scene>) => api.updateScene(scene.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });
  const debouncedTitle = useDebouncedCallback((v: string) => patchScene.mutate({ title: v }), 700);

  const deleteScene = useMutation({
    mutationFn: () => api.deleteScene(scene.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const createShot = useMutation({
    mutationFn: () => api.createShot(scene.id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const reorderShots = useMutation({
    mutationFn: (ids: string[]) => api.reorderShots(scene.id, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  function handleShotDrop(targetId: string) {
    if (!dragShotId || dragShotId === targetId) {
      setDragShotId(null);
      setOverShotId(null);
      return;
    }
    const ids = scene.shots.map((s) => s.id);
    const from = ids.indexOf(dragShotId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragShotId(null);
    setOverShotId(null);
    reorderShots.mutate(ids);
  }

  const location = locations.find((l) => l.id === scene.locationId);

  return (
    <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]">
      <div className="flex items-center gap-2 px-4 py-3">
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
          className="min-w-0 flex-1 bg-transparent font-serif text-lg text-[var(--color-ink-0)] outline-none placeholder:text-[var(--color-ink-3)]"
        />
        <select
          value={scene.locationId ?? ''}
          onChange={(e) => patchScene.mutate({ locationId: e.target.value || undefined })}
          className="h-8 max-w-[160px] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2 text-xs text-[var(--color-ink-1)] outline-none"
        >
          <option value="">No location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
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
        <Button size="sm" variant="secondary" icon={<MapPinned className="size-3.5" />} onClick={() => onOpenBlocking(scene)}>
          Blocking
        </Button>
        <Menu
          items={[
            {
              label: 'Delete scene',
              icon: <Trash2 className="size-3.5" />,
              danger: true,
              onClick: () => {
                if (confirm(`Delete "${scene.title || 'this scene'}" and its ${scene.shots.length} shot(s)?`)) deleteScene.mutate();
              },
            },
          ]}
        />
      </div>

      {!collapsed && (
        <div className="flex gap-3 overflow-x-auto px-4 pb-4">
          {scene.shots.map((shot, i) => (
            <div
              key={shot.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOverShotId(shot.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleShotDrop(shot.id);
              }}
            >
              <ShotCard
                shot={shot}
                order={i + 1}
                characters={characters}
                onClick={() => onOpenShot(shot)}
                draggable
                dropIndicator={overShotId === shot.id && dragShotId !== shot.id}
                onDragStart={() => setDragShotId(shot.id)}
              />
            </div>
          ))}
          <button
            onClick={() => createShot.mutate()}
            disabled={createShot.isPending}
            className={clsx(
              'flex w-40 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-hairline)] text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-ink-0)]',
              'aspect-video',
            )}
          >
            <Plus className="size-5" />
            <span className="text-xs font-medium">Shot</span>
          </button>
        </div>
      )}
    </div>
  );
}

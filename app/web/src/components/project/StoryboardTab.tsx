import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import type { Character, Location, Project, Scene, Shot } from '@shared/types';
import { Button } from '../ui';
import { SceneCard } from './SceneCard';
import { PrevisSceneCard } from './PrevisSceneCard';
import { ShotPanel } from './ShotPanel';
import { BlockingDialog } from './BlockingDialog';

export function StoryboardTab({
  project,
  scenes,
  characters,
  locations,
  onWriteScript,
}: {
  project: Project;
  scenes: (Scene & { shots: Shot[] })[];
  characters: Character[];
  locations: Location[];
  onWriteScript: () => void;
}) {
  const qc = useQueryClient();
  const [openShot, setOpenShot] = useState<{ shot: Shot; scene: Scene } | null>(null);
  const [blockingScene, setBlockingScene] = useState<(Scene & { shots: Shot[] }) | null>(null);
  const [dragSceneId, setDragSceneId] = useState<string | null>(null);

  const createScene = useMutation({
    mutationFn: () => api.createScene(project.id, { title: 'New Scene', timeOfDay: 'day' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  const reorderScenes = useMutation({
    mutationFn: (ids: string[]) => api.reorderScenes(project.id, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  function handleDrop(targetId: string) {
    if (!dragSceneId || dragSceneId === targetId) {
      setDragSceneId(null);
      return;
    }
    const ids = scenes.map((s) => s.id);
    const from = ids.indexOf(dragSceneId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragSceneId(null);
    reorderScenes.mutate(ids);
  }

  // Re-derive the open shot/scene from the live project data so SSE updates flow into the panel for free.
  const liveOpenShot = openShot
    ? (() => {
        const scene = scenes.find((s) => s.id === openShot.scene.id);
        const shot = scene?.shots.find((s) => s.id === openShot.shot.id);
        return scene && shot ? { shot, scene } : null;
      })()
    : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:px-6">
      {scenes.length === 0 && project.mode === 'previs' && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-hairline)] py-16 text-center">
          <p className="text-sm text-[var(--color-ink-1)]">No scenes yet.</p>
          <p className="max-w-md text-xs text-[var(--color-ink-2)]">Add a scene for each previs you have. Each scene walks you through the steps.</p>
        </div>
      )}
      {scenes.length === 0 && project.mode !== 'previs' && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-hairline)] py-16 text-center">
          <p className="text-sm text-[var(--color-ink-1)]">No scenes yet.</p>
          <p className="max-w-md text-xs text-[var(--color-ink-2)]">
            Write your idea or paste a script, and the AI breaks it into scenes and shots. Or add scenes by hand below.
          </p>
          <Button variant="primary" size="sm" onClick={onWriteScript}>
            Write the script
          </Button>
        </div>
      )}
      {scenes.map((scene) => (
        <div
          key={scene.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(scene.id);
          }}
        >
          {project.mode === 'previs' ? (
            <PrevisSceneCard
              scene={scene}
              projectId={project.id}
              aspect={project.aspect}
              characters={characters}
              locations={locations}
              onOpenShot={(shot) => setOpenShot({ shot, scene })}
              dragHandleProps={{
                draggable: true,
                onDragStart: () => setDragSceneId(scene.id),
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => {
                  e.preventDefault();
                  handleDrop(scene.id);
                },
              }}
            />
          ) : (
            <SceneCard
              scene={scene}
              projectId={project.id}
              aspect={project.aspect}
              characters={characters}
              locations={locations}
              onOpenShot={(shot) => setOpenShot({ shot, scene })}
              onOpenBlocking={setBlockingScene}
              dragHandleProps={{
                draggable: true,
                onDragStart: () => setDragSceneId(scene.id),
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => {
                  e.preventDefault();
                  handleDrop(scene.id);
                },
              }}
            />
          )}
        </div>
      ))}
      <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => createScene.mutate()} loading={createScene.isPending} className="self-start">
        Add scene
      </Button>

      {liveOpenShot && (
        <ShotPanel
          shot={liveOpenShot.shot}
          scene={liveOpenShot.scene}
          project={project}
          characters={characters}
          location={locations.find((l) => l.id === liveOpenShot.scene.locationId)}
          onClose={() => setOpenShot(null)}
        />
      )}

      {blockingScene && (
        <BlockingDialog
          open
          onClose={() => setBlockingScene(null)}
          scene={blockingScene}
          location={locations.find((l) => l.id === blockingScene.locationId)}
          characters={characters}
          projectId={project.id}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset, Character, GenerateRequest, Location } from '@shared/types';
import { api, mediaUrl, startDownload } from '../../lib/api';
import { toast, useComposerStore, type ComposerState } from '../../lib/store';
import { Button, Chip, Dialog, IconButton, Menu } from '../ui';
import { ChevronLeft, ChevronRight, Clapperboard, Compass, Copy, Download, Drama, Heart, MapPin, RotateCcw, Trash2, Users, Video, Wand2, X } from 'lucide-react';

export function Viewer({
  assets,
  index,
  onIndexChange,
  onClose,
}: {
  assets: Asset[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const asset = assets[index];
  const qc = useQueryClient();
  const prefillFromAsset = useComposerStore((s) => s.prefillFromAsset);
  const prefillPerformSlot = useComposerStore((s) => s.prefillPerformSlot);
  const setComposer = useComposerStore((s) => s.set);
  const [favorite, setFavorite] = useState(asset?.favorite ?? false);
  const [pickerMode, setPickerMode] = useState<null | 'character' | 'location' | 'shot'>(null);

  useEffect(() => setFavorite(asset?.favorite ?? false), [asset?.id, asset?.favorite]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') onIndexChange(Math.min(assets.length - 1, index + 1));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, assets.length, onClose, onIndexChange]);

  if (!asset) return null;
  const params = (asset.params ?? {}) as Partial<GenerateRequest>;

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    try {
      await api.updateAsset(asset.id, { favorite: next });
      qc.invalidateQueries({ queryKey: ['assets'] });
    } catch {
      setFavorite(!next);
      toast({ title: 'Could not update favorite', variant: 'error' });
    }
  }

  function download() {
    const url = mediaUrl(asset.file);
    if (!url) return;
    startDownload(url);
  }

  async function copyPrompt() {
    if (!asset.prompt) return;
    try {
      await navigator.clipboard.writeText(asset.prompt);
      toast({ title: 'Prompt copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', variant: 'error' });
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this asset? This cannot be undone.')) return;
    try {
      await api.deleteAsset(asset.id);
      qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    } catch {
      toast({ title: 'Delete failed', variant: 'error' });
    }
  }

  function goAnimate() {
    prefillFromAsset(asset, 'video');
    onClose();
  }
  function goAngle() {
    prefillFromAsset(asset, 'angles');
    onClose();
  }
  function goEdit() {
    prefillFromAsset(asset, 'edit');
    onClose();
  }
  function goPerform() {
    prefillPerformSlot(asset, asset.kind === 'video' ? 'performance' : 'character');
    onClose();
  }
  function reuseSettings() {
    const patch: Partial<ComposerState> = {};
    if (params.aspect) patch.aspect = params.aspect;
    if (params.count) patch.count = params.count;
    if (params.durationSec) patch.durationSec = params.durationSec;
    if (params.quality) patch.quality = params.quality;
    if (params.cameraMove) patch.cameraMove = params.cameraMove;
    if (params.seed !== undefined) {
      patch.seed = params.seed;
      patch.seedLocked = true;
    }
    if (params.loras) patch.loras = params.loras;
    setComposer(patch);
    toast({ title: 'Settings applied to composer', variant: 'success' });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {asset.engine && <Chip mono>{asset.engine}</Chip>}
          <Chip mono>
            {asset.width}×{asset.height}
          </Chip>
          {asset.durationSec !== undefined && <Chip mono>{Math.round(asset.durationSec)}s</Chip>}
          {typeof params.seed === 'number' && <Chip mono>seed {params.seed}</Chip>}
          <Chip mono>{new Date(asset.createdAt).toLocaleDateString()}</Chip>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton
            icon={<Heart className={favorite ? 'size-4 fill-[var(--color-amber-400)] text-[var(--color-amber-400)]' : 'size-4'} />}
            label="Favorite"
            active={favorite}
            onClick={toggleFavorite}
          />
          <IconButton icon={<Download className="size-4" />} label="Download" onClick={download} />
          <Menu
            items={[
              { label: 'Use as character reference', icon: <Users className="size-4" />, onClick: () => setPickerMode('character') },
              { label: 'Use as location establishing shot', icon: <MapPin className="size-4" />, onClick: () => setPickerMode('location') },
              { label: 'Add to shot', icon: <Clapperboard className="size-4" />, onClick: () => setPickerMode('shot') },
              { label: 'Delete', icon: <Trash2 className="size-4" />, onClick: () => void handleDelete(), danger: true },
            ]}
          />
          <IconButton icon={<X className="size-4" />} label="Close" onClick={onClose} />
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {index > 0 && (
          <IconButton
            icon={<ChevronLeft className="size-5" />}
            label="Previous"
            size="lg"
            className="absolute left-2 z-10 bg-black/40 hover:bg-black/60"
            onClick={() => onIndexChange(index - 1)}
          />
        )}
        {asset.kind === 'video' ? (
          <video
            key={asset.id}
            src={mediaUrl(asset.file)}
            poster={mediaUrl(asset.thumb)}
            controls
            autoPlay
            loop
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : (
          <img key={asset.id} src={mediaUrl(asset.file)} alt={asset.prompt ?? ''} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {index < assets.length - 1 && (
          <IconButton
            icon={<ChevronRight className="size-5" />}
            label="Next"
            size="lg"
            className="absolute right-2 z-10 bg-black/40 hover:bg-black/60"
            onClick={() => onIndexChange(index + 1)}
          />
        )}
      </div>

      {asset.prompt && (
        <div className="flex items-start gap-2 border-t border-white/10 px-4 py-3">
          <p className="flex-1 text-sm text-[var(--color-ink-1)]">{asset.prompt}</p>
          <IconButton icon={<Copy className="size-4" />} label="Copy prompt" onClick={() => void copyPrompt()} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        <Button variant="secondary" size="sm" icon={<Video className="size-3.5" />} onClick={goAnimate}>
          Animate
        </Button>
        <Button variant="secondary" size="sm" icon={<Compass className="size-3.5" />} onClick={goAngle}>
          New angle
        </Button>
        <Button variant="secondary" size="sm" icon={<Wand2 className="size-3.5" />} onClick={goEdit}>
          Edit
        </Button>
        <Button variant="secondary" size="sm" icon={<Drama className="size-3.5" />} onClick={goPerform}>
          {asset.kind === 'video' ? 'Perform as a character' : 'Use as Perform character'}
        </Button>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={reuseSettings}>
          Reuse settings
        </Button>
      </div>

      {pickerMode === 'character' && <CharacterPicker assetId={asset.id} onClose={() => setPickerMode(null)} />}
      {pickerMode === 'location' && <LocationPicker assetId={asset.id} onClose={() => setPickerMode(null)} />}
      {pickerMode === 'shot' && <ShotPicker asset={asset} onClose={() => setPickerMode(null)} />}
    </div>
  );
}

function CharacterPicker({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const qc = useQueryClient();

  async function pick(c: Character) {
    try {
      const ids = Array.from(new Set([...c.referenceAssetIds, assetId]));
      await api.updateCharacter(c.id, { referenceAssetIds: ids });
      qc.invalidateQueries({ queryKey: ['characters'] });
      toast({ title: `Added to ${c.name}`, variant: 'success' });
      onClose();
    } catch {
      toast({ title: 'Could not update character', variant: 'error' });
    }
  }

  return (
    <Dialog open onClose={onClose} title="Use as character reference">
      <div className="flex max-h-80 min-w-[280px] flex-col gap-1 overflow-y-auto">
        {(characters ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => void pick(c)}
            className="rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6"
          >
            {c.name}
          </button>
        ))}
        {characters && characters.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-ink-3)]">No characters yet.</p>}
      </div>
    </Dialog>
  );
}

function LocationPicker({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: api.locations });
  const qc = useQueryClient();

  async function pick(l: Location) {
    try {
      await api.updateLocation(l.id, { establishingAssetId: assetId });
      qc.invalidateQueries({ queryKey: ['locations'] });
      toast({ title: `Set as establishing shot for ${l.name}`, variant: 'success' });
      onClose();
    } catch {
      toast({ title: 'Could not update location', variant: 'error' });
    }
  }

  return (
    <Dialog open onClose={onClose} title="Use as location establishing shot">
      <div className="flex max-h-80 min-w-[280px] flex-col gap-1 overflow-y-auto">
        {(locations ?? []).map((l) => (
          <button
            key={l.id}
            onClick={() => void pick(l)}
            className="rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6"
          >
            {l.name}
          </button>
        ))}
        {locations && locations.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-ink-3)]">No locations yet.</p>}
      </div>
    </Dialog>
  );
}

function ShotPicker({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data: detail } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: !!projectId,
  });
  const qc = useQueryClient();

  async function pickShot(shotId: string) {
    try {
      const body = asset.kind === 'video' ? { videoAssetId: asset.id } : { keyframeAssetId: asset.id };
      await api.selectShotCandidate(shotId, body);
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Added to shot', variant: 'success' });
      onClose();
    } catch {
      toast({ title: 'Could not update shot', variant: 'error' });
    }
  }

  return (
    <Dialog open onClose={onClose} title={projectId ? 'Pick a shot' : 'Pick a project'}>
      {!projectId ? (
        <div className="flex max-h-80 min-w-[280px] flex-col gap-1 overflow-y-auto">
          {(projects ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setProjectId(p.id)}
              className="rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6"
            >
              {p.name}
            </button>
          ))}
          {projects && projects.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-ink-3)]">No projects yet.</p>}
        </div>
      ) : (
        <div className="flex max-h-80 min-w-[280px] flex-col gap-3 overflow-y-auto">
          <button onClick={() => setProjectId(null)} className="self-start text-xs text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]">
            ← Back to projects
          </button>
          {(detail?.scenes ?? []).map((scene) => (
            <div key={scene.id}>
              <p className="mb-1 text-xs font-medium text-[var(--color-ink-2)]">{scene.title}</p>
              <div className="flex flex-col gap-1">
                {scene.shots.map((shot, i) => (
                  <button
                    key={shot.id}
                    onClick={() => void pickShot(shot.id)}
                    className="rounded-lg px-3 py-1.5 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6"
                  >
                    {shot.action || `Shot ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {detail && detail.scenes.length === 0 && <p className="px-3 py-2 text-xs text-[var(--color-ink-3)]">No scenes yet.</p>}
        </div>
      )}
    </Dialog>
  );
}

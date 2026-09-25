import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Clapperboard, Film, RotateCcw, Wand2 } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../../lib/api';
import { toast } from '../../lib/store';
import { useJobsStore } from '../../lib/store';
import { useEngineState } from '../../hooks/useEngineState';
import type { Character, CameraMoveId, ID, Location, LoraRef, Project, Scene, Shot, ShotSize } from '@shared/types';
import { shotAngle, projectMarks } from '@shared/camera';
import { CAMERA_MOVES, DURATIONS, SHOT_SIZES } from '@shared/presets';
import { Sheet, Segmented, Button, Popover, Tooltip, Slider, Progress } from '../ui';
import { MiniMap } from './MiniMap';
import { useDebouncedCallback } from './hooks';
import { characterColor, effectiveBlocking, initials } from './utils';

function useShotPatch(shotId: ID, projectId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Shot>) => api.updateShot(shotId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (err) => toast({ title: 'Could not save shot', description: (err as Error).message, variant: 'error' }),
  });
}

function CandidateStrip({
  ids,
  activeId,
  onSelect,
  kind,
}: {
  ids: ID[];
  activeId: ID | undefined;
  onSelect: (id: ID) => void;
  kind: 'image' | 'video';
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto">
      {ids.map((id) => (
        <CandidateThumb key={id} id={id} active={id === activeId} onSelect={() => onSelect(id)} kind={kind} />
      ))}
    </div>
  );
}

function CandidateThumb({ id, active, onSelect, kind }: { id: ID; active: boolean; onSelect: () => void; kind: 'image' | 'video' }) {
  const { data: asset } = useQuery({ queryKey: ['asset', id], queryFn: () => api.asset(id) });
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-[var(--color-bg-2)]',
        active ? 'border-[var(--color-amber-400)]' : 'border-transparent hover:border-[var(--color-hairline-strong)]',
      )}
    >
      {asset && <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" />}
      {active && (
        <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--color-amber-400)] text-black">
          <Check className="size-2.5" />
        </span>
      )}
      {kind === 'video' && <Film className="absolute bottom-1 left-1 size-3 text-white/80" />}
    </button>
  );
}

export function ShotPanel({
  shot,
  scene,
  project,
  characters,
  location,
  onClose,
}: {
  shot: Shot;
  scene: Scene;
  project: Project;
  characters: Character[];
  location: Location | undefined;
  onClose: () => void;
}) {
  const patch = useShotPatch(shot.id, project.id);
  const { isOff } = useEngineState();
  const jobs = useJobsStore((s) => s.jobs);
  const activeJob = Object.values(jobs).find((j) => j.shotId === shot.id && (j.status === 'queued' || j.status === 'running'));

  const [action, setAction] = useState(shot.action);
  const [dialogue, setDialogue] = useState(shot.dialogue ?? '');
  const [seed, setSeed] = useState(shot.seed?.toString() ?? '');
  const [showAuto, setShowAuto] = useState(false);

  useEffect(() => {
    setAction(shot.action);
    setDialogue(shot.dialogue ?? '');
    setSeed(shot.seed?.toString() ?? '');
  }, [shot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedAction = useDebouncedCallback((v: string) => patch.mutate({ action: v }), 700);
  const debouncedDialogue = useDebouncedCallback((v: string) => patch.mutate({ dialogue: v || undefined }), 700);
  const debouncedSeed = useDebouncedCallback((v: string) => patch.mutate({ seed: v.trim() ? Number(v) : undefined }), 700);

  const { data: preview } = useQuery({ queryKey: ['shot-preview', shot.id], queryFn: () => api.shotPreview(shot.id) });
  const [keyframePrompt, setKeyframePrompt] = useState(shot.keyframePrompt ?? '');
  const [motionPrompt, setMotionPrompt] = useState(shot.motionPrompt ?? '');
  useEffect(() => {
    setKeyframePrompt(shot.keyframePrompt ?? preview?.keyframePrompt ?? '');
    setMotionPrompt(shot.motionPrompt ?? preview?.motionPrompt ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id, shot.keyframePrompt, shot.motionPrompt, preview?.keyframePrompt, preview?.motionPrompt]);
  const debouncedKeyframePrompt = useDebouncedCallback((v: string) => patch.mutate({ keyframePrompt: v }), 700);
  const debouncedMotionPrompt = useDebouncedCallback((v: string) => patch.mutate({ motionPrompt: v }), 700);

  const { data: loras } = useQuery({
    queryKey: ['loras', shot.keyframeMode === 'compose' ? 'qwen_edit' : 'zimage'],
    queryFn: () => api.loras(shot.keyframeMode === 'compose' ? 'qwen_edit' : 'zimage'),
  });

  const keyframeJob = useMutation({
    mutationFn: () => api.shotKeyframe(shot.id),
    onError: (err) => toast({ title: 'Could not start keyframe render', description: (err as Error).message, variant: 'error' }),
  });
  const videoJob = useMutation({
    mutationFn: () => api.shotVideo(shot.id),
    onError: (err) => toast({ title: 'Could not start video render', description: (err as Error).message, variant: 'error' }),
  });
  const qc = useQueryClient();
  const selectCandidate = useMutation({
    mutationFn: (body: { keyframeAssetId?: ID } | { videoAssetId?: ID }) => api.selectShotCandidate(shot.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  const blocking = effectiveBlocking(shot, scene);
  const angle = location ? shotAngle({ camera: shot.camera, shotSize: shot.shotSize, marks: blocking, map: location.map }) : undefined;
  const placements = location ? projectMarks(shot.camera, shot.shotSize, blocking, location.map) : [];

  function toggleCharacter(id: ID) {
    const has = shot.characterIds.includes(id);
    patch.mutate({ characterIds: has ? shot.characterIds.filter((c) => c !== id) : [...shot.characterIds, id] });
  }

  function toggleLora(loraId: ID, defaultStrength: number) {
    const existing = shot.loras ?? [];
    const has = existing.some((l) => l.loraId === loraId);
    patch.mutate({ loras: has ? existing.filter((l) => l.loraId !== loraId) : [...existing, { loraId, strength: defaultStrength }] });
  }

  function setLoraStrength(loraId: ID, strength: number) {
    patch.mutate({ loras: (shot.loras ?? []).map((l) => (l.loraId === loraId ? { ...l, strength } : l)) });
  }

  return (
    <Sheet open onClose={onClose} title={`Shot · ${scene.title || 'Scene'}`} width={480}>
      <div className="flex flex-col gap-5">
        {activeJob && (
          <div className="rounded-xl border border-[var(--color-amber-400)]/30 bg-[var(--color-amber-400)]/10 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--color-amber-300)]">
              <span>{activeJob.stage ?? activeJob.title}</span>
              <span className="chip-mono">{Math.round(activeJob.progress * 100)}%</span>
            </div>
            <Progress value={activeJob.progress} />
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Action</span>
          <textarea
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              debouncedAction(e.target.value);
            }}
            rows={3}
            className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Dialogue</span>
          <input
            value={dialogue}
            onChange={(e) => {
              setDialogue(e.target.value);
              debouncedDialogue(e.target.value);
            }}
            placeholder="(optional)"
            className="h-9 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Characters</span>
          <div className="flex flex-wrap gap-2">
            {characters.map((c, i) => {
              const active = shot.characterIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCharacter(c.id)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors',
                    active ? 'border-[var(--color-amber-400)]/40 bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]' : 'border-[var(--color-hairline)] text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
                  )}
                >
                  <span className="flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-black" style={{ background: characterColor(c, i) }}>
                    {initials(c.name)}
                  </span>
                  {c.name}
                </button>
              );
            })}
            {characters.length === 0 && <span className="text-xs text-[var(--color-ink-3)]">No characters in Cast yet.</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Shot size</span>
          <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-0.5">
            {SHOT_SIZES.map((s) => (
              <Tooltip key={s.id} label={s.label}>
                <button
                  onClick={() => patch.mutate({ shotSize: s.id as ShotSize })}
                  className={clsx(
                    'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    shot.shotSize === s.id ? 'bg-[var(--color-bg-3)] text-[var(--color-ink-0)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
                  )}
                >
                  {s.id}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Camera move</span>
            <Popover
              trigger={({ onClick, ref }) => (
                <button
                  ref={ref}
                  onClick={onClick}
                  className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)]"
                >
                  <Clapperboard className="size-3.5 text-[var(--color-ink-2)]" />
                  {CAMERA_MOVES.find((m) => m.id === shot.cameraMove)?.label ?? shot.cameraMove}
                  <ChevronDown className="size-3.5 text-[var(--color-ink-2)]" />
                </button>
              )}
            >
              <div className="grid max-h-80 w-72 grid-cols-2 gap-1 overflow-y-auto p-2">
                {CAMERA_MOVES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => patch.mutate({ cameraMove: m.id as CameraMoveId })}
                    className={clsx(
                      'flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      shot.cameraMove === m.id ? 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-300)]' : 'text-[var(--color-ink-1)] hover:bg-white/6',
                    )}
                  >
                    <span className="text-xs font-medium">{m.label}</span>
                    <span className="text-[10px] text-[var(--color-ink-3)]">{m.hint}</span>
                  </button>
                ))}
              </div>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Duration</span>
            <Segmented size="sm" options={DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))} value={String(shot.durationSec)} onChange={(v) => patch.mutate({ durationSec: Number(v) })} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Camera & blocking</span>
          {location ? (
            <>
              <MiniMap
                map={location.map}
                marks={blocking}
                characters={characters}
                camera={shot.camera}
                shotSize={shot.shotSize}
                onCameraChange={(camera) => patch.mutate({ camera })}
                className="w-full rounded-xl border border-[var(--color-hairline)]"
              />
              <Slider
                label="Camera height"
                min={0.2}
                max={8}
                step={0.1}
                value={shot.camera.heightM}
                onChange={(v) => patch.mutate({ camera: { ...shot.camera, heightM: v } })}
                formatValue={(v) => `${v.toFixed(1)}m`}
              />
              {angle && (
                <p className="chip-mono text-[11px] text-[var(--color-ink-2)]">
                  {angle.azimuth} · {angle.elevation} · {angle.distance}
                </p>
              )}
              {placements.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-ink-2)]">
                  {placements.map((p) => {
                    const c = characters.find((ch) => ch.id === p.characterId);
                    return (
                      <li key={p.characterId}>
                        {c?.name ?? p.characterId}: {p.visible ? `${p.screenX}, ${p.depth}, facing ${p.facing}` : 'out of frame'}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline)] text-xs text-[var(--color-ink-2)]">
              Assign a location to this scene to place the camera.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-hairline)]">
          <button onClick={() => setShowAuto((v) => !v)} className="flex items-center justify-between px-3 py-2.5 text-left text-xs font-medium text-[var(--color-ink-1)]">
            <span className="flex items-center gap-1.5">
              <Wand2 className="size-3.5" /> Auto prompts
            </span>
            {showAuto ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {showAuto && (
            <div className="flex flex-col gap-3 px-3 pb-3">
              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--color-ink-3)]">Keyframe prompt</span>
                  {shot.keyframePrompt !== undefined && (
                    <button
                      className="flex items-center gap-1 text-[11px] text-[var(--color-amber-300)] hover:underline"
                      onClick={() => {
                        // The API's Partial<Shot> types omit `null`, but the server treats a null field as
                        // "clear this override and fall back to the auto-generated prompt" — cast pragmatically.
                        patch.mutate({ keyframePrompt: null as unknown as string | undefined });
                        setKeyframePrompt(preview?.keyframePrompt ?? '');
                      }}
                    >
                      <RotateCcw className="size-2.5" /> Reset to auto
                    </button>
                  )}
                </div>
                <textarea
                  value={keyframePrompt}
                  onChange={(e) => {
                    setKeyframePrompt(e.target.value);
                    debouncedKeyframePrompt(e.target.value);
                  }}
                  rows={3}
                  className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-2 text-xs text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
                />
              </label>
              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--color-ink-3)]">Motion prompt</span>
                  {shot.motionPrompt !== undefined && (
                    <button
                      className="flex items-center gap-1 text-[11px] text-[var(--color-amber-300)] hover:underline"
                      onClick={() => {
                        patch.mutate({ motionPrompt: null as unknown as string | undefined });
                        setMotionPrompt(preview?.motionPrompt ?? '');
                      }}
                    >
                      <RotateCcw className="size-2.5" /> Reset to auto
                    </button>
                  )}
                </div>
                <textarea
                  value={motionPrompt}
                  onChange={(e) => {
                    setMotionPrompt(e.target.value);
                    debouncedMotionPrompt(e.target.value);
                  }}
                  rows={2}
                  className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-2 text-xs text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Keyframe mode</span>
            <Segmented
              size="sm"
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'compose', label: 'Compose' },
                { value: 'generate', label: 'Generate' },
              ]}
              value={shot.keyframeMode}
              onChange={(v) => patch.mutate({ keyframeMode: v as Shot['keyframeMode'] })}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Seed</span>
            <input
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value);
                debouncedSeed(e.target.value);
              }}
              placeholder="random"
              className="chip-mono h-9 w-28 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 text-xs text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">LoRA overrides</span>
          <Popover
            trigger={({ onClick, ref }) => (
              <button ref={ref} onClick={onClick} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-1)]">
                {(shot.loras ?? []).length > 0 ? `${shot.loras!.length} active` : 'None'}
                <ChevronDown className="size-3.5 text-[var(--color-ink-2)]" />
              </button>
            )}
          >
            <div className="max-h-72 w-64 overflow-y-auto p-2">
              {(loras ?? []).map((l) => {
                const ref = shot.loras?.find((r) => r.loraId === l.id);
                return (
                  <div key={l.id} className="flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-white/6">
                    <button onClick={() => toggleLora(l.id, l.defaultStrength)} className="flex items-center justify-between text-left text-xs text-[var(--color-ink-1)]">
                      <span>{l.name}</span>
                      {ref && <Check className="size-3.5 text-[var(--color-amber-400)]" />}
                    </button>
                    {ref && (
                      <Slider min={0} max={2} step={0.05} value={ref.strength} onChange={(v) => setLoraStrength(l.id, v)} formatValue={(v) => v.toFixed(2)} />
                    )}
                  </div>
                );
              })}
              {(loras ?? []).length === 0 && <p className="p-2 text-xs text-[var(--color-ink-3)]">No LoRAs installed.</p>}
            </div>
          </Popover>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" loading={keyframeJob.isPending} onClick={() => keyframeJob.mutate()}>
            Generate keyframe
          </Button>
          {!isOff('wan_i2v') && (
            <Button variant="secondary" size="lg" className="flex-1" loading={videoJob.isPending} disabled={!shot.keyframeAssetId} onClick={() => videoJob.mutate()}>
              Animate
            </Button>
          )}
        </div>

        {shot.keyframeCandidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Keyframe candidates</span>
            <CandidateStrip ids={shot.keyframeCandidates} activeId={shot.keyframeAssetId} kind="image" onSelect={(id) => selectCandidate.mutate({ keyframeAssetId: id })} />
          </div>
        )}
        {shot.videoCandidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Video candidates</span>
            <CandidateStrip ids={shot.videoCandidates} activeId={shot.videoAssetId} kind="video" onSelect={(id) => selectCandidate.mutate({ videoAssetId: id })} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

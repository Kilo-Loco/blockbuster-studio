import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Plus, Upload, ImagePlus, Sparkles, Trash2, User, Package, X, Wand2 } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { Button, IconButton, Dialog, Popover, Menu, Chip, Skeleton, Progress, Segmented } from '../components/ui';
import { CHARACTER_COLORS } from '@shared/presets';
import type { Character, ID, Asset } from '@shared/types';
import { VoiceSection } from '../components/cast/VoiceSection';
import { useTrackedJobs } from '../hooks/useTrackedJobs';
import { useImageUploads } from '../hooks/useImageUploads';
import { ImageDropZone } from '../components/ImageDropZone';
import { BaseModelNote } from '../components/lora/BaseModelNote';
import { AssetLightbox } from '../components/AssetLightbox';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

function nextColor(characters: Character[]): string {
  const used = new Set(characters.map((c) => c.color));
  return CHARACTER_COLORS.find((c) => !used.has(c)) ?? CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length]!;
}

function useAsset(id: ID | undefined) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => api.asset(id!),
    enabled: !!id,
  });
}

function Avatar({ character, size = 'card' }: { character: Character; size?: 'card' | 'sm' }) {
  const primaryId = character.referenceAssetIds[0];
  const { data: asset } = useAsset(primaryId);
  const dim = size === 'card' ? 'aspect-square' : 'size-10 shrink-0';
  if (primaryId && asset) {
    return (
      <div className={`${dim} overflow-hidden rounded-xl bg-[var(--color-bg-2)]`}>
        <img src={mediaUrl(asset.thumb ?? asset.file)} alt={character.name} className="size-full object-cover" />
      </div>
    );
  }
  if (primaryId) {
    return <Skeleton className={dim} />;
  }
  return (
    <div
      className={`flex ${dim} items-center justify-center rounded-xl font-serif text-2xl text-black/80`}
      style={{ background: `linear-gradient(155deg, ${character.color}, color-mix(in srgb, ${character.color} 60%, black))` }}
    >
      {initials(character.name)}
    </div>
  );
}

export default function Cast() {
  const qc = useQueryClient();
  const { data: characters, isLoading } = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const [editingId, setEditingId] = useState<ID | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      api.createCharacter({
        name: 'New Character',
        description: '',
        color: nextColor(characters ?? []),
        referenceAssetIds: [],
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      setEditingId(c.id);
    },
    onError: () => toast({ title: 'Failed to create character', variant: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: ID) => api.deleteCharacter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      toast({ title: 'Character deleted' });
    },
    onError: () => toast({ title: 'Failed to delete character', variant: 'error' }),
  });

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">Cast &amp; props</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">People and props, their reference sheets, voices, LoRAs, and trigger words.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} loading={createMut.isPending} onClick={() => createMut.mutate()}>
            New character or prop
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full" />
            ))}
          </div>
        )}

        {!isLoading && (characters?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-hairline)] py-24 text-center">
            <Users2 />
            <h2 className="mt-4 font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">No characters yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-2)]">
              Add your first character to give them a look, a reference sheet, and a trained LoRA for consistent shots.
            </p>
            <Button variant="primary" className="mt-4" icon={<Plus className="size-4" />} loading={createMut.isPending} onClick={() => createMut.mutate()}>
              New character or prop
            </Button>
          </div>
        )}

        {!isLoading && (characters?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {characters!.map((c) => (
              <div
                key={c.id}
                className="group cursor-pointer rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-2.5 transition-colors hover:border-[var(--color-hairline-strong)]"
                onClick={() => setEditingId(c.id)}
              >
                <Avatar character={c} />
                <div className="mt-2.5 flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-[var(--color-ink-0)]">{c.name}</span>
                      {(c.kind ?? 'person') === 'prop' && (
                        <span className="shrink-0 rounded-full bg-[var(--color-bg-3)] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[var(--color-ink-3)]">Prop</span>
                      )}
                    </div>
                    {c.triggerWord && <div className="chip-mono truncate text-[11px] text-[var(--color-ink-3)]">{c.triggerWord}</div>}
                    {c.voice && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-ink-3)]" title={c.voice.description ?? 'Voice from a clip'}>
                        <AudioLines className="size-3" /> Voice
                      </div>
                    )}
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu
                      items={[
                        {
                          label: 'Delete',
                          icon: <Trash2 className="size-3.5" />,
                          danger: true,
                          onClick: () => {
                            if (confirm(`Delete "${c.name}"? This cannot be undone.`)) deleteMut.mutate(c.id);
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingId && <CharacterEditor id={editingId} onClose={() => setEditingId(null)} />}
    </div>
  );
}

function Users2() {
  return (
    <div className="flex size-16 items-center justify-center rounded-full bg-[var(--color-bg-2)] text-[var(--color-ink-2)]">
      <Sparkles className="size-7" />
    </div>
  );
}

// ───────────────────────────── Editor ─────────────────────────────

function CharacterEditor({ id, onClose }: { id: ID; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: character } = useQuery({ queryKey: ['character', id], queryFn: () => api.character(id) });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [trainOpen, setTrainOpen] = useState(false);
  const [turnaroundJobId, setTurnaroundJobId] = useState<ID | null>(null);
  const [faceJobId, setFaceJobId] = useState<ID | null>(null);
  const [viewing, setViewing] = useState<{ ids: ID[]; index: number; refs: boolean } | null>(null);
  const jobs = useJobsStore((s) => s.jobs);
  const refsJobs = useTrackedJobs({
    onDone: (job) => {
      toast({ title: 'Reference images ready', description: `${job.outputAssetIds.length} new images added` });
      qc.invalidateQueries({ queryKey: ['character', id] });
    },
    onError: (job) => toast({ title: 'Reference generation failed', description: job.error, variant: 'error' }),
  });
  const refsJob = refsJobs.active.find((j) => j.status === 'running') ?? refsJobs.active[0];
  const turnaroundJob = turnaroundJobId ? jobs[turnaroundJobId] : undefined;
  const faceJob = faceJobId ? jobs[faceJobId] : undefined;

  useEffect(() => {
    if (character) {
      setName(character.name);
      setDescription(character.description);
      setTriggerWord(character.triggerWord ?? '');
    }
  }, [character?.id]);

  useEffect(() => {
    if (turnaroundJob?.status === 'done') {
      toast({ title: 'Turnaround ready', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['character', id] });
      setTurnaroundJobId(null);
    } else if (turnaroundJob?.status === 'error') {
      toast({ title: 'Turnaround generation failed', description: turnaroundJob.error, variant: 'error' });
      setTurnaroundJobId(null);
    }
  }, [turnaroundJob?.status]);

  useEffect(() => {
    if (faceJob?.status === 'done') {
      toast({ title: 'Face close-up ready', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['character', id] });
      setFaceJobId(null);
    } else if (faceJob?.status === 'error') {
      toast({ title: 'Face close-up generation failed', description: faceJob.error, variant: 'error' });
      setFaceJobId(null);
    }
  }, [faceJob?.status]);

  const updateMut = useMutation({
    mutationFn: (body: Partial<Character>) => api.updateCharacter(id, body),
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: () => toast({ title: 'Failed to save changes', variant: 'error' }),
  });

  const refsMut = useMutation({
    mutationFn: () => api.characterReferences(id, { count: 4 }),
    onSuccess: (job) => {
      refsJobs.track(job);
      toast({ title: job.status === 'queued' ? 'Reference images queued' : 'Generating reference images…' });
    },
    onError: () => toast({ title: 'Failed to start generation', variant: 'error' }),
  });

  const uploads = useImageUploads();
  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const assets = await uploads.upload(files);
      if (assets.length === 0) return null;
      // One update for the whole batch, from the latest copy, so nothing added meanwhile is lost.
      const current = qc.getQueryData<Character>(['character', id])?.referenceAssetIds ?? character?.referenceAssetIds ?? [];
      return api.updateCharacter(id, { referenceAssetIds: [...current, ...assets.map((a) => a.id)] });
    },
    onSuccess: (c) => {
      if (!c) return;
      qc.setQueryData(['character', id], c);
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: () => toast({ title: 'Upload failed', variant: 'error' }),
  });

  const removeRefMut = useMutation({
    mutationFn: (assetId: ID) =>
      api.updateCharacter(id, { referenceAssetIds: (character?.referenceAssetIds ?? []).filter((a) => a !== assetId) }),
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
    },
  });

  const addFromGalleryMut = useMutation({
    mutationFn: (assetId: ID) =>
      api.updateCharacter(id, { referenceAssetIds: [...(character?.referenceAssetIds ?? []), assetId] }),
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
    },
  });

  const turnaroundMut = useMutation({
    mutationFn: () => api.characterTurnaround(id),
    onSuccess: (job) => {
      setTurnaroundJobId(job.id);
      useJobsStore.getState().upsert(job);
      toast({ title: 'Generating turnaround…' });
    },
    onError: () => toast({ title: 'Failed to start generation', variant: 'error' }),
  });

  const faceMut = useMutation({
    mutationFn: () => api.characterFace(id),
    onSuccess: (job) => {
      setFaceJobId(job.id);
      useJobsStore.getState().upsert(job);
      toast({ title: 'Generating face close-up…' });
    },
    onError: (err) => toast({ title: 'Failed to start generation', description: (err as Error).message, variant: 'error' }),
  });

  const setSheetAssetMut = useMutation({
    mutationFn: (body: { face?: ID; turnaround?: ID }) => api.updateCharacter(id, { sheetAssets: { ...character?.sheetAssets, ...body } }),
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
    },
    onError: () => toast({ title: 'Failed to save', variant: 'error' }),
  });

  // A sheet made elsewhere: upload it straight into the turnaround or face slot.
  const sheetFileRef = useRef<HTMLInputElement>(null);
  const [sheetUploadSlot, setSheetUploadSlot] = useState<'turnaround' | 'face'>('turnaround');
  const uploadSheetMut = useMutation({
    mutationFn: async ({ file, slot }: { file: File; slot: 'turnaround' | 'face' }) => {
      const asset = await api.upload(file);
      return api.updateCharacter(id, { sheetAssets: { ...character?.sheetAssets, [slot]: asset.id } });
    },
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: () => toast({ title: 'Upload failed', variant: 'error' }),
  });
  const pickSheetFile = (slot: 'turnaround' | 'face') => {
    setSheetUploadSlot(slot);
    sheetFileRef.current?.click();
  };

  const attachLoraMut = useMutation({
    mutationFn: (loraId: ID | undefined) => api.updateCharacter(id, { loraId }),
    onSuccess: (c) => {
      qc.setQueryData(['character', id], c);
    },
  });

  const fileRef = useRef<HTMLInputElement>(null);

  if (!character) {
    return (
      <Dialog open onClose={onClose} title="Loading…" size="lg">
        <Skeleton className="h-48 w-full" />
      </Dialog>
    );
  }

  const saveName = () => {
    if (name.trim() && name !== character.name) updateMut.mutate({ name: name.trim() });
  };
  const saveDescription = () => {
    if (description !== character.description) updateMut.mutate({ description });
  };
  const saveTrigger = () => {
    if (triggerWord !== (character.triggerWord ?? '')) updateMut.mutate({ triggerWord: triggerWord || undefined });
  };

  return (
    <Dialog open onClose={onClose} title="Edit character" size="lg">
      <div className="space-y-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--color-ink-2)]">Kind</label>
          <Segmented
            options={[
              { value: 'person', label: 'Person', icon: <User className="size-3.5" /> },
              { value: 'prop', label: 'Prop', icon: <Package className="size-3.5" /> },
            ]}
            value={character.kind ?? 'person'}
            onChange={(v) => updateMut.mutate({ kind: v })}
            size="sm"
          />
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">Props skip the voice and face close-up, and get product-style turnaround panels on a scene's reference sheet.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={3}
            placeholder="A woman in her 30s with short silver hair, black trench coat…"
            className="w-full resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>

        <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50 p-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">Sheets</label>
          </div>
          <p className="mb-2.5 text-xs text-[var(--color-ink-3)]">
            Plain-grey, sheet-ready images used to build a scene's reference sheet — a turnaround for every character, and a face close-up for people.
          </p>
          <input
            ref={sheetFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadSheetMut.mutate({ file: f, slot: sheetUploadSlot });
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-3">
            <div>
              <div className="mb-1 text-[11px] text-[var(--color-ink-3)]">Turnaround</div>
              {character.sheetAssets?.turnaround && <SheetThumb assetId={character.sheetAssets.turnaround} onOpen={() => setViewing({ ids: [character.sheetAssets!.turnaround!], index: 0, refs: false })} />}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={turnaroundMut.isPending || (!!turnaroundJob && turnaroundJob.status !== 'done' && turnaroundJob.status !== 'error')} onClick={() => turnaroundMut.mutate()}>
                  {character.sheetAssets?.turnaround ? 'Regenerate' : 'Generate turnaround'}
                </Button>
                <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} loading={uploadSheetMut.isPending && sheetUploadSlot === 'turnaround'} onClick={() => pickSheetFile('turnaround')}>
                  Upload
                </Button>
              </div>
            </div>
            {(character.kind ?? 'person') === 'person' && (
              <div>
                <div className="mb-1 text-[11px] text-[var(--color-ink-3)]">Face close-up</div>
                {character.sheetAssets?.face && <SheetThumb assetId={character.sheetAssets.face} onOpen={() => setViewing({ ids: [character.sheetAssets!.face!], index: 0, refs: false })} />}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={faceMut.isPending || (!!faceJob && faceJob.status !== 'done' && faceJob.status !== 'error')} onClick={() => faceMut.mutate()}>
                    {character.sheetAssets?.face ? 'Regenerate' : 'Generate face close-up'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} loading={uploadSheetMut.isPending && sheetUploadSlot === 'face'} onClick={() => pickSheetFile('face')}>
                    Upload
                  </Button>
                </div>
              </div>
            )}
          </div>
          {turnaroundJob && turnaroundJob.status !== 'done' && turnaroundJob.status !== 'error' && (
            <div className="mt-2">
              <Progress value={turnaroundJob.progress} />
            </div>
          )}
          {faceJob && faceJob.status !== 'done' && faceJob.status !== 'error' && (
            <div className="mt-2">
              <Progress value={faceJob.progress} />
            </div>
          )}
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            Uploading your own? A plain grey background works best, and a turnaround shows four views side by side. You can also hover a
            reference image below and pick "Use as turnaround" / "Use as face".
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--color-ink-2)]">Color</label>
          <div className="flex flex-wrap gap-2">
            {CHARACTER_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => updateMut.mutate({ color })}
                className="size-7 rounded-full transition-transform hover:scale-110"
                style={{
                  background: color,
                  outline: character.color === color ? '2px solid var(--color-ink-0)' : 'none',
                  outlineOffset: 2,
                }}
                aria-label={color}
              />
            ))}
          </div>
        </div>

        <ImageDropZone onFiles={(files) => uploadMut.mutate(files)}>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">Reference images</label>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) uploadMut.mutate(files);
                  e.target.value = '';
                }}
              />
              <IconButton
                icon={<Upload className="size-4" />}
                label="Upload references"
                size="sm"
                disabled={uploadMut.isPending}
                onClick={() => fileRef.current?.click()}
              />
              <GalleryPicker onPick={(assetId) => addFromGalleryMut.mutate(assetId)} />
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={refsMut.isPending} onClick={() => refsMut.mutate()}>
                Generate reference images
              </Button>
            </div>
          </div>
          {uploads.progress && (
            <div className="mb-2">
              <Progress value={uploads.progress.done / uploads.progress.total} />
              <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">
                Uploading {uploads.progress.done} / {uploads.progress.total}…
              </div>
            </div>
          )}
          {refsJob && (
            <div className="mb-2">
              <Progress value={refsJob.progress} />
              <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">
                {refsJob.status === 'queued' ? 'Queued' : (refsJob.stage ?? 'Generating…')}
                {refsJobs.active.length > 1 && ` · ${refsJobs.active.length - 1} more queued`}
              </div>
            </div>
          )}
          {character.referenceAssetIds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-hairline)] px-3 py-6 text-center text-xs text-[var(--color-ink-3)]">
              No references yet. Drop images here, upload, pick from the gallery, or generate them.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {character.referenceAssetIds.map((assetId, i) => (
                <RefThumb
                  key={assetId}
                  assetId={assetId}
                  primary={i === 0}
                  onOpen={() => setViewing({ ids: character.referenceAssetIds, index: i, refs: true })}
                  onRemove={() => removeRefMut.mutate(assetId)}
                  isFace={character.sheetAssets?.face === assetId}
                  isTurnaround={character.sheetAssets?.turnaround === assetId}
                  showFacePick={(character.kind ?? 'person') === 'person'}
                  onUseAsFace={() => setSheetAssetMut.mutate({ face: assetId })}
                  onUseAsTurnaround={() => setSheetAssetMut.mutate({ turnaround: assetId })}
                />
              ))}
            </div>
          )}
        </ImageDropZone>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Trigger word</label>
          <input
            value={triggerWord}
            onChange={(e) => setTriggerWord(e.target.value)}
            onBlur={saveTrigger}
            placeholder="ohwx_mara"
            className="chip-mono w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>

        {(character.kind ?? 'person') === 'person' && <VoiceSection key={character.voice?.updatedAt ?? 'none'} character={character} />}

        <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">LoRA</label>
            {character.loraId && (
              <button className="text-xs text-[var(--color-danger)] hover:underline" onClick={() => attachLoraMut.mutate(undefined)}>
                Detach
              </button>
            )}
          </div>
          {character.loraId ? (
            <Chip mono>lora:{character.loraId}</Chip>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <LoraAttachPicker onPick={(loraId) => attachLoraMut.mutate(loraId)} />
              <span className="text-xs text-[var(--color-ink-3)]">or</span>
              <Button size="sm" icon={<Sparkles className="size-3.5" />} disabled={character.referenceAssetIds.length === 0} onClick={() => setTrainOpen(true)}>
                Train LoRA from references
              </Button>
            </div>
          )}
        </div>
      </div>

      {trainOpen && <TrainLoraDialog character={character} onClose={() => setTrainOpen(false)} />}
      {viewing && (
        <AssetLightbox
          assetIds={viewing.refs ? character.referenceAssetIds : viewing.ids}
          index={viewing.index}
          onIndexChange={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
          onRemove={viewing.refs ? (assetId) => removeRefMut.mutate(assetId) : undefined}
          removeLabel="Remove reference"
        />
      )}
    </Dialog>
  );
}

function RefThumb({
  assetId,
  primary,
  onOpen,
  onRemove,
  isFace,
  isTurnaround,
  showFacePick,
  onUseAsFace,
  onUseAsTurnaround,
}: {
  assetId: ID;
  primary: boolean;
  onOpen: () => void;
  onRemove: () => void;
  isFace?: boolean;
  isTurnaround?: boolean;
  showFacePick?: boolean;
  onUseAsFace?: () => void;
  onUseAsTurnaround?: () => void;
}) {
  const { data: asset } = useAsset(assetId);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--color-bg-2)]">
      {asset ? (
        <button onClick={onOpen} className="size-full" aria-label="Open reference image">
          <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" />
        </button>
      ) : (
        <Skeleton className="size-full" />
      )}
      {primary && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">Primary</span>}
      {(isFace || isTurnaround) && (
        <span className="absolute bottom-1 left-1 rounded bg-[var(--color-amber-400)]/90 px-1.5 py-0.5 text-[9px] font-medium text-black">
          {isFace ? 'Face' : 'Turnaround'}
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove reference"
      >
        <X className="size-3" />
      </button>
      {(onUseAsFace || onUseAsTurnaround) && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/70 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onUseAsTurnaround && !isTurnaround && (
            <button onClick={onUseAsTurnaround} className="rounded bg-white/10 px-1 py-0.5 text-[9px] text-white hover:bg-white/20">
              Use as turnaround
            </button>
          )}
          {showFacePick && onUseAsFace && !isFace && (
            <button onClick={onUseAsFace} className="rounded bg-white/10 px-1 py-0.5 text-[9px] text-white hover:bg-white/20">
              Use as face
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SheetThumb({ assetId, onOpen }: { assetId: ID; onOpen: () => void }) {
  const { data: asset } = useAsset(assetId);
  return (
    <button
      onClick={onOpen}
      aria-label="Open full size"
      className="block size-16 overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] transition-colors hover:border-[var(--color-amber-400)]/50"
    >
      {asset ? <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" /> : <Skeleton className="size-full" />}
    </button>
  );
}

function GalleryPicker({ onPick }: { onPick: (assetId: ID) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['assets', 'image'], queryFn: () => api.assets({ kind: 'image' }), enabled: open });
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={({ onClick, ref }) => <IconButton ref={ref} icon={<ImagePlus className="size-4" />} label="Pick from gallery" size="sm" onClick={onClick} />}
    >
      <div className="max-h-72 w-64 overflow-y-auto p-2">
        {!data && <div className="p-3 text-xs text-[var(--color-ink-3)]">Loading…</div>}
        {data && data.items.length === 0 && <div className="p-3 text-xs text-[var(--color-ink-3)]">No images yet.</div>}
        <div className="grid grid-cols-3 gap-1.5">
          {data?.items.map((a: Asset) => (
            <button
              key={a.id}
              className="aspect-square overflow-hidden rounded-md border border-transparent hover:border-[var(--color-amber-400)]/50"
              onClick={() => {
                onPick(a.id);
                setOpen(false);
              }}
            >
              <img src={mediaUrl(a.thumb ?? a.file)} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

function LoraAttachPicker({ onPick }: { onPick: (loraId: ID) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['loras', 'zimage'], queryFn: () => api.loras('zimage'), enabled: open });
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={({ onClick, ref }) => (
        <button ref={ref} onClick={onClick} className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-1.5 text-xs text-[var(--color-ink-1)] hover:bg-[var(--color-bg-3)]">
          Attach existing LoRA
        </button>
      )}
    >
      <div className="max-h-64 w-64 overflow-y-auto p-1.5">
        {!data && <div className="p-3 text-xs text-[var(--color-ink-3)]">Loading…</div>}
        {data && data.length === 0 && <div className="p-3 text-xs text-[var(--color-ink-3)]">No Z-Image LoRAs yet.</div>}
        {data?.map((l) => (
          <button
            key={l.id}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:bg-white/6 hover:text-[var(--color-ink-0)]"
            onClick={() => {
              onPick(l.id);
              setOpen(false);
            }}
          >
            <span className="truncate">{l.name}</span>
            {l.triggerWord && <span className="chip-mono ml-2 shrink-0 text-[var(--color-ink-3)]">{l.triggerWord}</span>}
          </button>
        ))}
      </div>
    </Popover>
  );
}

function TrainLoraDialog({ character, onClose }: { character: Character; onClose: () => void }) {
  const qc = useQueryClient();
  const [triggerWord, setTriggerWord] = useState(character.triggerWord || `ohwx_${character.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
  const [steps, setSteps] = useState(1500);
  const [rank, setRank] = useState(16);

  const trainMut = useMutation({
    mutationFn: () =>
      api.trainLora({
        name: character.name,
        kind: 'character',
        triggerWord,
        description: character.description,
        assetIds: character.referenceAssetIds,
        steps,
        rank,
        characterId: character.id,
      }),
    onSuccess: () => {
      toast({ title: 'Training started', description: 'Track progress in the LoRAs page and queue drawer.' });
      qc.invalidateQueries({ queryKey: ['loras'] });
      onClose();
    },
    onError: () => toast({ title: 'Failed to start training', variant: 'error' }),
  });

  return (
    <Dialog open onClose={onClose} title="Train LoRA from references" size="sm">
      <div className="space-y-4">
        <BaseModelNote />
        <p className="text-xs text-[var(--color-ink-2)]">
          Trains a character LoRA from the {character.referenceAssetIds.length} reference image{character.referenceAssetIds.length === 1 ? '' : 's'} on file.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Trigger word</label>
          <input
            value={triggerWord}
            onChange={(e) => setTriggerWord(e.target.value)}
            className="chip-mono w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Steps</label>
            <input
              type="number"
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Rank</label>
            <input
              type="number"
              value={rank}
              onChange={(e) => setRank(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </div>
        </div>
        <p className="chip-mono text-[var(--color-ink-3)]">≈30–60 min on RTX 4090</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={trainMut.isPending} disabled={!triggerWord.trim()} onClick={() => trainMut.mutate()}>
            Start training
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

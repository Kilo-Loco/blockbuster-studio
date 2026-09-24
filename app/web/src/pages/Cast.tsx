import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, ImagePlus, Sparkles, Trash2, X, Wand2 } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { Button, IconButton, Dialog, Popover, Menu, Chip, Skeleton, Progress } from '../components/ui';
import { CHARACTER_COLORS } from '@shared/presets';
import type { Character, ID, Asset } from '@shared/types';

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
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">Cast</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Characters and their reference sheets, LoRAs, and trigger words.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} loading={createMut.isPending} onClick={() => createMut.mutate()}>
            New character
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
            <h2 className="mt-4 font-serif text-lg text-[var(--color-ink-0)]">No characters yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-2)]">
              Add your first character to give them a look, a reference sheet, and a trained LoRA for consistent shots.
            </p>
            <Button variant="primary" className="mt-4" icon={<Plus className="size-4" />} loading={createMut.isPending} onClick={() => createMut.mutate()}>
              New character
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
                    <div className="truncate text-sm font-medium text-[var(--color-ink-0)]">{c.name}</div>
                    {c.triggerWord && <div className="chip-mono truncate text-[11px] text-[var(--color-ink-3)]">{c.triggerWord}</div>}
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
  const [refsJobId, setRefsJobId] = useState<ID | null>(null);
  const jobs = useJobsStore((s) => s.jobs);
  const refsJob = refsJobId ? jobs[refsJobId] : undefined;

  useEffect(() => {
    if (character) {
      setName(character.name);
      setDescription(character.description);
      setTriggerWord(character.triggerWord ?? '');
    }
  }, [character?.id]);

  useEffect(() => {
    if (refsJob?.status === 'done') {
      toast({ title: 'Reference sheet ready', description: `${refsJob.outputAssetIds.length} new images added` });
      qc.invalidateQueries({ queryKey: ['character', id] });
      setRefsJobId(null);
    } else if (refsJob?.status === 'error') {
      toast({ title: 'Reference generation failed', description: refsJob.error, variant: 'error' });
      setRefsJobId(null);
    }
  }, [refsJob?.status]);

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
      setRefsJobId(job.id);
      useJobsStore.getState().upsert(job);
      toast({ title: 'Generating reference sheet…' });
    },
    onError: () => toast({ title: 'Failed to start generation', variant: 'error' }),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.upload(file);
      return api.updateCharacter(id, { referenceAssetIds: [...(character?.referenceAssetIds ?? []), asset.id] });
    },
    onSuccess: (c) => {
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

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">Reference images</label>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadMut.mutate(f);
                  e.target.value = '';
                }}
              />
              <IconButton icon={<Upload className="size-4" />} label="Upload reference" size="sm" onClick={() => fileRef.current?.click()} />
              <GalleryPicker onPick={(assetId) => addFromGalleryMut.mutate(assetId)} />
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={refsMut.isPending || (!!refsJob && refsJob.status !== 'done' && refsJob.status !== 'error')} onClick={() => refsMut.mutate()}>
                Generate reference sheet
              </Button>
            </div>
          </div>
          {refsJob && refsJob.status !== 'done' && refsJob.status !== 'error' && (
            <div className="mb-2">
              <Progress value={refsJob.progress} />
              <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">{refsJob.stage ?? 'Generating…'}</div>
            </div>
          )}
          {character.referenceAssetIds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-hairline)] px-3 py-6 text-center text-xs text-[var(--color-ink-3)]">
              No references yet — upload one, pick from the gallery, or generate a sheet.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {character.referenceAssetIds.map((assetId, i) => (
                <RefThumb key={assetId} assetId={assetId} primary={i === 0} onRemove={() => removeRefMut.mutate(assetId)} />
              ))}
            </div>
          )}
        </div>

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
    </Dialog>
  );
}

function RefThumb({ assetId, primary, onRemove }: { assetId: ID; primary: boolean; onRemove: () => void }) {
  const { data: asset } = useAsset(assetId);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--color-bg-2)]">
      {asset ? (
        <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" />
      ) : (
        <Skeleton className="size-full" />
      )}
      {primary && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">Primary</span>}
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove reference"
      >
        <X className="size-3" />
      </button>
    </div>
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

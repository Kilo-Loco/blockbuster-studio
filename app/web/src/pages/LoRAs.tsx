import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { useImageUploads } from '../hooks/useImageUploads';
import { ImageDropZone } from '../components/ImageDropZone';
import { BaseModelNote } from '../components/lora/BaseModelNote';
import { Button, Chip, Dialog, Menu, Progress, Skeleton, Slider } from '../components/ui';
import type { Asset, ID, Lora, LoraFamily, LoraKind } from '@shared/types';

const FAMILIES: { id: LoraFamily; label: string }[] = [
  { id: 'zimage', label: 'Image · Z-Image' },
  { id: 'wan22', label: 'Video · Wan 2.2' },
  { id: 'qwen_edit', label: 'Edit · Qwen' },
  { id: 'minimax_h3', label: 'Video · MiniMax H3' },
  { id: 'ltx2', label: 'Video · LTX-2.5' },
];

const KINDS: LoraKind[] = ['character', 'location', 'style', 'motion', 'other'];

export default function LoRAs() {
  const qc = useQueryClient();
  const { data: loras, isLoading } = useQuery({ queryKey: ['loras'], queryFn: () => api.loras() });
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [trainOpen, setTrainOpen] = useState(false);

  const byFamily = useMemo(() => {
    const map: Record<LoraFamily, Lora[]> = { zimage: [], wan22: [], qwen_edit: [], minimax_h3: [], ltx2: [] };
    for (const l of loras ?? []) map[l.family]?.push(l);
    return map;
  }, [loras]);

  const deleteMut = useMutation({
    mutationFn: (id: ID) => api.deleteLora(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loras'] });
      toast({ title: 'LoRA deleted' });
    },
    onError: () => toast({ title: 'Failed to delete LoRA', variant: 'error' }),
  });

  const empty = !isLoading && (loras?.length ?? 0) === 0;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">LoRAs</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Import, upload, or train LoRAs for characters, locations, and styles.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => setUploadOpen(true)}>
              Upload
            </Button>
            <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => setTrainOpen(true)}>
              Train
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {empty && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-hairline)] py-24 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-[var(--color-bg-2)] text-[var(--color-ink-2)]">
              <Sparkles className="size-7" />
            </div>
            <h2 className="mt-4 font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">No LoRAs yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-2)]">
              Import from Civitai/Hugging Face, upload a .safetensors file, or train one from reference images.
            </p>
            <div className="mt-4 flex gap-2">
              <Button icon={<Download className="size-4" />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
              <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setTrainOpen(true)}>
                Train
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !empty && (
          <div className="space-y-8">
            {FAMILIES.map((f) => (
              <div key={f.id}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">{f.label}</h2>
                  <Chip>{byFamily[f.id].length}</Chip>
                </div>
                {byFamily[f.id].length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--color-hairline)] px-4 py-6 text-center text-xs text-[var(--color-ink-3)]">
                    No {f.label.toLowerCase()} LoRAs yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {byFamily[f.id].map((lora) => (
                      <LoraRow key={lora.id} lora={lora} onDelete={() => deleteMut.mutate(lora.id)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
      {trainOpen && <TrainDialog onClose={() => setTrainOpen(false)} />}
    </div>
  );
}

function LoraRow({ lora, onDelete }: { lora: Lora; onDelete: () => void }) {
  const qc = useQueryClient();
  const jobs = useJobsStore((s) => s.jobs);
  const liveJob = useMemo(
    () => Object.values(jobs).find((j) => (j.type === 'lora_train' || j.type === 'lora_download') && j.outputAssetIds && (j.params as { loraId?: string })?.loraId === lora.id),
    [jobs, lora.id],
  );

  const strengthMut = useMutation({
    mutationFn: (defaultStrength: number) => api.updateLora(lora.id, { defaultStrength }),
    onSuccess: (l) => qc.setQueryData(['loras'], (old: Lora[] | undefined) => old?.map((x) => (x.id === l.id ? l : x))),
  });

  const copyTrigger = () => {
    if (!lora.triggerWord) return;
    navigator.clipboard.writeText(lora.triggerWord).then(() => toast({ title: 'Copied', description: lora.triggerWord }));
  };

  const pct = liveJob ? liveJob.progress : lora.status === 'downloading' || lora.status === 'training' ? 0 : undefined;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-4 py-3">
      <div className="min-w-[160px] flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--color-ink-0)]">{lora.name}</span>
          <StatusBadge status={lora.status} />
        </div>
        {lora.triggerWord && (
          <button onClick={copyTrigger} className="chip-mono mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-3)] hover:text-[var(--color-ink-1)]">
            <Copy className="size-3" />
            {lora.triggerWord}
          </button>
        )}
        {pct !== undefined && (
          <div className="mt-1.5 max-w-xs">
            <Progress value={pct} />
            <span className="text-[10px] text-[var(--color-ink-3)]">{lora.status} {Math.round(pct * 100)}%</span>
          </div>
        )}
        {lora.error && <div className="mt-1 text-[11px] text-[var(--color-danger)]">{lora.error}</div>}
      </div>

      <div className="w-40">
        <Slider
          label="Strength"
          value={lora.defaultStrength}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => strengthMut.mutate(v)}
        />
      </div>

      <Chip mono>{lora.kind}</Chip>

      <Menu
        items={[
          {
            label: 'Delete',
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onClick: () => {
              if (confirm(`Delete "${lora.name}"? This cannot be undone.`)) onDelete();
            },
          },
        ]}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: Lora['status'] }) {
  const styles: Record<Lora['status'], string> = {
    ready: 'text-[var(--color-success)] bg-[var(--color-success)]/10',
    downloading: 'text-[var(--color-amber-400)] bg-[var(--color-amber-400)]/10',
    training: 'text-[var(--color-amber-400)] bg-[var(--color-amber-400)]/10',
    error: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10',
  };
  return <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium', styles[status])}>{status}</span>;
}

// ───────────────────────────── Import ─────────────────────────────

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [family, setFamily] = useState<LoraFamily | ''>('');
  const [kind, setKind] = useState<LoraKind | ''>('');

  const mut = useMutation({
    mutationFn: () => api.importLora({ url, name: name || undefined, family: family || undefined, kind: kind || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loras'] });
      toast({ title: 'Import started' });
      onClose();
    },
    onError: () => toast({ title: 'Import failed', variant: 'error' }),
  });

  return (
    <Dialog open onClose={onClose} title="Import LoRA" size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://civitai.com/models/… or a direct .safetensors URL"
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Family (optional)</label>
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value as LoraFamily | '')}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            >
              <option value="">Auto-detect</option>
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Kind (optional)</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as LoraKind | '')}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            >
              <option value="">—</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-ink-3)]">NSFW Civitai files need a Civitai token set in Settings.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mut.isPending} disabled={!url.trim()} onClick={() => mut.mutate()}>
            Import
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── Upload ─────────────────────────────

function UploadDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [family, setFamily] = useState<LoraFamily>('zimage');
  const [kind, setKind] = useState<LoraKind>('character');
  const [triggerWord, setTriggerWord] = useState('');

  const mut = useMutation({
    mutationFn: () => api.uploadLora(file!, family, kind, name, triggerWord || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loras'] });
      toast({ title: 'LoRA uploaded' });
      onClose();
    },
    onError: () => toast({ title: 'Upload failed', variant: 'error' }),
  });

  return (
    <Dialog open onClose={onClose} title="Upload .safetensors" size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">File</label>
          <input
            type="file"
            accept=".safetensors"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-[var(--color-ink-2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-bg-3)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--color-ink-0)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Family</label>
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value as LoraFamily)}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            >
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as LoraKind)}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Trigger word (optional)</label>
          <input
            value={triggerWord}
            onChange={(e) => setTriggerWord(e.target.value)}
            className="chip-mono w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mut.isPending} disabled={!file || !name.trim()} onClick={() => mut.mutate()}>
            Upload
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── Train ─────────────────────────────

function TrainThumb({ id, asset, selected, onClick }: { id: ID; asset?: Asset; selected: boolean; onClick: (e: React.MouseEvent) => void }) {
  const { data } = useQuery({ queryKey: ['asset', id], queryFn: () => api.asset(id), enabled: !asset, initialData: asset });
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'relative aspect-square overflow-hidden rounded-md border-2 transition-colors',
        selected ? 'border-[var(--color-amber-400)]' : 'border-transparent hover:border-[var(--color-hairline-strong)]',
      )}
    >
      {data ? <img src={mediaUrl(data.thumb ?? data.file)} alt="" className="size-full object-cover" /> : <Skeleton className="size-full" />}
      {selected && <div className="absolute inset-0 bg-[var(--color-amber-400)]/20" />}
    </button>
  );
}

function TrainDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['assets', 'image', 100], queryFn: () => api.assets({ kind: 'image', limit: 100 }) });
  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: () => api.characters() });
  const [characterId, setCharacterId] = useState<ID | ''>('');
  const [uploaded, setUploaded] = useState<ID[]>([]);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoraKind>('character');
  const [triggerWord, setTriggerWord] = useState('');
  const [steps, setSteps] = useState(1500);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploads = useImageUploads();

  const character = characters?.find((c) => c.id === characterId);
  const library = useMemo(() => new Map((data?.items ?? []).map((a: Asset) => [a.id, a])), [data]);
  // Uploads first, then either the chosen character's references or the recent library.
  const ids = useMemo(() => {
    const base = character ? character.referenceAssetIds : [...library.keys()];
    return [...new Set([...uploaded, ...base])];
  }, [uploaded, character, library]);

  function pickCharacter(id: ID | '') {
    setCharacterId(id);
    setAnchor(null);
    const c = characters?.find((x) => x.id === id);
    if (!c) return;
    setSelected(new Set([...uploaded, ...c.referenceAssetIds]));
    setKind('character');
    setName(c.name);
    setTriggerWord(c.triggerWord || `ohwx_${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
  }

  // Click toggles one image; shift-click applies that same choice to the whole range from the last click.
  function onThumbClick(index: number, e: React.MouseEvent) {
    const id = ids[index];
    const select = !selected.has(id);
    const [from, to] = e.shiftKey && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
    setSelected((s) => {
      const next = new Set(s);
      for (const rid of ids.slice(from, to + 1)) {
        if (select) next.add(rid);
        else next.delete(rid);
      }
      return next;
    });
    setAnchor(index);
  }

  async function addFiles(files: File[]) {
    const assets = await uploads.upload(files);
    if (assets.length === 0) return;
    const newIds = assets.map((a) => a.id);
    setUploaded((u) => [...newIds, ...u]);
    setSelected((s) => new Set([...s, ...newIds]));
    setAnchor(null);
  }

  const mut = useMutation({
    mutationFn: () =>
      api.trainLora({
        name,
        kind,
        triggerWord,
        assetIds: [...selected],
        steps,
        ...(character ? { characterId: character.id, description: character.description } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loras'] });
      toast({ title: 'Training started' });
      onClose();
    },
    onError: () => toast({ title: 'Failed to start training', variant: 'error' }),
  });

  const selectClass =
    'rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50';

  return (
    <Dialog open onClose={onClose} title="Train LoRA" size="lg">
      <div className="space-y-4">
        <BaseModelNote />

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Images from</label>
          <select value={characterId} onChange={(e) => pickCharacter(e.target.value)} className={clsx(selectClass, 'w-full')}>
            <option value="">Recent library images</option>
            {(characters ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}&apos;s references ({c.referenceAssetIds.length})
              </option>
            ))}
          </select>
        </div>

        <ImageDropZone onFiles={addFiles}>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">
              Images ({selected.size} selected)
              <span className="ml-2 font-normal text-[var(--color-ink-3)]">Shift-click selects a range</span>
            </label>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={ids.length === 0} onClick={() => setSelected((s) => new Set([...s, ...ids]))}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void addFiles(files);
                  e.target.value = '';
                }}
              />
              <Button size="sm" icon={<Upload className="size-3.5" />} loading={uploads.uploading} onClick={() => fileRef.current?.click()}>
                Upload
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
          {/* The scroll lives on a wrapper: a height-capped grid squeezes its rows and the tiles overlap. */}
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-hairline)] p-2">
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              {ids.map((id, i) => (
                <TrainThumb key={id} id={id} asset={library.get(id)} selected={selected.has(id)} onClick={(e) => onThumbClick(i, e)} />
              ))}
              {data && ids.length === 0 && (
                <div className="col-span-full py-6 text-center text-xs text-[var(--color-ink-3)]">
                  {character ? `${character.name} has no reference images yet.` : 'No images in your library yet.'} Drop images here or upload some.
                </div>
              )}
            </div>
          </div>
        </ImageDropZone>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as LoraKind)}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Trigger word</label>
            <input
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              className="chip-mono w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Steps</label>
            <input
              type="number"
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} loading={mut.isPending} disabled={selected.size === 0 || !name.trim() || !triggerWord.trim()} onClick={() => mut.mutate()}>
            Start training
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

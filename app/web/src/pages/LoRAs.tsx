import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { Button, Chip, Dialog, Menu, Progress, Skeleton, Slider } from '../components/ui';
import type { Asset, ID, Lora, LoraFamily, LoraKind } from '@shared/types';

const FAMILIES: { id: LoraFamily; label: string }[] = [
  { id: 'zimage', label: 'Image · Z-Image' },
  { id: 'wan22', label: 'Video · Wan 2.2' },
  { id: 'qwen_edit', label: 'Edit · Qwen' },
];

const KINDS: LoraKind[] = ['character', 'location', 'style', 'motion', 'other'];

export default function LoRAs() {
  const qc = useQueryClient();
  const { data: loras, isLoading } = useQuery({ queryKey: ['loras'], queryFn: () => api.loras() });
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [trainOpen, setTrainOpen] = useState(false);

  const byFamily = useMemo(() => {
    const map: Record<LoraFamily, Lora[]> = { zimage: [], wan22: [], qwen_edit: [] };
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
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">LoRAs</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Import, upload, or train LoRAs for characters, locations, and styles.</p>
          </div>
          <div className="flex items-center gap-2">
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
            <h2 className="mt-4 font-serif text-lg text-[var(--color-ink-0)]">No LoRAs yet</h2>
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
                  <h2 className="font-serif text-lg text-[var(--color-ink-0)]">{f.label}</h2>
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

function TrainDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['assets', 'image'], queryFn: () => api.assets({ kind: 'image', limit: 100 }) });
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoraKind>('character');
  const [triggerWord, setTriggerWord] = useState('');
  const [steps, setSteps] = useState(1500);

  const toggle = (id: ID) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mut = useMutation({
    mutationFn: () =>
      api.trainLora({
        name,
        kind,
        triggerWord,
        assetIds: [...selected],
        steps,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loras'] });
      toast({ title: 'Training started' });
      onClose();
    },
    onError: () => toast({ title: 'Failed to start training', variant: 'error' }),
  });

  return (
    <Dialog open onClose={onClose} title="Train LoRA" size="lg">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-ink-2)]">Images ({selected.size} selected)</label>
          </div>
          <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto rounded-lg border border-[var(--color-hairline)] p-2 sm:grid-cols-6">
            {(data?.items ?? []).map((a: Asset) => (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                className={clsx(
                  'relative aspect-square overflow-hidden rounded-md border-2 transition-colors',
                  selected.has(a.id) ? 'border-[var(--color-amber-400)]' : 'border-transparent hover:border-[var(--color-hairline-strong)]',
                )}
              >
                <img src={mediaUrl(a.thumb ?? a.file)} alt="" className="size-full object-cover" />
                {selected.has(a.id) && <div className="absolute inset-0 bg-[var(--color-amber-400)]/20" />}
              </button>
            ))}
            {data && data.items.length === 0 && <div className="col-span-full py-6 text-center text-xs text-[var(--color-ink-3)]">No images in your library yet.</div>}
          </div>
        </div>

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

// The character builder: describe a character → pick a look from rendered candidates (or your own photo) →
// one job makes the sheets, a varied training set and the LoRA (server/pipeline/character_build.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Package, Sparkles, Upload, User, Wand2 } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import { Button, Dialog, Progress, Segmented, Skeleton } from '../ui';
import { CHARACTER_COLORS } from '@shared/presets';
import type { Character, ID, Job } from '@shared/types';
import { useImageUploads } from '../../hooks/useImageUploads';
import { useEngineState } from '../../hooks/useEngineState';
import { ImageDropZone } from '../ImageDropZone';

type Step = 'describe' | 'look' | 'build' | 'done';

const LOOK_COUNT = 4;

function nextColor(characters: Character[]): string {
  const used = new Set(characters.map((c) => c.color));
  return CHARACTER_COLORS.find((c) => !used.has(c)) ?? CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length]!;
}

const active = (job: Job | undefined) => !!job && (job.status === 'queued' || job.status === 'running');

/** The build job running (or queued) for a character, if any: the Cast page shows its progress on the card. */
export function useCharacterBuildJob(characterId: ID): Job | undefined {
  const jobs = useJobsStore((s) => s.jobs);
  return useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.type === 'character_build' && (j.params as { characterId?: ID }).characterId === characterId && active(j))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0],
    [jobs, characterId],
  );
}

export function CharacterBuilder({ characterId, onClose }: { characterId?: ID; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: characters } = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const { data: existing } = useQuery({ queryKey: ['character', characterId], queryFn: () => api.character(characterId!), enabled: !!characterId });
  const { isOff } = useEngineState();
  const jobs = useJobsStore((s) => s.jobs);

  const [id, setId] = useState<ID | undefined>(characterId);
  const [step, setStep] = useState<Step>('describe');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'prop'>('person');
  const [description, setDescription] = useState('');
  const [lookJobIds, setLookJobIds] = useState<ID[]>([]);
  const [uploadedIds, setUploadedIds] = useState<ID[]>([]);
  const [lookId, setLookId] = useState<ID | null>(null);
  const [train, setTrain] = useState(true);
  const [buildJobId, setBuildJobId] = useState<ID | null>(null);
  const seeded = useRef(false);

  // An existing character opens prefilled; with a description already, straight at the look step.
  useEffect(() => {
    if (!existing || seeded.current) return;
    seeded.current = true;
    setName(existing.name);
    setKind(existing.kind ?? 'person');
    setDescription(existing.description);
    if (existing.description.trim()) setStep('look');
  }, [existing]);

  const character = id ? (qc.getQueryData<Character>(['character', id]) ?? existing) : undefined;
  // Looks rendered for this character earlier (this dialog's jobs, or any earlier looks job still in the queue list),
  // so closing and reopening the builder doesn't lose the candidates.
  const lookJobs = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => lookJobIds.includes(j.id) || (id && j.type === 'character_refs' && (j.params as { characterId?: ID; attach?: boolean }).characterId === id && (j.params as { attach?: boolean }).attach === false))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [jobs, lookJobIds, id],
  );
  const renderedIds = lookJobs.flatMap((j) => j.outputAssetIds);
  const looksPending = lookJobs.some(active);
  const candidateIds = useMemo(() => [...new Set([...uploadedIds, ...renderedIds, ...(character?.referenceAssetIds ?? [])])], [uploadedIds, renderedIds, character?.referenceAssetIds]);
  const buildJob = buildJobId ? jobs[buildJobId] : undefined;

  const looksMut = useMutation({
    mutationFn: (cid: ID) => api.characterLooks(cid, { count: LOOK_COUNT }),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      setLookJobIds((ids) => [...ids, job.id]);
    },
    onError: (err) => toast({ title: 'Failed to start rendering looks', description: (err as Error).message, variant: 'error' }),
  });

  const describeMut = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), kind, description: description.trim() };
      const c = id ? await api.updateCharacter(id, body) : await api.createCharacter({ ...body, color: nextColor(characters ?? []), referenceAssetIds: [] });
      return c;
    },
    onSuccess: (c) => {
      setId(c.id);
      qc.setQueryData(['character', c.id], c);
      qc.invalidateQueries({ queryKey: ['characters'] });
      setStep('look');
      if (c.referenceAssetIds.length === 0 && lookJobIds.length === 0) looksMut.mutate(c.id);
    },
    onError: (err) => toast({ title: 'Failed to save the character', description: (err as Error).message, variant: 'error' }),
  });

  const uploads = useImageUploads();
  const uploadMut = useMutation({
    mutationFn: (files: File[]) => uploads.upload(files),
    onSuccess: (assets) => {
      if (assets.length === 0) return;
      setUploadedIds((ids) => [...assets.map((a) => a.id), ...ids]);
      setLookId(assets[0]!.id);
    },
  });

  const buildMut = useMutation({
    mutationFn: () => api.buildCharacter(id!, { lookAssetId: lookId!, train }),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      setBuildJobId(job.id);
      setStep('build');
    },
    onError: (err) => toast({ title: 'Failed to start the build', description: (err as Error).message, variant: 'error' }),
  });

  useEffect(() => {
    if (!buildJob) return;
    if (buildJob.status === 'done') {
      qc.invalidateQueries({ queryKey: ['character', id] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['loras'] });
      setStep('done');
    }
  }, [buildJob?.status]);

  const canDescribe = name.trim().length > 0 && description.trim().length > 0;
  const editOff = isOff('qwen_edit');

  return (
    <Dialog open onClose={onClose} title={step === 'done' ? `${name} is ready` : 'Build a character'} size="lg">
      <Steps step={step} />

      {step === 'describe' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Describe who they are. The studio renders a few looks to choose from, then builds everything it needs to keep them the same in every shot:
            reference sheets, a set of training images, and a LoRA.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mara" className={inputClass} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">Kind</label>
              <Segmented
                options={[
                  { value: 'person', label: 'Person', icon: <User className="size-3.5" /> },
                  { value: 'prop', label: 'Prop', icon: <Package className="size-3.5" /> },
                ]}
                value={kind}
                onChange={setKind}
                size="sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">What they look like</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={
                kind === 'prop'
                  ? 'A dented 1970s pickup truck, faded teal paint, rust along the wheel arches, a cracked windshield…'
                  : 'A woman in her 30s with short silver hair, a scar through her left eyebrow, black trench coat over a grey hoodie…'
              }
              className={clsx(inputClass, 'resize-none')}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">Be specific about what must never change: face, hair, build, the outfit they wear in the film.</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={<Wand2 className="size-4" />} disabled={!canDescribe} loading={describeMut.isPending} onClick={() => describeMut.mutate()}>
              {id && (character?.referenceAssetIds.length ?? 0) > 0 ? 'Next: pick a look' : 'Render looks'}
            </Button>
          </div>
        </div>
      )}

      {step === 'look' && id && (
        <ImageDropZone onFiles={(files) => uploadMut.mutate(files)}>
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-ink-2)]">
              Pick the one image everything else is built from. Looks are rendered from the description; you can also drop in a photo of your own.
            </p>
            {candidateIds.length === 0 && !looksPending && (
              <div className="rounded-lg border border-dashed border-[var(--color-hairline)] px-3 py-8 text-center text-xs text-[var(--color-ink-3)]">
                No looks yet. Render some, or drop a photo here.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {candidateIds.map((aid) => (
                <LookThumb key={aid} assetId={aid} selected={lookId === aid} onSelect={() => setLookId(aid)} />
              ))}
              {looksPending && Array.from({ length: LOOK_COUNT - (lookJobs.find(active)?.outputAssetIds.length ?? 0) }).map((_, i) => <Skeleton key={`pending-${i}`} className="aspect-square w-full" />)}
            </div>
            {looksPending && (
              <div>
                <Progress value={lookJobs.find((j) => j.status === 'running')?.progress ?? 0} />
                <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">{lookJobs.find((j) => j.status === 'running')?.stage ?? 'Queued'}</div>
              </div>
            )}
            {uploads.progress && <Progress value={uploads.progress.done / uploads.progress.total} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={looksMut.isPending} disabled={looksPending} onClick={() => looksMut.mutate(id)}>
                {candidateIds.length ? 'More looks' : 'Render looks'}
              </Button>
              <UploadButton onFiles={(files) => uploadMut.mutate(files)} loading={uploadMut.isPending} />
              <button className="text-xs text-[var(--color-ink-3)] hover:underline" onClick={() => setStep('describe')}>
                Edit description
              </button>
            </div>

            <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50 p-3.5">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" checked={train} onChange={(e) => setTrain(e.target.checked)} className="mt-0.5 accent-[var(--color-amber-400)]" />
                <span>
                  <span className="block text-sm text-[var(--color-ink-0)]">Train a LoRA</span>
                  <span className="block text-xs text-[var(--color-ink-3)]">
                    Learns the character from the images the build makes, so Create → Image and shot keyframes can draw them anywhere. About 10 minutes of
                    images, then 30–60 minutes of training on an RTX 4090. Off: sheets and training images only.
                  </span>
                </span>
              </label>
              {editOff && (
                <p className="mt-2 text-xs text-[var(--color-amber-400)]">
                  The edit models aren&apos;t installed on this pod, so the sheets and training images are drawn from the description rather than from the chosen
                  look. They&apos;ll match less closely.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!lookId} loading={buildMut.isPending} onClick={() => buildMut.mutate()}>
                Build character
              </Button>
            </div>
          </div>
        </ImageDropZone>
      )}

      {step === 'build' && (
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            {lookId && <LookThumb assetId={lookId} selected={false} onSelect={() => {}} className="w-28 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--color-ink-1)]">Building {name}…</p>
              <Progress value={buildJob?.progress ?? 0} className="mt-2" />
              <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">{buildJob?.status === 'queued' ? 'Queued' : (buildJob?.stage ?? 'Starting…')}</div>
              {buildJob?.status === 'error' && <p className="mt-2 text-xs text-[var(--color-danger)]">{buildJob.error}</p>}
              {buildJob?.status === 'canceled' && <p className="mt-2 text-xs text-[var(--color-ink-3)]">Canceled.</p>}
            </div>
          </div>
          <p className="text-xs text-[var(--color-ink-3)]">You can close this. The card on the Cast page shows progress, and the queue drawer has the job.</p>
          <div className="flex justify-end gap-2 pt-1">
            {(buildJob?.status === 'error' || buildJob?.status === 'canceled') && (
              <Button icon={<Sparkles className="size-4" />} loading={buildMut.isPending} onClick={() => buildMut.mutate()}>
                Try again
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && character && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            {name} now has a turnaround{kind === 'person' ? ', a face close-up' : ''}, {character.referenceAssetIds.length} reference images
            {character.loraId ? ', and a trained LoRA' : ''}. Scenes they appear in will keep them consistent.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[character.sheetAssets?.turnaround, character.sheetAssets?.face, ...character.referenceAssetIds]
              .filter((v, i, arr): v is ID => !!v && arr.indexOf(v) === i)
              .slice(0, 12)
              .map((aid) => (
                <LookThumb key={aid} assetId={aid} selected={false} onSelect={() => {}} />
              ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="primary" icon={<Check className="size-4" />} onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

const inputClass =
  'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50';

function Steps({ step }: { step: Step }) {
  const items: { key: Step; label: string }[] = [
    { key: 'describe', label: 'Describe' },
    { key: 'look', label: 'Pick a look' },
    { key: 'build', label: 'Build' },
  ];
  const index = step === 'done' ? 3 : items.findIndex((i) => i.key === step);
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs">
      {items.map((item, i) => (
        <li key={item.key} className="flex items-center gap-2">
          <span
            className={clsx(
              'flex size-5 items-center justify-center rounded-full text-[10px] font-medium',
              i < index ? 'bg-[var(--color-amber-400)] text-black' : i === index ? 'border border-[var(--color-amber-400)] text-[var(--color-amber-400)]' : 'border border-[var(--color-hairline)] text-[var(--color-ink-3)]',
            )}
          >
            {i < index ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={i === index ? 'text-[var(--color-ink-0)]' : 'text-[var(--color-ink-3)]'}>{item.label}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-6 bg-[var(--color-hairline)]" />}
        </li>
      ))}
    </ol>
  );
}

function LookThumb({ assetId, selected, onSelect, className }: { assetId: ID; selected: boolean; onSelect: () => void; className?: string }) {
  const { data: asset } = useQuery({ queryKey: ['asset', assetId], queryFn: () => api.asset(assetId) });
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'relative aspect-square overflow-hidden rounded-lg border-2 bg-[var(--color-bg-2)] transition-colors',
        selected ? 'border-[var(--color-amber-400)]' : 'border-transparent hover:border-[var(--color-hairline-strong)]',
        className,
      )}
    >
      {asset ? <img src={mediaUrl(asset.thumb ?? asset.file)} alt="" className="size-full object-cover" /> : <Skeleton className="size-full" />}
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--color-amber-400)] text-black">
          <Check className="size-3" />
        </span>
      )}
    </button>
  );
}

function UploadButton({ onFiles, loading }: { onFiles: (files: File[]) => void; loading?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} loading={loading} onClick={() => ref.current?.click()}>
        Use a photo
      </Button>
    </>
  );
}

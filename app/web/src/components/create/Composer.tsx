import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import type { AngleSpec, AspectRatio, Asset, GenerateRequest, Lora } from '@shared/types';
import { ASPECTS, CAMERA_MOVES, DURATIONS } from '@shared/presets';
import { api, ApiClientError, mediaUrl } from '../../lib/api';
import { toast, useComposerStore, type ComposerMode } from '../../lib/store';
import { Button, IconButton, Popover, Segmented, Slider, Tooltip } from '../ui';
import { Camera, Compass, Drama, Edit3, Film, Image as ImageIcon, Lock, Minus, Plus, Shuffle, Sparkles, Upload, Video, X } from 'lucide-react';
import { AnglePicker } from './AnglePicker';
import { PerformSlots } from './PerformSlots';

const MODE_OPTIONS: { value: ComposerMode; label: string; icon: React.ReactNode }[] = [
  { value: 'image', label: 'Image', icon: <ImageIcon className="size-3.5" /> },
  { value: 'video', label: 'Video', icon: <Video className="size-3.5" /> },
  { value: 'edit', label: 'Edit', icon: <Edit3 className="size-3.5" /> },
  { value: 'angles', label: 'Angles', icon: <Compass className="size-3.5" /> },
  { value: 'perform', label: 'Perform', icon: <Drama className="size-3.5" /> },
];

const PERFORM_ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1'];

const QUALITY_OPTIONS = [
  { value: 'fast' as const, label: 'Fast 480p' },
  { value: 'hd' as const, label: 'HD 720p' },
];

const DURATION_OPTIONS = DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }));

const chipBtnClass =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-1)] transition-colors hover:bg-[var(--color-bg-3)] hover:text-[var(--color-ink-0)]';

function maxRefsFor(mode: ComposerMode) {
  if (mode === 'edit') return 3;
  if (mode === 'image' || mode === 'perform') return 0;
  return 1;
}

function maxCountFor(mode: ComposerMode) {
  if (mode === 'video') return 2;
  if (mode === 'perform') return 1;
  return 4;
}

function estimateLabel(mode: ComposerMode, quality: 'fast' | 'hd'): string {
  if (mode === 'video') return quality === 'hd' ? '~3–5 min' : '~1–2 min';
  if (mode === 'perform') return '~4 min per 5 s';
  return '~2s';
}

function loraFamilyFor(mode: ComposerMode): 'zimage' | 'wan22' | 'qwen_edit' | undefined {
  if (mode === 'image') return 'zimage';
  if (mode === 'video') return 'wan22';
  if (mode === 'edit') return 'qwen_edit';
  return undefined;
}

function placeholderFor(mode: ComposerMode): string {
  if (mode === 'angles') return 'Optional extra direction…';
  if (mode === 'perform') return 'Describe the new scene, e.g. a torch-lit castle courtyard at night, light rain';
  return 'Describe a shot…  (⌘/Ctrl + Enter to generate)';
}

function AspectGlyph({ aspect }: { aspect: AspectRatio }) {
  const [w, h] = aspect.split(':').map(Number);
  const scale = 13 / Math.max(w, h);
  return <span className="inline-block shrink-0 border border-current" style={{ width: Math.max(4, w * scale), height: Math.max(4, h * scale) }} />;
}

export function Composer() {
  const composer = useComposerStore();
  const mode = composer.mode;
  const qc = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 10_000 });

  const family = loraFamilyFor(mode);
  const { data: loras } = useQuery({
    queryKey: ['loras', family],
    queryFn: () => api.loras(family),
    enabled: !!family,
  });

  const { data: recentAssets } = useQuery({
    queryKey: ['assets', 'composer-recent'],
    queryFn: () => api.assets({ kind: 'image', limit: 24 }),
  });

  // Keep engine in sync with mode + whether a reference image is present.
  useEffect(() => {
    const engine =
      mode === 'image'
        ? 'zimage'
        : mode === 'edit'
          ? 'qwen_edit'
          : mode === 'angles'
            ? 'qwen_angle'
            : mode === 'perform'
              ? 'wan_animate'
              : composer.refs.length > 0
                ? 'wan_i2v'
                : 'wan_t2v';
    if (engine !== composer.engine) composer.set({ engine });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, composer.refs.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [composer.prompt, mode]);

  function handleModeChange(m: ComposerMode) {
    composer.set({
      mode: m,
      refs: composer.refs.slice(0, maxRefsFor(m)),
      count: Math.min(composer.count, maxCountFor(m)),
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    for (const file of Array.from(files)) {
      try {
        const asset = await api.upload(file);
        composer.addRef(asset);
      } catch {
        toast({ title: 'Upload failed', variant: 'error' });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (mode === 'image') return;
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    try {
      const asset = await api.upload(file);
      if (mode === 'perform') composer.setCharacterAsset(asset);
      else composer.addRef(asset);
    } catch {
      toast({ title: 'Paste upload failed', variant: 'error' });
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (mode === 'image') return;
    e.preventDefault();
  }

  function onDrop(e: React.DragEvent) {
    if (mode === 'image') return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const asset = JSON.parse(raw) as Asset;
      if (!asset?.id) return;
      if (mode === 'perform') {
        if (asset.kind === 'video') composer.setPerformanceAsset(asset);
        else composer.setCharacterAsset(asset);
      } else {
        composer.addRef(asset);
      }
    } catch {
      /* ignore non-asset drops */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleGenerate();
    }
  }

  async function handleEnhance() {
    if (!composer.prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await api.enhance(composer.prompt, mode === 'video' ? 'video' : 'image');
      composer.setPrompt(res.prompt);
    } catch (e) {
      if (!(e instanceof ApiClientError && e.status === 400)) {
        toast({ title: 'Enhance failed', variant: 'error' });
      }
    } finally {
      setEnhancing(false);
    }
  }

  function toggleLora(lora: Lora) {
    const exists = composer.loras.find((l) => l.loraId === lora.id);
    if (exists) {
      composer.set({ loras: composer.loras.filter((l) => l.loraId !== lora.id) });
    } else {
      composer.set({ loras: [...composer.loras, { loraId: lora.id, strength: lora.defaultStrength ?? 1 }] });
    }
  }

  function setLoraStrength(loraId: string, strength: number) {
    composer.set({ loras: composer.loras.map((l) => (l.loraId === loraId ? { ...l, strength } : l)) });
  }

  async function handleGenerate() {
    if (mode !== 'angles' && !composer.prompt.trim()) {
      toast({ title: 'Add a prompt first', variant: 'error' });
      return;
    }
    if (mode === 'edit' && composer.refs.length === 0) {
      toast({ title: 'Add at least one reference image', variant: 'error' });
      return;
    }
    if (mode === 'angles' && composer.refs.length !== 1) {
      toast({ title: 'Angles mode needs exactly one reference image', variant: 'error' });
      return;
    }
    if (mode === 'perform' && (!composer.performanceAsset || !composer.characterAsset)) {
      toast({ title: 'Add a performance clip and a character image', variant: 'error' });
      return;
    }

    const req: GenerateRequest = {
      engine: composer.engine,
      prompt: composer.prompt,
      aspect: composer.aspect,
      count: Math.min(Math.max(composer.count, 1), maxCountFor(mode)),
      seed: composer.seedLocked ? composer.seed : undefined,
      loras: composer.loras.length ? composer.loras : undefined,
      inputAssetIds: composer.refs.length ? composer.refs.map((r) => r.id) : undefined,
    };
    if (mode === 'video') {
      req.durationSec = composer.durationSec;
      req.quality = composer.quality;
      req.cameraMove = composer.cameraMove;
    }
    if (mode === 'angles') {
      req.angle = composer.angle as AngleSpec;
    }
    if (mode === 'perform') {
      req.count = 1;
      req.inputAssetIds = [composer.characterAsset!.id, composer.performanceAsset!.id];
      req.motionPrompt = composer.motionPrompt.trim() || undefined;
      req.characterPrompt = composer.characterPrompt.trim() || undefined;
    }

    setSubmitting(true);
    try {
      await api.generate(req);
      toast({ title: 'Generating…', description: estimateLabel(mode, composer.quality), variant: 'success' });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      if (mode === 'perform') {
        composer.setPerformanceAsset(undefined);
        composer.setCharacterAsset(undefined);
        composer.set({ motionPrompt: '' });
      } else {
        composer.clearRefs();
      }
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Something went wrong';
      toast({ title: 'Generation failed', description: msg, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  const engineReady = system?.engines[composer.engine] ?? true;
  const maxRefs = maxRefsFor(mode);
  const maxCount = maxCountFor(mode);
  const performIncomplete = mode === 'perform' && (!composer.performanceAsset || !composer.characterAsset);

  return (
    <div
      className="glass-panel fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 flex-col gap-3 rounded-2xl p-3 sm:bottom-6 sm:p-4"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-2">
        <Segmented options={MODE_OPTIONS} value={mode} onChange={handleModeChange} size="sm" />
        {system?.llmConfigured && mode !== 'angles' && (
          <Tooltip label="Enhance prompt">
            <IconButton
              icon={<Sparkles className="size-4" />}
              label="Enhance prompt"
              onClick={handleEnhance}
              disabled={enhancing || !composer.prompt.trim()}
            />
          </Tooltip>
        )}
      </div>

      {mode === 'angles' && (
        <AnglePicker value={composer.angle} onChange={(patch) => composer.set({ angle: { ...composer.angle, ...patch } })} />
      )}

      <textarea
        id="composer-prompt"
        ref={textareaRef}
        value={composer.prompt}
        onChange={(e) => composer.setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={1}
        placeholder={placeholderFor(mode)}
        className="w-full resize-none bg-transparent text-sm text-[var(--color-ink-0)] placeholder:text-[var(--color-ink-3)] focus:outline-none"
      />

      {mode === 'perform' && (
        <>
          <PerformSlots />
          <input
            type="text"
            value={composer.motionPrompt}
            onChange={(e) => composer.set({ motionPrompt: e.target.value })}
            placeholder="What are you doing in the clip? (optional)"
            aria-label="Motion description (optional)"
            className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-xs text-[var(--color-ink-1)] placeholder:text-[var(--color-ink-3)] focus:outline-none focus:border-[var(--color-hairline-strong)]"
          />
        </>
      )}

      {mode !== 'image' && mode !== 'perform' && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {composer.refs.map((r) => (
            <div key={r.id} className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-[var(--color-hairline)]">
              <img src={mediaUrl(r.thumb ?? r.file)} className="h-full w-full object-cover" alt="" />
              <button
                onClick={() => composer.removeRef(r.id)}
                className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-white"
                aria-label="Remove reference"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
          {composer.refs.length < maxRefs && (
            <div className="flex shrink-0 items-center gap-1.5">
              <IconButton icon={<Upload className="size-4" />} label="Upload reference" size="sm" onClick={() => fileInputRef.current?.click()} />
              <Popover
                trigger={({ onClick, ref }) => (
                  <button ref={ref} onClick={onClick} className={chipBtnClass} type="button">
                    <Plus className="size-3.5" /> Gallery
                  </button>
                )}
              >
                <div className="grid max-h-72 w-64 grid-cols-4 gap-1.5 overflow-y-auto p-2">
                  {(recentAssets?.items ?? []).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => composer.addRef(a)}
                      className="aspect-square overflow-hidden rounded-md border border-[var(--color-hairline)]"
                      type="button"
                    >
                      <img src={mediaUrl(a.thumb ?? a.file)} className="h-full w-full object-cover" alt="" />
                    </button>
                  ))}
                  {(!recentAssets || recentAssets.items.length === 0) && (
                    <p className="col-span-4 py-4 text-center text-xs text-[var(--color-ink-3)]">No images yet.</p>
                  )}
                </div>
              </Popover>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple={mode === 'edit'}
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {mode !== 'angles' && (
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <Popover
            trigger={({ onClick, ref }) => (
              <button ref={ref} onClick={onClick} className={chipBtnClass} type="button">
                <AspectGlyph aspect={composer.aspect} /> {composer.aspect}
              </button>
            )}
          >
            <div className="grid grid-cols-3 gap-2 p-3">
              {(mode === 'perform' ? PERFORM_ASPECTS : ASPECTS).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => composer.set({ aspect: a })}
                  className={clsx(
                    'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs',
                    a === composer.aspect
                      ? 'border-[var(--color-amber-400)] text-[var(--color-amber-300)]'
                      : 'border-[var(--color-hairline)] text-[var(--color-ink-2)] hover:border-[var(--color-hairline-strong)]',
                  )}
                >
                  <AspectGlyph aspect={a} />
                  {a}
                </button>
              ))}
            </div>
          </Popover>

          {mode !== 'perform' && (
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-1 py-1">
              <IconButton
                size="sm"
                icon={<Minus className="size-3.5" />}
                label="Fewer variations"
                onClick={() => composer.set({ count: Math.max(1, composer.count - 1) })}
                disabled={composer.count <= 1}
              />
              <span className="chip-mono w-4 text-center text-xs">{composer.count}</span>
              <IconButton
                size="sm"
                icon={<Plus className="size-3.5" />}
                label="More variations"
                onClick={() => composer.set({ count: Math.min(maxCount, composer.count + 1) })}
                disabled={composer.count >= maxCount}
              />
            </div>
          )}

          {mode === 'video' && (
            <Segmented
              size="sm"
              options={DURATION_OPTIONS}
              value={String(composer.durationSec)}
              onChange={(v) => composer.set({ durationSec: Number(v) })}
            />
          )}

          {mode === 'video' && (
            <Segmented size="sm" options={QUALITY_OPTIONS} value={composer.quality} onChange={(v) => composer.set({ quality: v })} />
          )}

          {mode === 'video' && (
            <Popover
              trigger={({ onClick, ref }) => (
                <button ref={ref} onClick={onClick} className={chipBtnClass} type="button">
                  <Film className="size-3.5" /> {CAMERA_MOVES.find((m) => m.id === composer.cameraMove)?.label ?? 'Static'}
                </button>
              )}
            >
              <div className="grid max-h-80 w-72 grid-cols-2 gap-1.5 overflow-y-auto p-2">
                {CAMERA_MOVES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => composer.set({ cameraMove: m.id })}
                    className={clsx(
                      'flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left text-xs',
                      m.id === composer.cameraMove
                        ? 'border-[var(--color-amber-400)] bg-[var(--color-amber-400)]/10 text-[var(--color-amber-300)]'
                        : 'border-[var(--color-hairline)] text-[var(--color-ink-2)] hover:border-[var(--color-hairline-strong)]',
                    )}
                  >
                    <span className="font-medium text-[var(--color-ink-0)]">{m.label}</span>
                    <span className="text-[10px] text-[var(--color-ink-3)]">{m.hint}</span>
                  </button>
                ))}
              </div>
            </Popover>
          )}

          {family && (
            <Popover
              trigger={({ onClick, ref }) => (
                <button ref={ref} onClick={onClick} className={chipBtnClass} type="button">
                  <Sparkles className="size-3.5" /> LoRAs{composer.loras.length ? ` (${composer.loras.length})` : ''}
                </button>
              )}
            >
              <div className="max-h-80 w-72 overflow-y-auto p-3">
                {(loras ?? [])
                  .filter((l) => l.status === 'ready')
                  .map((l) => {
                    const active = composer.loras.find((x) => x.loraId === l.id);
                    return (
                      <div key={l.id} className="mb-2 rounded-lg border border-[var(--color-hairline)] p-2">
                        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-1)]">
                          <input type="checkbox" checked={!!active} onChange={() => toggleLora(l)} />
                          {l.name}
                        </label>
                        {active && (
                          <Slider
                            className="mt-2"
                            value={active.strength}
                            min={0}
                            max={2}
                            step={0.05}
                            onChange={(v) => setLoraStrength(l.id, v)}
                            formatValue={(v) => v.toFixed(2)}
                          />
                        )}
                      </div>
                    );
                  })}
                {(!loras || loras.filter((l) => l.status === 'ready').length === 0) && (
                  <p className="text-xs text-[var(--color-ink-3)]">No LoRAs ready for this engine yet.</p>
                )}
              </div>
            </Popover>
          )}

          <div className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2 py-1">
            <Camera className="size-3.5 text-[var(--color-ink-3)]" />
            <input
              type="number"
              value={composer.seed ?? ''}
              onChange={(e) => composer.set({ seed: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="seed"
              className="chip-mono w-16 bg-transparent text-xs text-[var(--color-ink-1)] focus:outline-none"
            />
            <IconButton
              size="sm"
              icon={composer.seedLocked ? <Lock className="size-3.5" /> : <Shuffle className="size-3.5" />}
              label={composer.seedLocked ? 'Seed locked' : 'Randomize seed'}
              active={composer.seedLocked}
              onClick={() =>
                composer.set({
                  seedLocked: !composer.seedLocked,
                  seed: composer.seedLocked ? undefined : (composer.seed ?? Math.floor(Math.random() * 1e9)),
                })
              }
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="chip-mono text-[var(--color-ink-3)]">{estimateLabel(mode, composer.quality)}</span>
        <Tooltip
          label={
            !engineReady
              ? 'Model files still downloading'
              : performIncomplete
                ? 'Add a performance clip and a character image'
                : 'Generate (⌘/Ctrl + Enter)'
          }
        >
          <Button variant="primary" size="lg" onClick={() => void handleGenerate()} loading={submitting} disabled={!engineReady || performIncomplete}>
            Generate
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

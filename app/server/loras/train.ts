// LoRA training via ai-toolkit (https://github.com/ostris/ai-toolkit), run as a queue job runner.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assets, characters, loras, locations } from '../db';
import { emit } from '../events';
import { AI_TOOLKIT_DIR, DATA_DIR, MODELS_DIR } from '../config';
import { registerRunner } from '../pipeline/queue';
import { assertPromptsAllowed } from '../pipeline/guard';
import type { Asset, ID, LoraKind, LoraTrainRequest } from '../../shared/types';

// ───────────────────────────── param validation ─────────────────────────────

const LORA_KINDS: LoraKind[] = ['character', 'location', 'style', 'motion', 'other'];

function readTrainParams(raw: Record<string, unknown>): LoraTrainRequest {
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  const kind = typeof raw.kind === 'string' && (LORA_KINDS as string[]).includes(raw.kind) ? (raw.kind as LoraKind) : undefined;
  const triggerWord = typeof raw.triggerWord === 'string' ? raw.triggerWord : undefined;
  const assetIds = Array.isArray(raw.assetIds) ? raw.assetIds.filter((v): v is string => typeof v === 'string') : undefined;

  if (!name) throw new Error('lora_train job is missing params.name');
  if (!kind) throw new Error('lora_train job is missing a valid params.kind');
  if (!triggerWord) throw new Error('lora_train job is missing params.triggerWord');
  if (!assetIds || assetIds.length === 0) throw new Error('lora_train job is missing params.assetIds');

  return {
    name,
    kind,
    triggerWord,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    assetIds,
    steps: typeof raw.steps === 'number' ? raw.steps : undefined,
    rank: typeof raw.rank === 'number' ? raw.rank : undefined,
    learningRate: typeof raw.learningRate === 'number' ? raw.learningRate : undefined,
    characterId: typeof raw.characterId === 'string' ? raw.characterId : undefined,
    locationId: typeof raw.locationId === 'string' ? raw.locationId : undefined,
  };
}

/**
 * Assumption: Asset.file is the path served at `/media/${file}` (per shared/types.ts's Asset
 * doc comment), and config.ts creates `DATA_DIR/media`, so the file on disk is DATA_DIR/media/<file>.
 */
function assetDiskPath(asset: Asset): string {
  return path.join(DATA_DIR, 'media', asset.file);
}

// ───────────────────────────── sanitizing ─────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'lora';
}

// ───────────────────────────── ai-toolkit install ─────────────────────────────

/** Spawn a command, awaiting its exit; resolves with the captured tail of stdout+stderr. */
function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number | null; tail: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    const tail: string[] = [];
    const pushLine = (line: string) => {
      tail.push(line);
      if (tail.length > 200) tail.shift();
    };
    child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').forEach((l) => l && pushLine(l)));
    child.stderr?.on('data', (d: Buffer) => d.toString().split('\n').forEach((l) => l && pushLine(l)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, tail }));
  });
}

/** Try `python3` first, fall back to `python` if the binary isn't found. */
async function runPython(args: string[], cwd?: string): Promise<{ code: number | null; tail: string[] }> {
  try {
    return await run('python3', args, cwd);
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return run('python', args, cwd);
    }
    throw err;
  }
}

async function ensureAiToolkitInstalled(onStage: (stage: string) => void): Promise<void> {
  const runPyPath = path.join(AI_TOOLKIT_DIR, 'run.py');
  if (fs.existsSync(runPyPath)) return;

  onStage('Installing trainer (first time only)…');

  const dirExists = fs.existsSync(AI_TOOLKIT_DIR);
  if (!dirExists) {
    const cloneResult = await run('git', ['clone', '--depth', '1', 'https://github.com/ostris/ai-toolkit', AI_TOOLKIT_DIR]);
    if (cloneResult.code !== 0) {
      throw new Error(`git clone of ai-toolkit failed:\n${cloneResult.tail.join('\n')}`);
    }
  }
  // else: directory exists but lacks run.py — unexpected state (e.g. a partial/failed prior
  // clone). We don't re-clone over it; just proceed to venv+pip below and hope requirements.txt
  // is present, since that's the best-effort recovery without risking data loss.

  const venvResult = await runPython(['-m', 'venv', path.join(AI_TOOLKIT_DIR, 'venv')]);
  if (venvResult.code !== 0) {
    throw new Error(`Creating the ai-toolkit venv failed:\n${venvResult.tail.join('\n')}`);
  }

  const pipBin = path.join(AI_TOOLKIT_DIR, 'venv', 'bin', 'pip');
  const pipResult = await run(pipBin, ['install', '-r', 'requirements.txt'], AI_TOOLKIT_DIR);
  if (pipResult.code !== 0) {
    throw new Error(`pip install -r requirements.txt failed:\n${pipResult.tail.join('\n')}`);
  }
}

// ───────────────────────────── dataset + config ─────────────────────────────

function buildDataset(jobId: ID, params: LoraTrainRequest): { datasetDir: string; jobDir: string } {
  const jobDir = path.join(DATA_DIR, 'training', jobId);
  const datasetDir = path.join(jobDir, 'dataset');
  fs.mkdirSync(datasetDir, { recursive: true });

  const caption = `${params.triggerWord}, ${params.description ?? ''}`.replace(/,\s*$/, '');

  params.assetIds.forEach((assetId, i) => {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`Training asset not found: ${assetId}`);
    const srcPath = assetDiskPath(asset);
    const ext = path.extname(asset.file) || '.png';
    const seq = String(i + 1).padStart(3, '0');
    const destImagePath = path.join(datasetDir, `${seq}${ext}`);
    const destCaptionPath = path.join(datasetDir, `${seq}.txt`);
    fs.copyFileSync(srcPath, destImagePath);
    fs.writeFileSync(destCaptionPath, caption, 'utf8');
  });

  return { datasetDir, jobDir };
}

function buildConfigYaml(params: LoraTrainRequest, jobDir: string, datasetDir: string): string {
  const safeName = sanitizeName(params.name);
  const rank = params.rank ?? 16;
  const steps = params.steps ?? 1500;
  const lr = params.learningRate ?? 1e-4;
  const trainingFolder = path.join(jobDir, 'output');

  // Sample generation is intentionally disabled (no preview images during training): the task
  // spec explicitly allows either omitting the sample block or setting sample_every absurdly
  // high. We take the latter since ai-toolkit's example configs always include a sample block.
  return `job: extension
config:
  name: ${safeName}
  process:
    - type: sd_trainer
      training_folder: ${trainingFolder}
      device: cuda:0
      network:
        type: lora
        linear: ${rank}
        linear_alpha: ${rank}
      save:
        dtype: bf16
        save_every: ${steps}
        max_step_saves_to_keep: 1
      datasets:
        - folder_path: ${datasetDir}
          caption_ext: txt
          resolution: [512, 768, 1024]
      train:
        batch_size: 1
        steps: ${steps}
        gradient_checkpointing: true
        noise_scheduler: flowmatch
        optimizer: adamw8bit
        lr: ${lr}
        dtype: bf16
      model:
        name_or_path: Tongyi-MAI/Z-Image-Turbo
        arch: zimage
        assistant_lora_path: ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors
        quantize: true
      sample:
        sample_every: 1000000
meta:
  name: ${safeName}
  version: '1.0'
`;
}

// ───────────────────────────── training run + progress parsing ─────────────────────────────

const STEP_PATTERN = /\b(\d+)\/(\d+)\b/g;

function parseLastStepMatch(line: string): { current: number; total: number } | undefined {
  let match: RegExpExecArray | null;
  let last: { current: number; total: number } | undefined;
  STEP_PATTERN.lastIndex = 0;
  while ((match = STEP_PATTERN.exec(line))) {
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) last = { current, total };
  }
  return last;
}

async function runTraining(
  configPath: string,
  ctx: { isCanceled(): boolean; setProgress(frac: number, stage?: string): void },
): Promise<void> {
  const pythonBin = path.join(AI_TOOLKIT_DIR, 'venv', 'bin', 'python');
  const child = spawn(pythonBin, ['run.py', configPath], { cwd: AI_TOOLKIT_DIR });

  // Rolling buffer of the last 200 lines, for the failure message. RunnerContext has no way to
  // persist arbitrary data to job.params from inside a runner, so this buffer only lives for the
  // duration of the run; on failure we surface its tail in the thrown Error so it's at least
  // visible via job.error.
  const tail: string[] = [];
  const pushLine = (line: string) => {
    tail.push(line);
    if (tail.length > 200) tail.shift();
    const stepMatch = parseLastStepMatch(line);
    if (stepMatch) {
      ctx.setProgress(stepMatch.current / stepMatch.total, `Training step ${stepMatch.current}/${stepMatch.total}`);
    }
  };

  child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').forEach((l) => l && pushLine(l)));
  child.stderr?.on('data', (d: Buffer) => d.toString().split('\n').forEach((l) => l && pushLine(l)));

  const cancelCheck = setInterval(() => {
    if (ctx.isCanceled()) {
      child.kill();
    }
  }, 1000);

  const code: number | null = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  clearInterval(cancelCheck);

  if (ctx.isCanceled()) {
    throw new Error('canceled');
  }
  if (code !== 0) {
    throw new Error(`ai-toolkit training failed (exit ${code}):\n${tail.slice(-40).join('\n')}`);
  }
}

/** Find the newest *.safetensors file anywhere under the training output dir. */
function findNewestSafetensors(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  let newest: { file: string; mtimeMs: number } | undefined;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.safetensors')) {
        const stat = fs.statSync(full);
        if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs };
      }
    }
  };
  walk(dir);
  return newest?.file;
}

// ───────────────────────────── job runner ─────────────────────────────

registerRunner('lora_train', async (job, ctx) => {
  const params = readTrainParams(job.params as Record<string, unknown>);
  assertPromptsAllowed(params.description, params.triggerWord);

  ctx.setProgress(0, 'Preparing GPU');
  await ctx.comfy.free();

  if (ctx.isCanceled()) throw new Error('canceled');

  await ensureAiToolkitInstalled((stage) => ctx.setProgress(0, stage));

  if (ctx.isCanceled()) throw new Error('canceled');

  ctx.setProgress(0, 'Preparing training data');
  const { datasetDir, jobDir } = buildDataset(job.id, params);
  const configYaml = buildConfigYaml(params, jobDir, datasetDir);
  const configPath = path.join(jobDir, 'config.yaml');
  fs.writeFileSync(configPath, configYaml, 'utf8');

  if (ctx.isCanceled()) throw new Error('canceled');

  ctx.setProgress(0, 'Training');
  await runTraining(configPath, ctx);

  const outputDir = path.join(jobDir, 'output');
  const trainedFile = findNewestSafetensors(outputDir);
  if (!trainedFile) throw new Error('Training finished but no .safetensors output file was found');

  const loraDir = path.join(MODELS_DIR, 'loras');
  fs.mkdirSync(loraDir, { recursive: true });
  const destName = `${sanitizeName(params.name)}.safetensors`;
  fs.copyFileSync(trainedFile, path.join(loraDir, destName));

  const lora = loras.create({
    name: params.name,
    filename: destName,
    family: 'zimage',
    kind: params.kind,
    triggerWord: params.triggerWord,
    defaultStrength: params.kind === 'character' ? 0.8 : 1,
    source: 'trained',
    status: 'ready',
  });
  emit({ type: 'lora', lora });

  if (params.characterId) {
    const character = characters.update(params.characterId, { loraId: lora.id, triggerWord: params.triggerWord });
    if (character) emit({ type: 'character', character });
  } else if (params.locationId) {
    const location = locations.update(params.locationId, { loraId: lora.id, triggerWord: params.triggerWord });
    if (location) emit({ type: 'location', location });
  }
});

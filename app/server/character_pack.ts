// Character packs: one ZIP that carries a whole character between pods, so a LoRA never travels alone.
//
//   character.json     the record, plus the metadata of every bundled asset and the LoRA
//   assets/<id>.<ext>  reference images, the turnaround and face sheets, the voice clip
//   lora/<file>        the attached LoRA's .safetensors (when it has a file on this pod)
//
// Export builds the entry list for routes/downloads.ts (streamed like a project backup). Import saves the
// assets as new uploads, copies the LoRA into the LoRA folder, and creates the character with every id
// re-pointed, so a pack can be imported into any studio, more than once, without touching what is there.
import fs from 'node:fs';
import path from 'node:path';
import { assets as assetsRepo, characters as charactersRepo, loras as lorasRepo } from './db';
import { DATA_DIR, MODELS_DIR } from './config';
import { emit } from './events';
import { saveAsset } from './pipeline/media';
import { readZip } from './zip';
import { CHARACTER_COLORS } from '../shared/presets';
import type { Asset, Character, ID, Lora } from '../shared/types';

export const PACK_FORMAT = 'blockbuster-character/1';

export interface PackEntry {
  src?: string;
  content?: string;
  name: string;
}

interface PackAsset {
  id: ID;
  kind: Asset['kind'];
  file: string; // path inside the pack
  width: number;
  height: number;
  durationSec?: number;
  fps?: number;
  prompt?: string;
  engine?: Asset['engine'];
  params?: Record<string, unknown>;
}

interface PackManifest {
  format: string;
  exportedAt: string;
  character: Character;
  assets: PackAsset[];
  lora?: (Omit<Lora, 'id' | 'createdAt'> & { file?: string }) | null;
}

const diskPath = (a: Asset) => path.join(DATA_DIR, 'media', a.file);
const ext = (a: Asset) => path.extname(a.file) || (a.kind === 'video' ? '.mp4' : a.kind === 'audio' ? '.wav' : '.png');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'character';

/** Every asset id a character refers to, in a stable order (references first, primary first). */
export function characterAssetIds(c: Character): ID[] {
  const ids = [...c.referenceAssetIds, c.sheetAssets?.turnaround, c.sheetAssets?.face, c.voice?.refAssetId];
  return [...new Set(ids.filter((id): id is ID => Boolean(id)))];
}

export function characterPackEntries(characterId: ID): { filename: string; entries: PackEntry[] } | undefined {
  const character = charactersRepo.get(characterId);
  if (!character) return undefined;
  const entries: PackEntry[] = [];
  const packAssets: PackAsset[] = [];
  for (const id of characterAssetIds(character)) {
    const a = assetsRepo.get(id);
    if (!a || !fs.existsSync(diskPath(a))) continue;
    const file = `assets/${a.id}${ext(a)}`;
    entries.push({ src: diskPath(a), name: file });
    packAssets.push({ id: a.id, kind: a.kind, file, width: a.width, height: a.height, durationSec: a.durationSec, fps: a.fps, prompt: a.prompt, engine: a.engine, params: a.params });
  }
  let lora: PackManifest['lora'] = null;
  if (character.loraId) {
    const l = lorasRepo.get(character.loraId);
    if (l) {
      const { id: _id, createdAt: _createdAt, ...rest } = l;
      const onDisk = path.join(MODELS_DIR, 'loras', l.filename);
      const file = l.status === 'ready' && fs.existsSync(onDisk) ? `lora/${l.filename}` : undefined;
      if (file) entries.push({ src: onDisk, name: file });
      lora = { ...rest, file };
    }
  }
  const manifest: PackManifest = { format: PACK_FORMAT, exportedAt: new Date().toISOString(), character, assets: packAssets, lora };
  entries.unshift({ name: 'character.json', content: JSON.stringify(manifest, null, 2) });
  return { filename: `${slug(character.name)}-character.zip`, entries };
}

/** A LoRA file name that doesn't clash with one already in the folder (same name, different bytes). */
function freeLoraFilename(dir: string, wanted: string, bytes: Buffer): string {
  const safe = wanted.replace(/[^A-Za-z0-9._-]/g, '_');
  const base = safe.replace(/\.safetensors$/i, '');
  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? `${base}.safetensors` : `${base}-${n + 1}.safetensors`;
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return name;
    const existing = fs.readFileSync(full);
    if (existing.length === bytes.length && existing.equals(bytes)) return name; // same file already there
  }
  throw new Error(`Too many LoRA files named like ${safe}`);
}

/** Imports a character pack. Returns the new character (its LoRA, if any, is recorded and attached). */
export async function importCharacterPack(zipBytes: Buffer): Promise<Character> {
  const files = readZip(zipBytes);
  const byName = new Map(files.map((f) => [f.name, f.bytes]));
  const manifestBytes = byName.get('character.json');
  if (!manifestBytes) throw new Error('Not a character pack: no character.json inside');
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as PackManifest;
  } catch {
    throw new Error('Not a character pack: character.json is not valid JSON');
  }
  if (manifest.format !== PACK_FORMAT || !manifest.character?.name) throw new Error(`Not a character pack (format ${manifest.format ?? 'missing'})`);

  // Assets first, so every id in the record can be re-pointed.
  const idMap = new Map<ID, ID>();
  for (const pa of manifest.assets ?? []) {
    const bytes = byName.get(pa.file);
    if (!bytes) continue; // listed but missing: skip rather than fail the whole import
    const saved = await saveAsset({
      kind: pa.kind,
      origin: 'upload',
      ext: path.extname(pa.file).replace('.', '') || 'png',
      bytes,
      prompt: pa.prompt,
      engine: pa.engine,
      params: { ...(pa.params ?? {}), importedFrom: pa.id },
      fps: pa.fps,
    });
    idMap.set(pa.id, saved.id);
  }
  const mapId = (id: ID | undefined) => (id ? idMap.get(id) : undefined);

  let loraId: ID | undefined;
  if (manifest.lora?.file) {
    const bytes = byName.get(manifest.lora.file);
    if (bytes) {
      const dir = path.join(MODELS_DIR, 'loras');
      fs.mkdirSync(dir, { recursive: true });
      const filename = freeLoraFilename(dir, manifest.lora.filename || path.basename(manifest.lora.file), bytes);
      fs.writeFileSync(path.join(dir, filename), bytes);
      const lora = lorasRepo.create({
        name: manifest.lora.name || manifest.character.name,
        filename,
        family: manifest.lora.family ?? 'zimage',
        kind: manifest.lora.kind ?? 'character',
        triggerWord: manifest.lora.triggerWord,
        defaultStrength: manifest.lora.defaultStrength ?? 0.8,
        source: 'upload',
        sourceUrl: undefined,
        status: 'ready',
        sizeBytes: bytes.length,
      });
      emit({ type: 'lora', lora });
      loraId = lora.id;
    }
  }

  const src = manifest.character;
  const used = new Set(charactersRepo.list().map((c) => c.color));
  const color = CHARACTER_COLORS.find((c) => !used.has(c)) ?? src.color ?? CHARACTER_COLORS[0]!;
  const voiceRef = mapId(src.voice?.refAssetId);
  const character = charactersRepo.create({
    name: src.name,
    description: src.description ?? '',
    kind: src.kind,
    color,
    referenceAssetIds: src.referenceAssetIds.map(mapId).filter((id): id is ID => Boolean(id)),
    sheetAssets: {
      ...(mapId(src.sheetAssets?.turnaround) ? { turnaround: mapId(src.sheetAssets?.turnaround) } : {}),
      ...(mapId(src.sheetAssets?.face) ? { face: mapId(src.sheetAssets?.face) } : {}),
    },
    triggerWord: src.triggerWord,
    voiceHint: src.voiceHint,
    voice: src.voice && voiceRef ? { ...src.voice, refAssetId: voiceRef } : undefined,
    loraId,
  });
  emit({ type: 'character', character });
  return character;
}

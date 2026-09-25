#!/usr/bin/env node
// Create or update one public Runpod Pod template per install preset (runpod/presets.json), and
// write the deploy links into site/config.js for the website's preset picker.
//
// No dependencies (Node >= 22). Reads RUNPOD_API_KEY / RUNPOD_REF from the repo-root .env.
//
//   node runpod/deploy-template.mjs            # create missing presets, update existing ones
//   node runpod/deploy-template.mjs --dry-run  # print what would be sent
//
// Runpod API notes (verified 2026-09-24):
// - Deploy links carry only ?template=<id>&ref=<code>, so each preset needs its own template.
// - v1 (rest.runpod.io/v1) POST /templates supports `readme`, so creates go through v1 with isPublic.
// - v1 PATCH on a public template always fails ("public templates cannot have Registry Credentials";
//   v1 stores containerRegistryAuthId as ""), and v1 has no allowedCudaVersions. Updates therefore use
//   v2 (api.runpod.io/v2), which has allowedCudaVersions but no readme (the readme is create-time only).
// - allowedCudaVersions turns on the deploy page's compatibility filters and GPU preselection.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  for (const line of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  // no .env: rely on the environment
}

const V1 = 'https://rest.runpod.io/v1';
const V2 = 'https://api.runpod.io/v2';
const DRY_RUN = process.argv.includes('--dry-run');
const KEY = process.env.RUNPOD_API_KEY;
const REF = process.env.RUNPOD_REF || '';
const IMAGE = process.env.IMAGE || 'ghcr.io/kilo-loco/blockbuster-studio:latest';
const REPO_URL = process.env.REPO_URL || 'https://github.com/Kilo-Loco/blockbuster-studio';
const LOCK = path.join(__dirname, 'presets.lock.json');

const GROUP_ENV = {
  image: 'DOWNLOAD_IMAGE_MODELS',
  video: 'DOWNLOAD_VIDEO_MODELS',
  edit: 'DOWNLOAD_EDIT_MODELS',
  perform: 'DOWNLOAD_PERFORM_MODELS',
  t2v: 'DOWNLOAD_TEXT_TO_VIDEO_MODELS',
};

const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'template.json'), 'utf8'));
const { presets } = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8'));
const lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : {};

function envFor(preset) {
  const env = { STUDIO_PASSWORD: 'change-me' };
  for (const [group, name] of Object.entries(GROUP_ENV)) env[name] = String(preset.groups.includes(group));
  return env;
}

function readmeFor(preset) {
  return base.readme
    .replace(/^# .*$/m, `# ${preset.name}`)
    .replace('models (~139 GB) download', `models (~${preset.downloadGb} GB) download`)
    .concat(`\n\n## This preset: ${preset.title}\n\n${preset.tagline}\nModels: ${preset.groups.join(', ')} (~${preset.downloadGb} GB). Volume: ${preset.volumeInGb} GB.`);
}

async function call(apiBase, method, urlPath, body) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${method} ${apiBase}${urlPath}\n${JSON.stringify(body, null, 2)}`);
    return { id: '<new-id>' };
  }
  const res = await fetch(`${apiBase}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Runpod ${method} ${urlPath} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const deployUrl = (id) => `https://runpod.io/gsc?${new URLSearchParams({ template: id, ...(REF ? { ref: REF } : {}) })}`;

async function upsert(preset) {
  const env = envFor(preset);
  let id = lock[preset.id];
  if (!id) {
    const created = await call(V1, 'POST', '/templates', {
      name: preset.name,
      imageName: IMAGE,
      containerDiskInGb: base.containerDiskInGb,
      volumeInGb: preset.volumeInGb,
      volumeMountPath: base.volumeMountPath,
      ports: base.ports,
      env,
      readme: readmeFor(preset),
      isPublic: true,
      isServerless: false,
      category: base.category,
    });
    id = created.id;
    console.log(`[presets] created ${preset.id} -> ${id}`);
  }
  await call(V2, 'PATCH', `/templates/${id}`, {
    name: preset.name,
    image: IMAGE,
    disk: base.containerDiskInGb,
    env,
    ports: base.ports,
    args: '',
    mounts: { persistent: { path: base.volumeMountPath, size: preset.volumeInGb } },
    allowedCudaVersions: base.allowedCudaVersions ?? [],
    startJupyter: false,
    startSsh: true,
  });
  console.log(`[presets] ${preset.id.padEnd(10)} ${id}  ${deployUrl(id)}`);
  return id;
}

async function main() {
  if (!DRY_RUN && !KEY) throw new Error('RUNPOD_API_KEY is not set (add it to .env).');
  for (const preset of presets) lock[preset.id] = await upsert(preset);
  if (DRY_RUN) return;
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  const site = presets.map((p) => ({
    id: p.id,
    title: p.title,
    tagline: p.tagline,
    groups: p.groups,
    downloadGb: p.downloadGb,
    volumeInGb: p.volumeInGb,
    recommended: Boolean(p.recommended),
    deployUrl: deployUrl(lock[p.id]),
  }));
  const full = site.find((p) => p.recommended) ?? site[0];
  fs.writeFileSync(
    path.join(repoRoot, 'site', 'config.js'),
    `// Generated by runpod/deploy-template.mjs. Do not edit by hand; re-run the script instead.\nwindow.BLOCKBUSTER = ${JSON.stringify({ deployUrl: full.deployUrl, repoUrl: REPO_URL, presets: site }, null, 2)};\n`,
  );
  console.log('[presets] wrote site/config.js and runpod/presets.lock.json');
}

main().catch((err) => {
  console.error('[presets] FAILED:', err.message);
  process.exit(1);
});

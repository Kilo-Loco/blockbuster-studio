// GET /api/diagnostics and GET /api/diagnostics/logs: setup-milestone timings and a downloadable log bundle,
// for bug reports and for our own timed tests. Local only — nothing here is sent anywhere.
//
// The archive is built only from an explicit whitelist of paths under DATA_DIR, never by walking DATA_DIR
// itself, so studio.db, password.json, session-secret.txt, the agent token and stored settings (which may
// hold API keys) can never end up in it, even if something new is added there later.
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { Hono } from 'hono';
import { ZipArchive } from 'archiver';
import { DATA_DIR, MODELS_STATUS_FILE } from '../config';
import { diagnosticsSummary } from '../milestones';
import { getSystemInfo } from '../system';
import type { ComfyClient } from '../comfy/client';

interface ZipEntry {
  /** Absolute file on disk. */
  src?: string;
  /** Inline content (e.g. system.json, README.txt). */
  content?: string;
  /** Path inside the archive. */
  name: string;
}

const README = `This archive has no passwords, API keys or tokens. Safe to attach to a bug report.

Contents:
- milestones.json     setup-milestone timestamps (pod started, studio ready, first image, first video, ...)
- models-status.json  which model groups are installed / still downloading
- gpu-check.json      the pod's boot-time GPU self-check
- system.json         a snapshot of GET /api/system when this archive was made
- logs/               server, ComfyUI, voice sidecar and model-downloader logs
`;

/** Builds the archive's entries from known paths under dataDir only — see the file header. Exported so tests
 *  can point it at a temp directory and assert secrets planted alongside those known paths never appear. */
export function diagnosticsEntries(params: { dataDir: string; modelsStatusFile: string; systemInfo: unknown }): ZipEntry[] {
  const { dataDir, modelsStatusFile, systemInfo } = params;
  const entries: ZipEntry[] = [{ name: 'README.txt', content: README }];

  const milestonesFile = path.join(dataDir, 'milestones.json');
  if (fs.existsSync(milestonesFile)) entries.push({ src: milestonesFile, name: 'milestones.json' });
  if (fs.existsSync(modelsStatusFile)) entries.push({ src: modelsStatusFile, name: 'models-status.json' });
  const gpuCheckFile = path.join(dataDir, 'gpu-check.json');
  if (fs.existsSync(gpuCheckFile)) entries.push({ src: gpuCheckFile, name: 'gpu-check.json' });
  entries.push({ content: JSON.stringify(systemInfo, null, 2), name: 'system.json' });

  const logsDir = path.join(dataDir, 'logs');
  try {
    for (const f of fs.readdirSync(logsDir)) {
      if (f.endsWith('.log')) entries.push({ src: path.join(logsDir, f), name: `logs/${f}` });
    }
  } catch {
    // no logs dir yet (local dev, or a pod that hasn't written any)
  }
  return entries;
}

export function diagnosticsRoutes(comfy: ComfyClient) {
  const app = new Hono();

  app.get('/api/diagnostics', (c) => c.json(diagnosticsSummary()));

  app.get('/api/diagnostics/logs', async (c) => {
    const systemInfo = await getSystemInfo(comfy);
    const entries = diagnosticsEntries({ dataDir: DATA_DIR, modelsStatusFile: MODELS_STATUS_FILE, systemInfo });

    const archive = new ZipArchive({ store: true });
    const out = new PassThrough();
    archive.on('warning', (err: Error) => console.warn('[diagnostics zip]', err.message));
    archive.on('error', (err: Error) => out.destroy(err));
    archive.pipe(out);
    for (const e of entries) {
      if (e.content !== undefined) archive.append(e.content, { name: e.name });
      else if (e.src) archive.file(e.src, { name: e.name });
    }
    void archive.finalize();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="blockbuster-logs-${stamp}.zip"`);
    c.header('Cache-Control', 'no-store');
    return c.body(Readable.toWeb(out) as ReadableStream);
  });

  return app;
}

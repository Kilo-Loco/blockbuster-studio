// Hono app: wires auth, SSE, routes, static web build, the ComfyUI client and the job queue.
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { HOST, PORT, COMFY_URL, WEB_DIST, VERSION } from './config';
import { authMiddleware } from './auth';
import './auth'; // ensure PASSWORD is resolved/printed at startup even if unused elsewhere yet
import { authRoutes } from './routes/auth';
import { mediaRoutes } from './routes/media';
import { downloadRoutes } from './routes/downloads';
import { libraryRoutes } from './routes/library';
import { jobsRoutes } from './routes/jobs';
import { systemRoutes } from './routes/system';
import { projectsRoutes } from './routes/projects';
import { ComfyClient } from './comfy/client';
import * as queue from './pipeline/queue';
import './pipeline/index'; // registers all job runners (side effect)
import { getSystemInfo } from './system';
import { emit, clientCount } from './events';

export const comfy = new ComfyClient(COMFY_URL);
queue.init(comfy);
try {
  queue.recoverOnStartup();
} catch (err) {
  // A full volume (SQLITE_FULL) must not crash-loop the server: stay up so the UI can explain it.
  console.error('[startup] job recovery failed', err);
}

// Older assets predate image thumbnails; make them in the background (cheap, one-time).
void import('./pipeline/media').then(({ backfillImageThumbs }) =>
  backfillImageThumbs().then((n) => n && console.log(`[startup] generated ${n} image thumbnails`)),
);

// Keep serving on unexpected async errors instead of dying (the supervisor would only restart us into the same state).
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

export const app = new Hono();

app.use('*', authMiddleware);

app.route('/', authRoutes);
app.route('/', mediaRoutes);
app.route('/', downloadRoutes);
app.route('/', libraryRoutes);
app.route('/', jobsRoutes);
app.route('/', systemRoutes(comfy));
app.route('/', projectsRoutes(comfy));

// Static SPA (only if the web build exists — lets the server run standalone before `npm run build:web`).
if (fs.existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), WEB_DIST) || '.' }));
  app.get('*', async (c) => {
    const indexPath = path.join(WEB_DIST, 'index.html');
    if (!fs.existsSync(indexPath)) return c.notFound();
    return c.html(fs.readFileSync(indexPath, 'utf8'));
  });
}

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  const status = (err as Error & { status?: number }).status ?? 500;
  // eslint-disable-next-line no-console
  if (status >= 500) console.error(err);
  return c.json({ error: err.message || 'internal error' }, status as 400 | 401 | 404 | 500);
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Blockbuster Studio v${VERSION} listening on http://${HOST}:${info.port}`);
});

// Periodically broadcast system + model status while any client is connected (docs/API.md).
let lastModelsJson = '';
setInterval(() => {
  if (clientCount() === 0) return;
  void getSystemInfo(comfy).then((info) => {
    emit({ type: 'system', system: info });
    const modelsJson = JSON.stringify(info.models);
    if (modelsJson !== lastModelsJson) {
      lastModelsJson = modelsJson;
      emit({ type: 'models', models: info.models });
    }
  });
}, 5000);

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

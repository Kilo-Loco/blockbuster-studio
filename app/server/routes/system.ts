import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { VERSION } from '../config';
import { getSystemInfo } from '../system';
import { publicSettings, updateSettings } from '../settings';
import { subscribe } from '../events';
import type { ComfyClient } from '../comfy/client';
import type { SettingsUpdate } from '../../shared/types';

export function systemRoutes(comfy: ComfyClient) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/api/system', async (c) => {
    const info = await getSystemInfo(comfy);
    return c.json(info);
  });

  app.get('/api/settings', (c) => c.json(publicSettings()));

  app.put('/api/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as SettingsUpdate;
    const updated = updateSettings(body);
    return c.json(updated);
  });

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const unsubscribe = subscribe((event) => {
        if (closed) return;
        void stream.writeSSE({ data: JSON.stringify(event) });
      });
      // Send headers + a first event immediately (Runpod's proxy cuts off at 100s to first byte).
      await stream.writeSSE({ data: JSON.stringify({ type: 'ping', t: Date.now() }) });
      const ping = setInterval(() => {
        void stream.writeSSE({ data: JSON.stringify({ type: 'ping', t: Date.now() }) }).catch(() => undefined);
      }, 15_000);
      stream.onAbort(() => {
        closed = true;
        clearInterval(ping);
        unsubscribe();
      });
      // Keep the handler alive until the client disconnects.
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (closed) {
            clearInterval(check);
            resolve();
          }
        }, 1000);
      });
    });
  });

  return app;
}

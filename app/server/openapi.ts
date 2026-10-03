// GET /api/openapi.json: the routes an agent needs to make a film over plain REST (docs/API.md has
// every route). The storyboard body comes straight from its zod schema, so it can't drift.
import { z } from 'zod';
import { Hono } from 'hono';
import { VERSION } from './config';
import { MAX_WAIT_SEC } from './pipeline/wait';
import { StoryboardSchema } from './storyboard';
import { ASPECTS } from '../shared/presets';

const id = (name: string, where: 'path' | 'query' = 'path') => ({ name, in: where, required: where === 'path', schema: { type: 'string' } });
const json = (schema: object) => ({ 'application/json': { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (description: string, schema?: object, status = '200') => ({ [status]: { description, ...(schema ? { content: json(schema) } : {}) } });
const errors = { '401': { description: 'Missing or wrong token' }, '404': { description: 'Not found' } };
const waitParam = { name: 'wait', in: 'query', schema: { type: 'number', maximum: MAX_WAIT_SEC }, description: `Hold the request until finished or this many seconds pass (max ${MAX_WAIT_SEC}; Runpod's proxy cuts requests at 100 s)` };
const jobCreated = (many = false) => ok('Queued', many ? { type: 'array', items: ref('Job') } : ref('Job'), '202');

export function openApiDocument() {
  const storyboard = z.toJSONSchema(StoryboardSchema, { io: 'input', unrepresentable: 'any' });
  delete (storyboard as { $schema?: string }).$schema;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Blockbuster Studio',
      version: VERSION,
      description:
        'Make short films on this pod. Send `Authorization: Bearer <agent token>` (read it on the pod: `cat /workspace/studio/agent-token`). The same tools are available over MCP at /mcp.',
    },
    security: [{ agentToken: [] }],
    paths: {
      '/api/system': { get: { summary: 'GPU, installed models, video model', responses: { ...ok('SystemInfo', { type: 'object' }), ...errors } } },
      '/api/diagnostics': {
        get: {
          summary: 'Setup-milestone timings',
          description: 'How long this pod took to reach each setup milestone (studio ready, first image, first video, ...), in seconds from pod start.',
          responses: { ...ok('Diagnostics', { type: 'object', properties: { milestones: { type: 'object' }, durations: { type: 'object' } } }), ...errors },
        },
      },
      '/api/diagnostics/logs': {
        get: {
          summary: 'Download a .zip of server/ComfyUI/voice/downloader logs plus milestones and model status',
          description: 'Never includes studio.db, password.json, session secrets, the agent token or settings.',
          responses: { '200': { description: 'application/zip' }, ...errors },
        },
      },
      '/api/projects': {
        get: { summary: 'List projects', responses: ok('Projects', { type: 'array', items: { type: 'object' } }) },
        post: {
          summary: 'Create a project',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' }, logline: { type: 'string' }, aspect: { enum: ASPECTS }, mode: { enum: ['previs', 'script'], description: "'previs': the guided scene flow (a Blender previs drives camera/timing). 'script' (default): plan shots directly" } },
            }),
          },
          responses: ok('Project', { type: 'object' }),
        },
      },
      '/api/projects/{id}': {
        get: { summary: 'Scenes and shots with their status, frames and clips', parameters: [id('id')], responses: { ...ok('ProjectDetail', { type: 'object' }), ...errors } },
        patch: {
          summary: 'Change a project (export grade/upscale, mode)',
          parameters: [id('id')],
          requestBody: { content: json({ type: 'object', properties: { mode: { enum: ['previs', 'script'] }, grade: { enum: ['none', 'film'] }, upscale: { enum: ['none', '4k'] } } }) },
          responses: { ...ok('Project', { type: 'object' }), ...errors },
        },
      },
      '/api/projects/{id}/storyboard': {
        post: {
          summary: 'Append a whole storyboard in one request',
          description: 'Characters and locations are matched by name or created. With validate=1 nothing is written. An Idempotency-Key makes retries safe for 24 h.',
          parameters: [id('id'), { name: 'validate', in: 'query', schema: { enum: ['1'] } }, { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 200 } }],
          requestBody: { required: true, content: json(storyboard) },
          responses: {
            ...ok('Checked (validate=1)', ref('StoryboardCheck')),
            ...ok('Written', { allOf: [ref('StoryboardCheck'), { type: 'object', properties: { project: { type: 'object' } } }] }, '201'),
            '422': { description: 'Every problem found', content: json(ref('StoryboardCheck')) },
            ...errors,
          },
        },
      },
      '/api/projects/{id}/render': {
        post: {
          summary: 'Queue frames and/or clips for every shot (or one scene\'s)',
          description: "what: 'videos' also queues shots in a scene that's ready for a previs render (a previsAssetId + referenceSheetAssetId) even without a keyframe.",
          parameters: [id('id')],
          requestBody: { content: json({ type: 'object', properties: { what: { enum: ['keyframes', 'videos', 'all'] }, sceneId: { type: 'string', description: "Only this scene's shots" }, onlyMissing: { type: 'boolean' } } }) },
          responses: { ...jobCreated(true), ...errors },
        },
      },
      '/api/scenes/{id}': {
        patch: {
          summary: "Change a scene (previs/reference-sheet fields, castIds, blocking, location, …)",
          parameters: [id('id')],
          requestBody: {
            content: json({
              type: 'object',
              properties: {
                castIds: { type: 'array', items: { type: 'string' }, description: "The scene's cast (character/prop ids), in order of importance" },
                previsAssetId: { type: 'string' },
                previsDepthAssetId: { type: 'string' },
                previsCuts: { type: 'array', items: { type: 'number' }, description: "Cut times in seconds, one fewer than the shot count; recomputes shot durationSec" },
                referenceSheetAssetId: { type: 'string' },
                referenceSheetText: { type: 'string' },
              },
            }),
          },
          responses: { ...ok('Scene', { type: 'object' }), ...errors },
        },
      },
      '/api/scenes/{id}/previs/import': {
        post: {
          summary: "Import a Blender previs skill's sequences.json into a scene's shots",
          description:
            'Makes the scene\'s shots match the chosen sequence: keeps existing shots in order, creates any missing ones at the end (action from the file\'s beat/name; an existing empty action is filled the same way), then sets previsCuts from the file\'s cut points (recomputing every shot\'s durationSec).',
          parameters: [id('id')],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['sequences'],
              properties: {
                sequences: { type: 'object', description: "The parsed sequences.json object" },
                sequence: { type: 'integer', minimum: 0, description: 'Which sequence to import when the file has several (default: matches the previs asset filename, else 0)' },
              },
            }),
          },
          responses: {
            ...ok('The scene and its shots after import', { type: 'object', properties: { scene: { type: 'object' }, shots: { type: 'array', items: { type: 'object' } } } }),
            '409': { description: 'The scene already has more shots than the file' },
            ...errors,
          },
        },
      },
      '/api/shots/{id}': {
        patch: { summary: 'Change a shot', parameters: [id('id')], requestBody: { content: json({ type: 'object' }) }, responses: { ...ok('Shot', { type: 'object' }), ...errors } },
      },
      '/api/shots/{id}/preview': { get: { summary: 'Frame and motion prompts the studio will render', parameters: [id('id')], responses: { ...ok('Preview', { type: 'object' }), ...errors } } },
      '/api/shots/{id}/keyframe': { post: { summary: "Queue a new frame for one shot", parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
      '/api/shots/{id}/video': { post: { summary: 'Queue a clip for one shot (needs a frame)', parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
      '/api/characters': { get: { summary: 'Characters, with their voice (if any) and voiceHint (a suggested voice description)', responses: ok('Characters', { type: 'array', items: { type: 'object' } }) } },
      '/api/characters/{id}/voice': {
        post: {
          summary: "Design the character's voice from a description; their lines re-render when it finishes",
          parameters: [id('id')],
          requestBody: { required: true, content: json({ type: 'object', required: ['description'], properties: { description: { type: 'string' }, language: { type: 'string', default: 'English' } } }) },
          responses: { ...jobCreated(), '409': { description: 'Voice engine still downloading' }, ...errors },
        },
        put: {
          summary: 'Use an uploaded clip (audio asset from POST /api/uploads) as the voice; a transcript makes the clone closer',
          parameters: [id('id')],
          requestBody: { required: true, content: json({ type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' }, transcript: { type: 'string' }, language: { type: 'string' } } }) },
          responses: { ...ok('Character', { type: 'object' }), ...errors },
        },
        delete: { summary: 'Remove the voice', parameters: [id('id')], responses: { ...ok('Character', { type: 'object' }), ...errors } },
      },
      '/api/characters/{id}/voice/preview': {
        post: { summary: 'Say a test line in the voice; the job output is an audio asset', parameters: [id('id')], requestBody: { required: true, content: json({ type: 'object', required: ['text'], properties: { text: { type: 'string' } } }) }, responses: { ...jobCreated(), ...errors } },
      },
      '/api/shots/{id}/line': { post: { summary: "Render the shot's line in its speaker's voice", parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
      '/api/projects/{id}/voices': {
        post: {
          summary: 'Voices for speakers with a voice description, then every missing or stale line',
          parameters: [id('id')],
          responses: { ...ok('Queued', { type: 'object', properties: { jobIds: { type: 'array', items: { type: 'string' } }, needsVoice: { type: 'array', items: { type: 'string' }, description: 'Speakers with no voice and no description' } } }, '202'), ...errors },
        },
      },
      '/api/projects/{id}/export': { post: { summary: 'Join every clip into one film', parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
      '/api/jobs': {
        get: {
          summary: 'Jobs by id, optionally waiting until they all finish',
          parameters: [{ ...id('ids', 'query'), description: 'Comma-separated job ids' }, waitParam],
          responses: ok('Jobs', { type: 'array', items: ref('Job') }),
        },
      },
      '/api/jobs/{id}': { get: { summary: 'One job, optionally waiting until it finishes', parameters: [id('id'), waitParam], responses: { ...ok('Job', ref('Job')), ...errors } } },
      '/api/jobs/{id}/cancel': { post: { summary: 'Cancel a queued or running job', parameters: [id('id')], responses: { ...ok('Job', ref('Job')), ...errors } } },
      '/api/assets/{id}': { get: { summary: 'Asset metadata', parameters: [id('id')], responses: { ...ok('Asset', { type: 'object' }), ...errors } } },
      '/api/assets/{id}/frames': {
        get: {
          summary: 'A small JPEG to look at: a contact sheet of a clip, or a downscaled image',
          parameters: [id('id'), { name: 'n', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 12, default: 6 } }, { name: 'width', in: 'query', schema: { type: 'integer', minimum: 160, maximum: 640, default: 320 } }],
          responses: {
            '200': {
              description: 'JPEG. X-Frame-Times: seconds of each tile; X-Grid: columns x rows',
              content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
            },
            ...errors,
          },
        },
      },
      '/api/assets/{id}/link': {
        post: {
          summary: 'A download link that works without credentials for 15 minutes',
          parameters: [id('id')],
          responses: { ...ok('Link', { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string' }, expiresAt: { type: 'string' }, bytes: { type: 'integer' } } }), ...errors },
        },
      },
    },
    components: {
      securitySchemes: { agentToken: { type: 'http', scheme: 'bearer', description: 'The agent token from the pod (never in a query string)' } },
      schemas: {
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            status: { enum: ['queued', 'running', 'done', 'error', 'canceled'] },
            progress: { type: 'number' },
            stage: { type: 'string' },
            title: { type: 'string' },
            outputAssetIds: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
            shotId: { type: 'string' },
            actor: { enum: ['human', 'agent'] },
            statusUrl: { type: 'string', description: 'Where to wait for it (on create responses)' },
          },
        },
        StoryboardCheck: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            errors: { type: 'array', items: { type: 'string' } },
            warnings: { type: 'array', items: { type: 'string' } },
            previews: { type: 'array', items: { type: 'object' } },
            estimate: { type: 'object', properties: { references: { type: 'integer' }, frames: { type: 'integer' }, clips: { type: 'integer' }, minutes: { type: 'array', items: { type: 'number' } } } },
          },
        },
      },
    },
  };
}

export const openApiRoutes = new Hono();
const doc = openApiDocument();
openApiRoutes.get('/api/openapi.json', (c) => c.json(doc));

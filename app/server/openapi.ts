// GET /api/openapi.json: the routes an agent needs to make a film over plain REST (docs/API.md has
// every route). The storyboard body comes straight from its zod schema, so it can't drift.
import { z } from 'zod';
import { Hono } from 'hono';
import { VERSION } from './config';
import { MAX_WAIT_SEC } from './pipeline/wait';
import { StoryboardSchema } from './storyboard';

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
      '/api/projects': {
        get: { summary: 'List projects', responses: ok('Projects', { type: 'array', items: { type: 'object' } }) },
        post: {
          summary: 'Create a project',
          requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, logline: { type: 'string' }, aspect: { enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] } } }) },
          responses: ok('Project', { type: 'object' }),
        },
      },
      '/api/projects/{id}': { get: { summary: 'Scenes and shots with their status, frames and clips', parameters: [id('id')], responses: { ...ok('ProjectDetail', { type: 'object' }), ...errors } } },
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
          summary: 'Queue frames and/or clips for every shot',
          parameters: [id('id')],
          requestBody: { content: json({ type: 'object', properties: { what: { enum: ['keyframes', 'videos', 'all'] }, onlyMissing: { type: 'boolean' } } }) },
          responses: { ...jobCreated(true), ...errors },
        },
      },
      '/api/shots/{id}': {
        patch: { summary: 'Change a shot', parameters: [id('id')], requestBody: { content: json({ type: 'object' }) }, responses: { ...ok('Shot', { type: 'object' }), ...errors } },
      },
      '/api/shots/{id}/preview': { get: { summary: 'Frame and motion prompts the studio will render', parameters: [id('id')], responses: { ...ok('Preview', { type: 'object' }), ...errors } } },
      '/api/shots/{id}/keyframe': { post: { summary: "Queue a new frame for one shot", parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
      '/api/shots/{id}/video': { post: { summary: 'Queue a clip for one shot (needs a frame)', parameters: [id('id')], responses: { ...jobCreated(), ...errors } } },
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

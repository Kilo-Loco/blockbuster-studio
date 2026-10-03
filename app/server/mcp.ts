// MCP server at /mcp (Streamable HTTP, stateless, JSON responses) so an agent can drive the studio with
// the pod URL and the agent token alone. Tools are thin wrappers over the REST routes: each call is
// forwarded to the app with the caller's own credentials, so auth, actor tagging and validation stay
// in one place. docs/plans/2026-09-agent-access.md, phase 5.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CreateTaskRequestHandlerExtra, TaskRequestHandlerExtra } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { VERSION } from './config';
import { MAX_WAIT_SEC, isTerminal } from './pipeline/wait';
import { ShotSchema, StoryboardSchema, checkStoryboard, rememberNewProject, rememberedNewProject, storyboardEnvFrom } from './storyboard';
import { ASPECTS, durationsFor } from '../shared/presets';
import { getSystemInfo } from './system';
import type { ComfyClient } from './comfy/client';
import type { Asset, Job, ProjectDetail, SystemInfo } from '../shared/types';

/** Calls the studio's own routes (app.request) with the given headers. */
export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const INSTRUCTIONS = `Blockbuster Studio renders short films on this pod's GPU: storyboard frames (images), then clips (video), then an exported film.
Workflow: studio_status → create_storyboard with validate=true, fix any errors, then again without validate → generate_frames → wait_for_jobs until done → review_asset on each frame → update_shot / generate_frames again for any that are wrong → animate_shots → wait_for_jobs → review_asset on each clip → generate_voices (every line spoken in its character's voice) → wait_for_jobs → export_film → wait_for_jobs → get_download_link.
Voices: give each speaking character a voice description in create_storyboard (characters[].voice) or with set_voice; generate_voices designs those voices, then renders the lines. With several characters in a shot, set update_shot dialogueSpeakerId to say who speaks.
New characters: build_character makes a character from one chosen image (generate_character_looks renders candidates to pick from with review_asset, or use any uploaded photo): its sheets, a varied training set and a LoRA, in one job. Characters created by create_storyboard get plain reference images instead; build them when a character matters.
Previs-driven scenes (proven for identity + camera fidelity): once a scene has an uploaded Blender previs (set with update_scene previsAssetId, optionally previsDepthAssetId and previsCuts), call generate_character_sheets for its cast, then build_reference_sheet for the scene, then animate_shots as usual — shots in that scene render from the previs + sheet automatically (LTX-2.5), skipping the need for per-shot keyframes.
Renders take minutes. wait_for_jobs returns after at most ${MAX_WAIT_SEC} s; call it again while jobs are still running. Nothing here deletes work.`;

// Task-capable clients get MCP Tasks (experimental) for the long tools; the task finishes when the jobs do.
const taskStore = new InMemoryTaskStore();
const TASK_TTL_MS = 6 * 60 * 60 * 1000;

/** Set per /mcp request: whether the client asked for task execution (params.task on tools/call). */
const taskRequested = new AsyncLocalStorage<boolean>();

function wantsTask(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((m) => m && typeof m === 'object' && (m as { method?: string }).method === 'tools/call' && Boolean((m as { params?: { task?: unknown } }).params?.task));
}

// ───────────────────────────── helpers ─────────────────────────────

class ToolError extends Error {}

function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

function jobSummary(j: Job) {
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    progress: Math.round(j.progress * 100) / 100,
    stage: j.stage,
    error: j.error,
    outputAssetIds: j.outputAssetIds.length ? j.outputAssetIds : undefined,
    shotId: j.shotId,
  };
}

function waitReport(jobs: Job[]) {
  const pending = jobs.filter((j) => !isTerminal(j));
  const failed = jobs.filter((j) => j.status === 'error');
  return {
    allDone: pending.length === 0,
    pending: pending.length,
    failed: failed.length,
    next: pending.length ? `Still rendering. Call wait_for_jobs again with the same jobIds.` : failed.length ? 'Some jobs failed; see error. Retry by calling the same tool for those shots.' : 'All done.',
    jobs: jobs.map(jobSummary),
  };
}

function shotSummary(detail: ProjectDetail) {
  return {
    project: { id: detail.project.id, name: detail.project.name, aspect: detail.project.aspect, logline: detail.project.logline, exportAssetId: detail.project.exportAssetId, grade: detail.project.grade, upscale: detail.project.upscale, mode: detail.project.mode },
    scenes: detail.scenes.map((s) => ({
      id: s.id,
      scene: s.order + 1,
      title: s.title,
      castIds: s.castIds,
      previsAssetId: s.previsAssetId,
      previsDepthAssetId: s.previsDepthAssetId,
      previsCuts: s.previsCuts,
      referenceSheetAssetId: s.referenceSheetAssetId,
      shots: s.shots.map((sh) => ({
        id: sh.id,
        shot: sh.order + 1,
        action: sh.action,
        dialogue: sh.dialogue,
        dialogueSpeakerId: sh.dialogueSpeakerId,
        dialogueAudioAssetId: sh.dialogueAudioAssetId,
        shotSize: sh.shotSize,
        cameraMove: sh.cameraMove,
        durationSec: sh.durationSec,
        status: sh.status,
        error: sh.error,
        keyframeAssetId: sh.keyframeAssetId,
        endKeyframeAssetId: sh.endKeyframeAssetId,
        videoModel: sh.videoModel,
        quality: sh.quality,
        controlVideoAssetId: sh.controlVideoAssetId,
        referenceAssetIds: sh.referenceAssetIds,
        referenceVideoAssetId: sh.referenceVideoAssetId,
        controlStrength: sh.controlStrength,
        pinKeyframe: sh.pinKeyframe,
        videoAssetId: sh.videoAssetId,
        otherTakes: sh.keyframeCandidates.length + sh.videoCandidates.length || undefined,
      })),
    })),
  };
}

// ───────────────────────────── server ─────────────────────────────

function buildServer(comfy: ComfyClient, call: <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>) {
  /** A character by id or (case-insensitive) name, or a ToolError listing the ones that exist. */
  async function findCharacter(nameOrId: string): Promise<{ id: string; name: string; kind?: 'person' | 'prop' }> {
    const all = await call<{ id: string; name: string; kind?: 'person' | 'prop' }[]>('GET', '/api/characters');
    const match = all.find((c) => c.id === nameOrId) ?? all.find((c) => c.name.toLowerCase() === nameOrId.trim().toLowerCase());
    if (!match) throw new ToolError(`No character or prop "${nameOrId}". Characters: ${all.map((c) => c.name).join(', ') || 'none'}`);
    return match;
  }

  const server = new McpServer(
    { name: 'blockbuster-studio', version: VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tasks: { requests: { tools: { call: {} } }, list: {}, cancel: {} } }, taskStore },
  );

  // ── read-only ──

  server.registerTool(
    'studio_status',
    {
      title: 'Studio status',
      description: 'GPU, whether the render engine is up, which video model is installed and the clip lengths it accepts, model downloads still running, and how many jobs are queued. Call this first.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const info = await call<SystemInfo>('GET', '/api/system');
      const jobs = await call<Job[]>('GET', '/api/jobs?active=1');
      return text({
        ready: info.comfy.online && info.models.every((m) => !m.enabled || m.ready),
        gpu: info.comfy.gpuName,
        vramGB: info.comfy.vramTotalMB ? Math.round(info.comfy.vramTotalMB / 1024) : undefined,
        engineOnline: info.comfy.online,
        videoModel:
          info.videoModel === 'minimax_h3'
            ? 'MiniMax H3 (renders dialogue as speech)'
            : info.videoModel === 'ltx_2_5'
              ? 'LTX-2.5 (renders dialogue as speech)'
              : 'Wan 2.2 (silent)',
        videoModels: info.videoModels,
        voices: info.voice === 'ready' ? 'ready (Qwen3-TTS)' : info.voice,
        clipSeconds: durationsFor(info.videoModel, { quality: 'fast', vramTotalMB: info.comfy.vramTotalMB }),
        engines: info.engines,
        downloading: info.models.filter((m) => m.enabled && !m.ready).map((m) => ({ model: m.label, percent: m.totalBytes ? Math.round((100 * m.downloadedBytes) / m.totalBytes) : 0 })),
        gpuProblem: info.gpuCheck && !info.gpuCheck.ok ? info.gpuCheck.error ?? 'CUDA unavailable: terminate this pod and deploy again' : undefined,
        activeJobs: jobs.length,
      });
    },
  );

  server.registerTool(
    'get_diagnostics',
    {
      title: 'Setup-milestone diagnostics',
      description: 'How long this pod took to reach each setup milestone (studio ready, video model ready, first image, first video, ...), in seconds since pod start. Milestones not yet reached are missing/null. For downloadable logs, use the pod\'s own Settings page instead.',
      annotations: { readOnlyHint: true },
    },
    async () => text(await call('GET', '/api/diagnostics')),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Without projectId: lists projects. With projectId: every scene and shot with its status, frame (keyframeAssetId) and clip (videoAssetId), and the exported film (exportAssetId).',
      inputSchema: { projectId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      if (!projectId) {
        const projects = await call<{ id: string; name: string; logline: string; updatedAt: string }[]>('GET', '/api/projects');
        return text(projects.map(({ id, name, logline, updatedAt }) => ({ id, name, logline, updatedAt })));
      }
      return text(shotSummary(await call<ProjectDetail>('GET', `/api/projects/${encodeURIComponent(projectId)}`)));
    },
  );

  server.registerTool(
    'preview_shot',
    {
      title: 'Preview shot prompts',
      description: 'The frame and motion prompts the studio will render for a shot, which characters are visible, and whether the frame is composed from reference images (compose) or drawn from text (generate).',
      inputSchema: { shotId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ shotId }) => text(await call('GET', `/api/shots/${encodeURIComponent(shotId)}/preview`)),
  );

  server.registerTool(
    'review_asset',
    {
      title: 'Look at a frame or clip',
      description:
        'Returns a small JPEG to look at: for a clip, evenly spaced frames tiled into one contact sheet (left to right, top to bottom) with their times; for a frame, a downscaled copy. Use it to check every frame and clip before moving on.',
      inputSchema: {
        assetId: z.string().describe('keyframeAssetId, videoAssetId or exportAssetId from get_project'),
        frames: z.number().int().min(1).max(12).default(6).describe('Tiles in a clip contact sheet'),
        width: z.number().int().min(160).max(640).default(320).describe('Width of each tile in pixels'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ assetId, frames, width }) => {
      const asset = await call<Asset>('GET', `/api/assets/${encodeURIComponent(assetId)}`);
      const res = await callRaw('GET', `/api/assets/${encodeURIComponent(assetId)}/frames?n=${frames}&width=${width}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 900_000) throw new ToolError('That preview is too large to return; use fewer frames or a smaller width.');
      const times = res.headers.get('x-frame-times');
      const about =
        asset.kind === 'video'
          ? `Clip ${asset.durationSec ? `${asset.durationSec.toFixed(1)} s, ` : ''}${asset.width}×${asset.height}. ${res.headers.get('x-grid')} grid, tiles at ${times} s.${asset.prompt ? ` Prompt: ${asset.prompt}` : ''}`
          : `Image ${asset.width}×${asset.height}.${asset.prompt ? ` Prompt: ${asset.prompt}` : ''}`;
      return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: about }] };
    },
  );

  server.registerTool(
    'wait_for_jobs',
    {
      title: 'Wait for jobs',
      description: `Waits until the given jobs finish or ${MAX_WAIT_SEC} s pass, then reports each job's status, progress and outputs. Call again while allDone is false.`,
      inputSchema: {
        jobIds: z.array(z.string()).min(1).max(200),
        waitSec: z.number().min(0).max(MAX_WAIT_SEC).default(MAX_WAIT_SEC),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ jobIds, waitSec }) => text(waitReport(await call<Job[]>('GET', `/api/jobs?ids=${jobIds.map(encodeURIComponent).join(',')}&wait=${waitSec}`))),
  );

  server.registerTool(
    'get_download_link',
    {
      title: 'Download link',
      description: 'A link to the full file that works without credentials for 15 minutes (curl -L -o film.mp4 "<url>"). Use exportAssetId for the finished film.',
      inputSchema: { assetId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ assetId }) => text(await call('POST', `/api/assets/${encodeURIComponent(assetId)}/link`)),
  );

  // ── writes (nothing here deletes or changes settings) ──

  server.registerTool(
    'create_storyboard',
    {
      title: 'Create storyboard',
      description:
        'Adds scenes and shots to a project in one call, creating characters and locations by name (existing ones are matched by name). A character with kind "prop" (a vehicle or object) skips the face close-up and speaker assignment, and gets product-style turnaround panels on a scene reference sheet instead of a portrait. With validate=true nothing is written: you get every error at once, warnings, the exact frame and motion prompts per shot, and a render-time estimate. Use either projectId or newProject.',
      inputSchema: {
        projectId: z.string().optional(),
        newProject: z
          .object({
            name: z.string().min(1),
            aspect: z.enum(ASPECTS).default('16:9'),
            mode: z.enum(['previs', 'script']).optional().describe("'previs': the guided scene flow (a Blender previs drives camera/timing). 'script' (default): plan shots from this storyboard/script directly."),
          })
          .optional()
          .describe('Create a project for this storyboard (ignored with projectId)'),
        plan: StoryboardSchema,
        validate: z.boolean().default(false),
        idempotencyKey: z.string().max(200).optional().describe('Retrying with the same key returns the first result instead of adding the scenes twice'),
      },
    },
    async ({ projectId, newProject, plan, validate, idempotencyKey }) => {
      if (!projectId && !newProject) throw new ToolError('Pass projectId, or newProject to create one.');
      if (!projectId && validate) {
        // Nothing may be written while validating, so check against a project that doesn't exist yet.
        const info = await getSystemInfo(comfy);
        const t = new Date().toISOString();
        const draft = { id: 'new', name: newProject!.name, logline: '', aspect: newProject!.aspect, script: '', createdAt: t, updatedAt: t };
        const { plan: _p, resolved: _r, ...report } = checkStoryboard(draft, plan, storyboardEnvFrom(info));
        return text(report);
      }
      // A retry with the same key must not make a second project (the storyboard's own key is per project).
      let id = projectId ?? (idempotencyKey ? rememberedNewProject(idempotencyKey) : undefined);
      if (!id) {
        id = (await call<{ id: string }>('POST', '/api/projects', { name: newProject!.name, aspect: newProject!.aspect, mode: newProject!.mode, logline: plan.logline ?? '' })).id;
        if (idempotencyKey) rememberNewProject(idempotencyKey, id);
      }
      const res = await callRaw('POST', `/api/projects/${encodeURIComponent(id)}/storyboard${validate ? '?validate=1' : ''}`, plan, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
      const body = (await res.json()) as { ok?: boolean; project?: ProjectDetail; error?: string };
      if (res.status === 422) return { ...text(body), isError: true };
      if (!res.ok) throw new ToolError(body.error ?? `Request failed (${res.status})`);
      if (body.project) return text({ ...body, project: shotSummary(body.project) });
      return text(body);
    },
  );

  server.registerTool(
    'update_shot',
    {
      title: 'Update shot',
      description:
        'Change a shot after reviewing it (then call generate_frames or animate_shots for it again). The previous frame and clip are kept as other takes. Optional: endKeyframeAssetId (any image asset) makes the clip end on that frame; videoModel picks among the installed video models (studio_status); quality renders the clip in HD.',
      inputSchema: {
        shotId: z.string(),
        action: z.string().optional(),
        dialogue: z.string().optional(),
        dialogueSpeakerId: z.string().optional().describe("Character id of who says the line, when several are in the shot"),
        shotSize: ShotSchema.shape.shotSize.unwrap().optional(),
        cameraMove: ShotSchema.shape.cameraMove.unwrap().optional(),
        durationSec: z.number().int().optional(),
        keyframePrompt: z.string().optional().describe('Empty string returns to the auto-built prompt'),
        motionPrompt: z.string().optional().describe('Empty string returns to the auto-built prompt'),
        keyframeMode: z.enum(['auto', 'compose', 'generate']).optional(),
        seed: z.number().int().nonnegative().optional(),
        endKeyframeAssetId: z.string().optional().describe('Optional image asset the clip ends on (first/last-frame mode); empty string removes it'),
        videoModel: z.enum(['minimax_h3', 'ltx_2_5', 'wan', 'auto']).optional().describe("Video model for this shot; 'auto' returns to the default"),
        quality: z.enum(['fast', 'hd']).optional().describe("Clip size: 'fast' (≈480p, default) or 'hd' (720p, several times slower)"),
        controlVideoAssetId: z
          .string()
          .optional()
          .describe(
            "Optional video asset whose motion the clip follows; the keyframe becomes the reference image. Alone: Wan 2.2 Fun-Control (studio_status engines.wan_control). Together with referenceAssetIds: Wan 2.2 VACE-Fun instead (engines.wan_vace; the sheets carry identity, not the keyframe). With videoModel 'ltx_2_5': LTX-2.5's IC-LoRA union control instead (engines.ltx_ic). Empty string removes it",
          ),
        controlPreprocess: z.enum(['canny', 'none']).optional().describe("How the control video is read: 'canny' (default) extracts edges first, for RGB footage or gray blockouts; 'none' for depth or edge renders"),
        referenceAssetIds: z
          .array(z.string())
          .max(9)
          .optional()
          .describe(
            'Optional reference images (character sheets, vehicle sheets, location plates) the clip keeps identity from. Alone (or with referenceVideoAssetId): MiniMax H3 Ref2VA, up to 9 (studio_status engines.h3_ref). Together with controlVideoAssetId: Wan 2.2 VACE-Fun instead, up to 4, composited into one reference image (engines.wan_vace). An empty array removes them',
          ),
        referenceVideoAssetId: z.string().optional().describe('Optional reference video (a previs cut) for camera moves and timing; empty string removes it'),
        controlStrength: z
          .number()
          .min(0)
          .max(1.5)
          .optional()
          .describe("LTX-2.5 IC-LoRA control strength for this shot's scene-previs render (0-1.5, default 0.7 — Lightricks: 1.0 full adherence, 0.5-0.8 softer)"),
        pinKeyframe: z.boolean().optional().describe("When true and the shot has a keyframeAssetId, its scene-previs render also pins that frame as a keyframe guide at time 0"),
      },
    },
    async ({ shotId, ...patch }) => {
      const body: Record<string, unknown> = { ...patch };
      for (const k of ['keyframePrompt', 'motionPrompt', 'endKeyframeAssetId', 'controlVideoAssetId', 'referenceVideoAssetId'] as const) if (body[k] === '') body[k] = null;
      if (Array.isArray(body.referenceAssetIds) && body.referenceAssetIds.length === 0) body.referenceAssetIds = null;
      if (body.videoModel === 'auto') body.videoModel = null;
      return text(await call('PATCH', `/api/shots/${encodeURIComponent(shotId)}`, body));
    },
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description:
        "Sets a project's mode and export options. mode: 'previs' (the guided scene flow — a Blender previs drives camera/timing) or 'script' (plan shots directly; default). grade: 'none' (default) or 'film' (a gentle warm, cinematic color grade). upscale: 'none' (default) or '4k' (upscales the finished film with SeedVR2 at export time; slow, about 5 minutes of GPU time per second of film, so only turn it on for the final export — needs the 4K upscaler models, studio_status engines.upscale_4k).",
      inputSchema: {
        projectId: z.string(),
        mode: z.enum(['previs', 'script']).optional(),
        grade: z.enum(['none', 'film']).optional(),
        upscale: z.enum(['none', '4k']).optional(),
      },
    },
    async ({ projectId, ...patch }) => text(await call('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, patch)),
  );

  server.registerTool(
    'choose_take',
    {
      title: 'Choose take',
      description: "Make an earlier frame or clip the shot's current one (get_project shows how many other takes a shot has; their asset ids are in the asset list for the shot).",
      inputSchema: { shotId: z.string(), keyframeAssetId: z.string().optional(), videoAssetId: z.string().optional() },
    },
    async ({ shotId, keyframeAssetId, videoAssetId }) => text(await call('POST', `/api/shots/${encodeURIComponent(shotId)}/select`, { keyframeAssetId, videoAssetId })),
  );

  server.registerTool(
    'update_scene',
    {
      title: 'Update scene previs / reference sheet',
      description:
        "Sets a scene's cast, Blender previs (previsAssetId, an uploaded video) and reference sheet fields. Once a scene has both a previsAssetId and a referenceSheetAssetId (build_reference_sheet), animate_shots renders its shots from the previs + sheet automatically (LTX-2.5), instead of from per-shot keyframes. previsCuts (one fewer entry than the scene's shot count, in seconds) marks where each shot after the first begins in the previs, and updates every shot's durationSec to match.",
      inputSchema: {
        sceneId: z.string(),
        castIds: z
          .array(z.string())
          .optional()
          .describe('The scene\'s cast (character/prop ids), in order of importance. build_reference_sheet and any shot with no characters of its own use this when set; empty array clears it (falls back to the union of the scene\'s shots\' characters)'),
        previsAssetId: z.string().optional().describe('Video asset: the scene\'s playblast; empty string removes it'),
        previsDepthAssetId: z.string().optional().describe("Optional depth-pass video (near = bright), preferred over previsAssetId as the LTX control video when set; empty string removes it"),
        previsCuts: z.array(z.number().nonnegative()).optional().describe('Cut times in seconds, one fewer than the shot count; recomputes shot durationSec'),
        referenceSheetAssetId: z.string().optional().describe('Image asset: the composited Ingredients sheet (usually set by build_reference_sheet); empty string removes it'),
        referenceSheetText: z.string().optional().describe('The sheet\'s "Reference sheet: …" panel description (auto-written by build_reference_sheet; override freely)'),
      },
    },
    async ({ sceneId, ...patch }) => {
      const body: Record<string, unknown> = { ...patch };
      for (const k of ['previsAssetId', 'previsDepthAssetId', 'referenceSheetAssetId'] as const) if (body[k] === '') body[k] = null;
      return text(await call('PATCH', `/api/scenes/${encodeURIComponent(sceneId)}`, body));
    },
  );

  server.registerTool(
    'import_previs_sequences',
    {
      title: 'Import previs sequences.json',
      description:
        "Reads a Blender previs skill's sequences.json and makes the scene's shots match it: keeps existing shots in order, creates any missing ones at the end (action from the file's beat/name; an existing shot's empty action is filled the same way), then sets the scene's previsCuts from the file's cut points (recomputing every shot's durationSec). 409 if the scene already has more shots than the file. Run this before build_reference_sheet / animate_shots.",
      inputSchema: {
        sceneId: z.string(),
        sequences: z.record(z.string(), z.unknown()).describe("The parsed sequences.json object ({ sequences: [{ shots: [{ start_s, end_s, name, beat }] }] }, or the older flat { shots: [...] })"),
        sequence: z.number().int().nonnegative().optional().describe('Which sequence to import when the file has several (default: the one matching the scene\'s previs asset filename, else 0)'),
      },
    },
    async ({ sceneId, sequences, sequence }) => text(await call('POST', `/api/scenes/${encodeURIComponent(sceneId)}/previs/import`, { sequences, sequence })),
  );

  server.registerTool(
    'build_reference_sheet',
    {
      title: 'Build scene reference sheet',
      description:
        'Composites the scene\'s cast (characters and props appearing in any of its shots) and location into one Ingredients reference sheet image, and writes its "Reference sheet: …" prompt text. Run generate_character_sheets for the cast first for the best result; characters without one fall back to their existing reference image. Returns a job.',
      inputSchema: { sceneId: z.string() },
    },
    async ({ sceneId }) => text(jobSummary(await call<Job>('POST', `/api/scenes/${encodeURIComponent(sceneId)}/reference-sheet`))),
  );

  server.registerTool(
    'generate_character_sheets',
    {
      title: 'Generate character sheets',
      description:
        'Renders sheet-ready references for characters or props (a four-view turnaround, plus a face close-up for people) on a plain grey backdrop, for build_reference_sheet to composite. Returns one job per image.',
      inputSchema: { characters: z.array(z.string()).min(1).describe('Character or prop names or ids') },
    },
    async ({ characters }) => {
      const all = await call<{ id: string; name: string; kind?: 'person' | 'prop' }[]>('GET', '/api/characters');
      const jobs: Job[] = [];
      for (const name of characters) {
        const match = all.find((c) => c.id === name) ?? all.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
        if (!match) throw new ToolError(`No character or prop "${name}". Characters: ${all.map((c) => c.name).join(', ') || 'none'}`);
        jobs.push(await call<Job>('POST', `/api/characters/${encodeURIComponent(match.id)}/turnaround`));
        if ((match.kind ?? 'person') !== 'prop') jobs.push(await call<Job>('POST', `/api/characters/${encodeURIComponent(match.id)}/face`));
      }
      return text({ started: jobs.length, jobIds: jobs.map((j) => j.id), next: 'Call wait_for_jobs with these jobIds.', jobs: jobs.map(jobSummary) });
    },
  );

  server.registerTool(
    'generate_character_looks',
    {
      title: 'Generate character looks',
      description:
        'Renders candidate full-body "looks" of a character from its description (Z-Image, plain grey backdrop) for the character builder. They are not attached to the character: review them with review_asset, then pass the best one to build_character as lookAssetId. Returns a job.',
      inputSchema: {
        character: z.string().describe('Character or prop name or id'),
        count: z.number().int().min(1).max(8).optional().describe('How many candidates (default 4)'),
      },
    },
    async ({ character, count }) => {
      const match = await findCharacter(character);
      const job = await call<Job>('POST', `/api/characters/${encodeURIComponent(match.id)}/references`, { count: count ?? 4, attach: false });
      return text({ ...jobSummary(job), next: 'Call wait_for_jobs, then review_asset on each outputAssetId and pick one for build_character.' });
    },
  );

  server.registerTool(
    'build_character',
    {
      title: 'Build a character',
      description:
        'The character builder: from one chosen image of the character (a look from generate_character_looks, or any uploaded photo asset), renders its sheet-ready turnaround and face close-up, a varied identity-preserving training set (other angles, expressions and settings), then trains a Z-Image LoRA and attaches it, so the character stays the same in every shot. One job; images take ~10 min, training 30-60 min on an RTX 4090. Returns a job.',
      inputSchema: {
        character: z.string().describe('Character or prop name or id'),
        lookAssetId: z.string().describe('The image asset the character is built from'),
        train: z.boolean().optional().describe('Train the LoRA at the end (default true). false: sheets and training set only'),
        triggerWord: z.string().optional().describe("LoRA trigger word (default: the character's, else ohwx_<name>)"),
      },
    },
    async ({ character, lookAssetId, train, triggerWord }) => {
      const match = await findCharacter(character);
      const job = await call<Job>('POST', `/api/characters/${encodeURIComponent(match.id)}/build`, { lookAssetId, train, triggerWord });
      return text({ ...jobSummary(job), next: 'Call wait_for_jobs with this jobId; the character then has sheets, references and (if trained) a LoRA.' });
    },
  );

  server.registerTool(
    'set_voice',
    {
      title: 'Set a character voice',
      description: 'Designs the voice every line of this character is spoken in, from a description (gender, age, timbre, pace, accent). Returns a job; their existing lines are re-rendered when it finishes.',
      inputSchema: {
        character: z.string().describe('Character name or id'),
        description: z.string().describe('e.g. "gravelly, tired man in his 60s, slow Southern drawl"'),
        language: z.string().optional().describe('English (default), Chinese, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian'),
      },
    },
    async ({ character, description, language }) => {
      const all = await call<{ id: string; name: string }[]>('GET', '/api/characters');
      const match = all.find((c) => c.id === character) ?? all.find((c) => c.name.toLowerCase() === character.trim().toLowerCase());
      if (!match) throw new ToolError(`No character "${character}". Characters: ${all.map((c) => c.name).join(', ') || 'none'}`);
      return text(jobSummary(await call<Job>('POST', `/api/characters/${encodeURIComponent(match.id)}/voice`, { description, language })));
    },
  );

  server.registerTool(
    'cancel_job',
    { title: 'Cancel job', description: 'Stop a queued or running job.', inputSchema: { jobId: z.string() } },
    async ({ jobId }) => text(jobSummary(await call<Job>('POST', `/api/jobs/${encodeURIComponent(jobId)}/cancel`))),
  );

  // ── long-running: start jobs; Task-capable clients may instead wait on an MCP task ──

  const renderSchema = {
    projectId: z.string(),
    sceneId: z.string().optional().describe('Only this scene\'s shots (ignored with shotIds)'),
    shotIds: z.array(z.string()).optional().describe('Only these shots (default: every shot in the project, or in sceneId)'),
    onlyMissing: z.boolean().default(true).describe('Skip shots that already have one (ignored with shotIds)'),
  };

  const longTool = (
    name: string,
    config: { title: string; description: string; inputSchema: Record<string, z.ZodType> },
    start: (args: Record<string, unknown>) => Promise<Job[]>,
  ) => {
    server.experimental.tasks.registerToolTask(
      name,
      { ...config, execution: { taskSupport: 'optional' } },
      {
        createTask: async (args: Record<string, unknown>, extra: CreateTaskRequestHandlerExtra) => {
          const jobs = await start(args);
          const ids = jobs.map((j) => j.id);
          const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl ?? TASK_TTL_MS, pollInterval: 5000 });
          if (!taskRequested.getStore()) {
            // A client without Tasks: answer at once with the job ids (the SDK would otherwise hold this
            // request until the jobs finish, past Runpod's 100 s proxy limit).
            const started = text({ started: jobs.length, jobIds: ids, next: ids.length ? 'Call wait_for_jobs with these jobIds.' : 'Nothing to render.', jobs: jobs.map(jobSummary) });
            await taskStore.storeTaskResult(task.taskId, 'completed', started);
            return { task: { ...task, status: 'completed' as const } };
          }
          // The task finishes when every job has; a client that cancels the task stops the watcher.
          const taskId = task.taskId;
          void (async () => {
            let current = jobs;
            while (current.length && !current.every(isTerminal)) {
              current = await call<Job[]>('GET', `/api/jobs?ids=${ids.join(',')}&wait=${MAX_WAIT_SEC}`).catch(() => current);
              const latest = await taskStore.getTask(taskId).catch(() => null);
              if (!latest || latest.status === 'cancelled') return;
            }
            await taskStore.storeTaskResult(taskId, 'completed', text(waitReport(current))).catch(() => undefined);
          })();
          return { task };
        },
        getTask: async (_args: unknown, extra: TaskRequestHandlerExtra) => extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (_args: unknown, extra: TaskRequestHandlerExtra) => (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult,
      },
    );
  };

  const renderStart = (what: 'keyframes' | 'videos') => async (args: Record<string, unknown>) => {
    const { projectId, sceneId, shotIds, onlyMissing } = args as { projectId: string; sceneId?: string; shotIds?: string[]; onlyMissing: boolean };
    if (!shotIds?.length) return call<Job[]>('POST', `/api/projects/${encodeURIComponent(projectId)}/render`, { what, sceneId, onlyMissing });
    const jobs: Job[] = [];
    for (const id of shotIds) jobs.push(await call<Job>('POST', `/api/shots/${encodeURIComponent(id)}/${what === 'keyframes' ? 'keyframe' : 'video'}`));
    return jobs;
  };

  longTool(
    'generate_frames',
    {
      title: 'Generate storyboard frames',
      description: "Queues a still frame for each shot (plus character and location reference images the first time, for consistent faces and places). A new frame replaces the shot's current one, which is kept as another take.",
      inputSchema: renderSchema,
    },
    renderStart('keyframes'),
  );

  longTool(
    'animate_shots',
    {
      title: 'Animate shots',
      description: "Queues a clip for each shot that has a frame, animated from that frame. Review each frame first: the clip can't fix a wrong frame.",
      inputSchema: renderSchema,
    },
    renderStart('videos'),
  );

  longTool(
    'generate_voices',
    {
      title: 'Generate voices and lines',
      description:
        "Designs a voice for each speaking character that has a voice description but no voice yet, then renders every line in its speaker's voice (lines follow a new voice automatically). Export mixes the lines into silent clips.",
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) => {
      const res = await call<{ jobIds: string[]; needsVoice: string[] }>('POST', `/api/projects/${encodeURIComponent(String(projectId))}/voices`);
      if (!res.jobIds.length && res.needsVoice.length) throw new ToolError(`No voice description for: ${res.needsVoice.join(', ')}. Call set_voice for them first.`);
      return res.jobIds.length ? call<Job[]>('GET', `/api/jobs?ids=${res.jobIds.join(',')}`) : [];
    },
  );

  longTool(
    'export_film',
    {
      title: 'Export film',
      description: "Joins every shot's clip, in order, into one video. When done, the project's exportAssetId (get_project) is the film; use get_download_link for it.",
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) => [await call<Job>('POST', `/api/projects/${encodeURIComponent(String(projectId))}/export`)],
  );

  async function callRaw(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
    return callFetch(method, path, body, headers);
  }
  let callFetch: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  return {
    server,
    setRaw(fn: typeof callFetch) {
      callFetch = fn;
    },
  };
}

// ───────────────────────────── route ─────────────────────────────

/** Origins allowed to call /mcp: none (agents, curl) or the studio's own page. Stops DNS rebinding. */
export function originAllowed(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const own = [c.req.header('x-forwarded-host'), c.req.header('host')].filter(Boolean);
  return own.includes(host);
}

export function mcpRoutes(comfy: ComfyClient, fetcher: Fetcher) {
  const app = new Hono();

  app.all('/mcp', async (c) => {
    if (!originAllowed(c)) return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' }, id: null }, 403);
    if (c.req.method !== 'POST') {
      // Stateless server: no standalone SSE stream or sessions to delete.
      return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, 405, { Allow: 'POST' });
    }
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400);

    // Forward the caller's own credentials to the internal routes (never anything else).
    const auth: Record<string, string> = {};
    for (const h of ['authorization', 'cookie', 'cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-proto', 'host']) {
      const v = c.req.header(h);
      if (v) auth[h] = v;
    }
    const raw = (method: string, path: string, reqBody?: unknown, headers?: Record<string, string>) =>
      fetcher(path, {
        method,
        headers: { ...auth, ...(reqBody !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: reqBody !== undefined ? JSON.stringify(reqBody) : undefined,
      });
    const call = async <T,>(method: string, path: string, reqBody?: unknown, headers?: Record<string, string>): Promise<T> => {
      const res = await raw(method, path, reqBody, headers);
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new ToolError(json.error ?? `Request failed (${res.status})`);
      return json;
    };

    const { server, setRaw } = buildServer(comfy, call);
    setRaw(raw);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await taskRequested.run(wantsTask(body), () => transport.handleRequest(c.req.raw, { parsedBody: body }));
    } finally {
      // JSON responses are complete once handleRequest resolves; background task watchers use the shared store.
      void server.close().catch(() => undefined);
    }
  });

  return app;
}

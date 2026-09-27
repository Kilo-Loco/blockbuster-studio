// One-request storyboards for agents (docs/plans/2026-09-agent-access.md, phase 3).
// The plan is the AI breakdown's draft (characters, locations, scenes, shots by name) plus everything
// the shot panel can set. Unlike the breakdown, which coerces whatever the LLM returns, this is strict:
// an agent gets every problem back at once and can fix its plan before anything is written.
import { z } from 'zod';
import * as db from './db';
import { buildShotPlan } from './pipeline/prompts';
import { CAMERA_MOVES, CHARACTER_COLORS, KEYFRAME_MINUTES, REFERENCE_MINUTES, SHOT_SIZES, TIMES_OF_DAY, clipMinutes, durationsFor } from '../shared/presets';
import { aimCamera, blockingArc, completeBlocking, defaultLocationMap, placeCamera } from '../shared/camera';
import type {
  CameraMoveId,
  Character,
  CharacterMark,
  ID,
  Location,
  LocationMap,
  MapCamera,
  Project,
  ProjectDetail,
  Scene,
  Shot,
  ShotSize,
  TimeOfDay,
  VideoModelId,
} from '../shared/types';

const SHOT_SIZE_IDS = SHOT_SIZES.map((s) => s.id) as [ShotSize, ...ShotSize[]];
const CAMERA_MOVE_IDS = CAMERA_MOVES.map((m) => m.id) as [CameraMoveId, ...CameraMoveId[]];
const TIME_OF_DAY_IDS = TIMES_OF_DAY as [TimeOfDay, ...TimeOfDay[]];
const CAMERA_SIDES = ['front', 'front-left', 'front-right', 'left', 'right', 'back', 'overhead'] as const;

const MarkSchema = z
  .object({
    character: z.string().min(1).describe('Character name'),
    x: z.number().describe('Metres from the left edge of the location map (default map is 12 × 8 m)'),
    y: z.number().describe('Metres from the top edge of the location map'),
    facingDeg: z.number().default(180).describe('0 = up/north on the map, clockwise; 180 faces the default camera'),
  })
  .strict();

const CameraSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    targetX: z.number().optional(),
    targetY: z.number().optional(),
    heightM: z.number().min(0.1).max(20).default(1.6),
  })
  .strict()
  .describe('Exact camera placement on the location map; omit to let the studio aim at the cast');

export const ShotSchema = z
  .object({
    action: z.string().min(1).describe('What happens, in one or two present-tense sentences'),
    dialogue: z.string().optional().describe('Spoken line; MiniMax H3 renders it as speech'),
    shotSize: z.enum(SHOT_SIZE_IDS).default('MS'),
    cameraMove: z.enum(CAMERA_MOVE_IDS).default('static'),
    characterNames: z.array(z.string()).default([]).describe('Characters in frame'),
    durationSec: z.number().optional().describe('Clip length; must fit the installed video model (see studio status)'),
    cameraSide: z.enum(CAMERA_SIDES).optional().describe('Where around the action the camera stands'),
    keyframeMode: z.enum(['auto', 'compose', 'generate']).default('auto'),
    keyframePrompt: z.string().optional().describe('Replaces the auto-built frame prompt'),
    motionPrompt: z.string().optional().describe('Replaces the auto-built motion prompt'),
    seed: z.number().int().nonnegative().optional(),
    blocking: z.array(MarkSchema).optional().describe("This shot's marks, overriding the scene's"),
    camera: CameraSchema.optional(),
  })
  .strict();

const SceneSchema = z
  .object({
    title: z.string().min(1).describe('Slugline, e.g. "INT. RAMEN BAR - NIGHT"'),
    description: z.string().default(''),
    locationName: z.string().optional(),
    timeOfDay: z.enum(TIME_OF_DAY_IDS).default('day'),
    blocking: z.array(MarkSchema).optional().describe('Where each character stands for the scene'),
    shots: z.array(ShotSchema).min(1),
  })
  .strict();

const NamedSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default('').describe('Looks, wardrobe, age: what the image model should draw'),
    existingId: z.string().optional(),
  })
  .strict();

export const StoryboardSchema = z
  .object({
    logline: z.string().optional(),
    characters: z.array(NamedSchema).default([]).describe('New characters, or existing ones by name'),
    locations: z.array(NamedSchema).default([]),
    scenes: z.array(SceneSchema).min(1),
  })
  .strict();

export type StoryboardPlan = z.infer<typeof StoryboardSchema>;

export interface StoryboardEnv {
  videoModel: VideoModelId | null;
  vramTotalMB?: number;
  editEngineAvailable: boolean;
}

export interface ShotPreview {
  scene: number;
  shot: number;
  mode: 'compose' | 'generate';
  visibleCharacters: string[];
  keyframePrompt: string;
  motionPrompt: string;
  durationSec: number;
}

export interface Estimate {
  references: number;
  frames: number;
  clips: number;
  /** Rough [low, high] minutes to render every frame and clip. */
  minutes: [number, number];
}

export interface StoryboardCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  previews: ShotPreview[];
  estimate: Estimate;
}

// ───────────────────────────── resolve (no writes) ─────────────────────────────

interface Resolved {
  characters: Map<string, Character>; // lower-case name → existing or to-be-created (id starts with "new:")
  locations: Map<string, Location>;
  scenes: { scene: Scene; shots: Shot[] }[];
}

const lower = (s: string) => s.trim().toLowerCase();

function draftCharacter(name: string, description: string, index: number): Character {
  const t = new Date(0).toISOString();
  return { id: `new:${name}`, name, description, referenceAssetIds: [], color: CHARACTER_COLORS[index % CHARACTER_COLORS.length], createdAt: t, updatedAt: t } as Character;
}

function draftLocation(name: string, description: string): Location {
  const t = new Date(0).toISOString();
  return { id: `new:${name}`, name, description, map: defaultLocationMap(), angleViews: [], createdAt: t, updatedAt: t } as Location;
}

function inBounds(map: LocationMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x <= map.widthM && y <= map.heightM;
}

function formatZodError(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join('.') : 'plan'}: ${i.message}`);
}

/** Resolve names, check every field, and build the storyboard in memory. Nothing is written. */
function resolve(project: Project, plan: StoryboardPlan, env: StoryboardEnv) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const existingChars = db.characters.list();
  const characters = new Map<string, Character>();
  for (const c of existingChars) characters.set(lower(c.name), c);
  let newCount = 0;
  for (const [i, c] of plan.characters.entries()) {
    const byId = c.existingId ? existingChars.find((e) => e.id === c.existingId) : undefined;
    if (c.existingId && !byId) errors.push(`characters.${i}.existingId: no character with id ${c.existingId}`);
    const match = byId ?? characters.get(lower(c.name));
    if (match) characters.set(lower(c.name), match);
    else {
      if (!c.description.trim()) warnings.push(`characters.${i}: "${c.name}" is new and has no description; frames will guess what they look like`);
      characters.set(lower(c.name), draftCharacter(c.name.trim(), c.description, newCount++));
    }
  }

  const existingLocs = db.locations.list();
  const locations = new Map<string, Location>();
  for (const l of existingLocs) locations.set(lower(l.name), l);
  for (const [i, l] of plan.locations.entries()) {
    const byId = l.existingId ? existingLocs.find((e) => e.id === l.existingId) : undefined;
    if (l.existingId && !byId) errors.push(`locations.${i}.existingId: no location with id ${l.existingId}`);
    const match = byId ?? locations.get(lower(l.name));
    locations.set(lower(l.name), match ?? draftLocation(l.name.trim(), l.description));
  }

  const durations = durationsFor(env.videoModel, { quality: 'fast', vramTotalMB: env.vramTotalMB });
  const [minSec, maxSec] = [durations[0], durations[durations.length - 1]];
  const modelName = env.videoModel === 'minimax_h3' ? 'MiniMax H3' : env.videoModel === 'ltx_2_5' ? 'LTX-2.5' : 'Wan 2.2';

  const t = new Date(0).toISOString();
  const scenes: Resolved['scenes'] = [];
  for (const [si, s] of plan.scenes.entries()) {
    const where = `scenes.${si}`;
    const location = s.locationName ? locations.get(lower(s.locationName)) : undefined;
    if (s.locationName && !location) errors.push(`${where}.locationName: "${s.locationName}" is not in locations and doesn't exist yet; add it to "locations"`);
    if (!s.locationName) warnings.push(`${where}: no location, so its frames are generated from text alone`);
    const map = location?.map ?? defaultLocationMap();

    const castOf = (names: string[], path: string): ID[] =>
      names.flatMap((name, ni) => {
        const c = characters.get(lower(name));
        if (!c) {
          errors.push(`${path}.${ni}: "${name}" is not in characters and doesn't exist yet; add it to "characters"`);
          return [];
        }
        return [c.id];
      });
    const marksOf = (marks: z.infer<typeof MarkSchema>[] | undefined, path: string): CharacterMark[] | undefined =>
      marks?.flatMap((m, mi) => {
        const c = characters.get(lower(m.character));
        if (!c) errors.push(`${path}.${mi}.character: "${m.character}" is not in characters`);
        if (!inBounds(map, m.x, m.y)) errors.push(`${path}.${mi}: (${m.x}, ${m.y}) is outside the ${map.widthM} × ${map.heightM} m map`);
        return c ? [{ characterId: c.id, pos: { x: m.x, y: m.y }, facingDeg: ((m.facingDeg % 360) + 360) % 360 }] : [];
      });

    const sceneCast: ID[] = [...new Set(s.shots.flatMap((sh) => castOf(sh.characterNames, `${where}.shots`)))];
    const given = marksOf(s.blocking, `${where}.blocking`);
    // Characters without a mark go on an arc around the subject (the same as the AI breakdown).
    const blocking = given ? completeBlocking(given, sceneCast, map) : blockingArc(sceneCast, map);
    const scene: Scene = {
      id: `new:scene${si}`,
      projectId: project.id,
      order: si,
      title: s.title,
      description: s.description,
      locationId: location?.id,
      timeOfDay: s.timeOfDay,
      blocking,
      createdAt: t,
      updatedAt: t,
    };

    const shots: Shot[] = [];
    for (const [hi, sh] of s.shots.entries()) {
      const path = `${where}.shots.${hi}`;
      const characterIds = castOf(sh.characterNames, `${path}.characterNames`);
      const shotMarks = marksOf(sh.blocking, `${path}.blocking`);
      const marks = completeBlocking(shotMarks ?? blocking, characterIds, map);
      const unmarked = characterIds.filter((id) => !(shotMarks ?? given ?? []).some((m) => m.characterId === id));
      if ((shotMarks || given) && unmarked.length) {
        const names = unmarked.map((id) => [...characters.values()].find((c) => c.id === id)?.name).join(', ');
        warnings.push(`${path}: ${names} had no mark, so the studio placed them`);
      }
      if (sh.dialogue && characterIds.length === 0) warnings.push(`${path}: dialogue with nobody in frame is rendered as off-screen speech`);

      const durationSec = sh.durationSec ?? Math.min(maxSec, Math.max(minSec, 5));
      if (!Number.isInteger(durationSec) || durationSec < minSec || durationSec > maxSec)
        errors.push(`${path}.durationSec: ${durationSec} s doesn't fit ${modelName} on this pod; use a whole number from ${minSec} to ${maxSec} (offered: ${durations.join(', ')})`);

      let camera: MapCamera;
      if (sh.camera) {
        if (!inBounds(map, sh.camera.x, sh.camera.y)) errors.push(`${path}.camera: (${sh.camera.x}, ${sh.camera.y}) is outside the ${map.widthM} × ${map.heightM} m map`);
        const target = sh.camera.targetX !== undefined && sh.camera.targetY !== undefined ? { x: sh.camera.targetX, y: sh.camera.targetY } : undefined;
        camera = { ...placeCamera(map, target ?? map.subject, 'front', sh.shotSize), pos: { x: sh.camera.x, y: sh.camera.y }, target, heightM: sh.camera.heightM, auto: false };
      } else {
        camera = aimCamera(placeCamera(map, map.subject, sh.cameraSide ?? 'front', sh.shotSize), marks, sh.shotSize, map);
      }

      shots.push({
        id: `new:shot${si}.${hi}`,
        sceneId: scene.id,
        order: hi,
        action: sh.action,
        dialogue: sh.dialogue,
        shotSize: sh.shotSize,
        cameraMove: sh.cameraMove,
        camera,
        characterIds,
        blocking: shotMarks,
        durationSec,
        keyframePrompt: sh.keyframePrompt,
        motionPrompt: sh.motionPrompt,
        keyframeMode: sh.keyframeMode,
        seed: sh.seed,
        keyframeCandidates: [],
        videoCandidates: [],
        status: 'draft',
        createdAt: t,
        updatedAt: t,
      });
    }
    scenes.push({ scene, shots });
  }
  return { errors, warnings, resolved: { characters, locations, scenes } satisfies Resolved };
}

function previewsFor(project: Project, resolved: Resolved, env: StoryboardEnv): ShotPreview[] {
  const byId = new Map([...resolved.characters.values()].map((c) => [c.id, c]));
  const locById = new Map([...resolved.locations.values()].map((l) => [l.id, l]));
  const castNames = [...new Set([...resolved.characters.values()].map((c) => c.name))];
  const style = project.styleId ? db.styles.get(project.styleId) : undefined;
  return resolved.scenes.flatMap(({ scene, shots }) =>
    shots.map((shot) => {
      let location = scene.locationId ? locById.get(scene.locationId) : undefined;
      // Rendering queues a missing establishing image before the frames, so preview as if it exists.
      if (location && !location.establishingAssetId && env.editEngineAvailable) location = { ...location, establishingAssetId: 'pending' };
      const characters = shot.characterIds.map((id) => byId.get(id)).filter((c): c is Character => Boolean(c));
      const plan = buildShotPlan({ project, scene, shot, location, characters, castNames, style, editEngineAvailable: env.editEngineAvailable });
      return {
        scene: scene.order + 1,
        shot: shot.order + 1,
        mode: plan.mode,
        visibleCharacters: plan.placements.map((p) => byId.get(p.characterId)?.name ?? p.characterId),
        keyframePrompt: plan.keyframePrompt,
        motionPrompt: plan.motionPrompt,
        durationSec: shot.durationSec,
      };
    }),
  );
}

function estimateFor(resolved: Resolved, env: StoryboardEnv): Estimate {
  const shots = resolved.scenes.flatMap((s) => s.shots);
  const cast = new Set(shots.flatMap((s) => s.characterIds));
  const locationIds = new Set(resolved.scenes.map((s) => s.scene.locationId).filter(Boolean));
  const references = env.editEngineAvailable
    ? [...resolved.characters.values()].filter((c) => cast.has(c.id) && c.referenceAssetIds.length === 0).length +
      [...resolved.locations.values()].filter((l) => locationIds.has(l.id) && !l.establishingAssetId).length
    : 0;
  const minutes: [number, number] = [0, 1].map(
    (i) =>
      references * REFERENCE_MINUTES[i] +
      shots.length * KEYFRAME_MINUTES[i] +
      shots.reduce((sum, s) => sum + clipMinutes(env.videoModel, 'fast', s.durationSec)[i], 0),
  ) as [number, number];
  return { references, frames: shots.length, clips: shots.length, minutes: [Math.max(1, Math.round(minutes[0])), Math.max(1, Math.round(minutes[1]))] };
}

/** Parse and check a plan against the studio as it is now. */
export function checkStoryboard(project: Project, raw: unknown, env: StoryboardEnv): StoryboardCheck & { plan?: StoryboardPlan; resolved?: Resolved } {
  const parsed = StoryboardSchema.safeParse(raw);
  const empty: Estimate = { references: 0, frames: 0, clips: 0, minutes: [0, 0] };
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error), warnings: [], previews: [], estimate: empty };
  const { errors, warnings, resolved } = resolve(project, parsed.data, env);
  if (errors.length) return { ok: false, errors, warnings, previews: [], estimate: empty };
  return { ok: true, errors, warnings, previews: previewsFor(project, resolved, env), estimate: estimateFor(resolved, env), plan: parsed.data, resolved };
}

// ───────────────────────────── write ─────────────────────────────

/** Append the checked storyboard to the project: creates missing characters and locations, then scenes and shots. */
export function writeStoryboard(project: Project, plan: StoryboardPlan, resolved: Resolved): ProjectDetail {
  return db.db.transaction(() => {
    if (!project.logline.trim() && plan.logline) db.projects.update(project.id, { logline: plan.logline });
    const ids = new Map<string, ID>(); // draft id → real id
    for (const c of resolved.characters.values()) {
      if (!c.id.startsWith('new:') || ids.has(c.id)) continue;
      ids.set(c.id, db.characters.create({ name: c.name, description: c.description, color: c.color }).id);
    }
    for (const l of resolved.locations.values()) {
      if (!l.id.startsWith('new:') || ids.has(l.id)) continue;
      ids.set(l.id, db.locations.create({ name: l.name, description: l.description, map: l.map }).id);
    }
    const real = (id: ID) => ids.get(id) ?? id;
    const marks = (m: CharacterMark[] | undefined) => m?.map((mk) => ({ ...mk, characterId: real(mk.characterId) }));
    for (const { scene, shots } of resolved.scenes) {
      const created = db.scenes.create({
        projectId: project.id,
        title: scene.title,
        description: scene.description,
        locationId: scene.locationId ? real(scene.locationId) : undefined,
        timeOfDay: scene.timeOfDay,
      });
      db.scenes.update(created.id, { blocking: marks(scene.blocking) });
      for (const shot of shots) {
        const { id, sceneId, order, createdAt, updatedAt, ...rest } = shot;
        db.shots.create({ ...rest, sceneId: created.id, characterIds: shot.characterIds.map(real), blocking: marks(shot.blocking) });
      }
    }
    const scenes = db.scenes.listByProject(project.id).map((s) => ({ ...s, shots: db.shots.listByScene(s.id) }));
    return { project: db.projects.get(project.id)!, scenes };
  })();
}

// ───────────────────────────── idempotency ─────────────────────────────

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface Remembered {
  at: number;
  status: number;
  body: unknown;
}

/** The response first sent for this key (within 24 h), so a retried request doesn't add the scenes twice. */
export function rememberedResponse(projectId: ID, key: string): Remembered | undefined {
  const hit = db.kv.get<Remembered>(`idem:${projectId}:${key}`);
  return hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS ? hit : undefined;
}

export function rememberResponse(projectId: ID, key: string, status: number, body: unknown) {
  db.db.prepare(`DELETE FROM kv WHERE key LIKE 'idem:%' AND json_extract(value, '$.at') < ?`).run(Date.now() - IDEMPOTENCY_TTL_MS);
  db.kv.set(`idem:${projectId}:${key}`, { at: Date.now(), status, body } satisfies Remembered);
}

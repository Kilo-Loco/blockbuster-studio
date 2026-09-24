// AI script breakdown: script/idea -> BreakdownDraft (reviewed by the user) -> applied to the DB.
// Also hosts the generic prompt-enhancement helper used by POST /api/ai/enhance.

import { z } from 'zod';
import * as db from '../db';
import { callLlmForJson } from './llm';
import { assertPromptsAllowed } from '../pipeline/guard';
import { SHOT_SIZES, CAMERA_MOVES, TIMES_OF_DAY, CHARACTER_COLORS } from '../../shared/presets';
import { defaultLocationMap, placeCamera } from '../../shared/camera';
import type {
  BreakdownDraft,
  CharacterMark,
  ID,
  LocationMap,
  ProjectDetail,
  ShotSize,
  CameraMoveId,
  TimeOfDay,
} from '../../shared/types';

// ───────────────────────────── validation (lenient / coercive) ─────────────────────────────

const SHOT_SIZE_IDS = SHOT_SIZES.map((s) => s.id) as [ShotSize, ...ShotSize[]];
const CAMERA_MOVE_IDS = CAMERA_MOVES.map((m) => m.id) as [CameraMoveId, ...CameraMoveId[]];
const TIME_OF_DAY_IDS = TIMES_OF_DAY as [TimeOfDay, ...TimeOfDay[]];
const CAMERA_SIDES = ['front', 'front-left', 'front-right', 'left', 'right', 'back', 'overhead'] as const;

/** Clamp shot duration into the supported [2, 7] second range. */
function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.min(7, Math.max(2, Math.round(n)));
}

// Every leaf uses `.catch(default)` rather than failing the parse, per the project's
// "validate, coerce, clamp" debugging philosophy — a malformed field from the model shouldn't
// blow up the whole breakdown when a sane default will do.
const ShotDraftSchema = z.object({
  action: z.string().catch(''),
  dialogue: z.string().optional().catch(undefined),
  shotSize: z.enum(SHOT_SIZE_IDS).catch('MS'),
  cameraMove: z.enum(CAMERA_MOVE_IDS).catch('static'),
  characterNames: z.array(z.string()).catch([]),
  durationSec: z.coerce.number().catch(5).transform(clampDuration),
  cameraSide: z.enum(CAMERA_SIDES).optional().catch(undefined),
});

const SceneDraftSchema = z.object({
  title: z.string().catch('Untitled scene'),
  description: z.string().catch(''),
  locationName: z.string().catch(''),
  timeOfDay: z.enum(TIME_OF_DAY_IDS).catch('day'),
  shots: z.array(ShotDraftSchema).catch([]),
});

const CharacterDraftSchema = z.object({
  name: z.string().catch('Unnamed character'),
  description: z.string().catch(''),
  existingId: z.string().optional().catch(undefined),
});

const LocationDraftSchema = z.object({
  name: z.string().catch('Unnamed location'),
  description: z.string().catch(''),
  existingId: z.string().optional().catch(undefined),
});

const BreakdownDraftSchema = z.object({
  logline: z.string().catch(''),
  characters: z.array(CharacterDraftSchema).catch([]),
  locations: z.array(LocationDraftSchema).catch([]),
  scenes: z.array(SceneDraftSchema).catch([]),
});

// JSON-schema shape handed to the LLM (tool input_schema / response_format hint). Kept loose —
// the zod schema above is what actually enforces/coerces shape on the way back.
const BREAKDOWN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    logline: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: {
            type: 'string',
            description: 'Vivid visual description usable verbatim as a text-to-image prompt: hair, build, clothing, age, distinguishing features.',
          },
        },
        required: ['name', 'description'],
      },
    },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: {
            type: 'string',
            description: 'Visual description: setting, lighting, era, mood.',
          },
        },
        required: ['name', 'description'],
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Slugline style, e.g. "INT. RAMEN BAR - NIGHT".' },
          description: { type: 'string' },
          locationName: { type: 'string', description: 'Must exactly match a name in locations[].' },
          timeOfDay: { type: 'string', enum: TIME_OF_DAY_IDS },
          shots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                dialogue: { type: 'string' },
                shotSize: { type: 'string', enum: SHOT_SIZE_IDS },
                cameraMove: { type: 'string', enum: CAMERA_MOVE_IDS },
                characterNames: { type: 'array', items: { type: 'string' }, description: 'Must exactly match names in characters[].' },
                durationSec: { type: 'number', description: 'Seconds, 2-7.' },
                cameraSide: { type: 'string', enum: CAMERA_SIDES },
              },
              required: ['action', 'shotSize', 'cameraMove', 'characterNames', 'durationSec'],
            },
          },
        },
        required: ['title', 'description', 'locationName', 'timeOfDay', 'shots'],
      },
    },
  },
  required: ['logline', 'characters', 'locations', 'scenes'],
} as const;

// ───────────────────────────── generateBreakdown ─────────────────────────────

export interface GenerateBreakdownOpts {
  script: string;
  existingCharacters: { name: string; description: string }[];
  existingLocations: { name: string; description: string }[];
}

const BREAKDOWN_SYSTEM_PROMPT = `You are a film director and 1st assistant director breaking a script or loose idea down into a shootable coverage plan for an AI film production pipeline.

Given the user's script (which may be a full screenplay, a treatment, or just a loose idea), produce:
1. Characters: every distinct person in the story, with a vivid, consistent visual description written as a text-to-image prompt fragment — hair, build, clothing, age, distinguishing features. This description will be reused verbatim for every image of that character, so be concrete and specific.
2. Locations: every distinct setting, with a visual description covering the setting, lighting, era, and mood.
3. Scenes: broken from the story in order, each with a slugline-style title (e.g. "INT. RAMEN BAR - NIGHT"), a short description, which location it takes place in (by exact name), and time of day.
4. Shots: for each scene, standard film coverage — an establishing wide, medium shots, close-ups, and reaction shots as appropriate to the action and dialogue. Across the WHOLE breakdown, produce between 5 and 40 shots total. Give each shot a sensible duration in seconds (2-7), a camera move, and a cameraSide hint (where the camera stands relative to the action: front, front-left, front-right, left, right, back, or overhead).

IMPORTANT: reuse character and location names EXACTLY as given in the existing lists below when the script's people or places match ones that already exist — do not invent near-duplicate names for the same character or place. Leave existingId unset in every case; the caller matches new entries to existing ones by name.`;

function buildUserPrompt(opts: GenerateBreakdownOpts): string {
  const existingCharsBlock = opts.existingCharacters.length
    ? opts.existingCharacters.map((c) => `- ${c.name}: ${c.description}`).join('\n')
    : '(none yet)';
  const existingLocsBlock = opts.existingLocations.length
    ? opts.existingLocations.map((l) => `- ${l.name}: ${l.description}`).join('\n')
    : '(none yet)';

  return `Existing characters (reuse these names exactly when they match):\n${existingCharsBlock}\n\nExisting locations (reuse these names exactly when they match):\n${existingLocsBlock}\n\nScript / idea:\n${opts.script}`;
}

export async function generateBreakdown(opts: GenerateBreakdownOpts): Promise<BreakdownDraft> {
  assertPromptsAllowed(opts.script);

  const raw = await callLlmForJson({
    system: BREAKDOWN_SYSTEM_PROMPT,
    user: buildUserPrompt(opts),
    toolName: 'submit_breakdown',
    toolDescription: 'Submit the film breakdown (characters, locations, scenes, and shots) for the given script.',
    schema: BREAKDOWN_JSON_SCHEMA,
  });

  const parsed = BreakdownDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('The AI returned a breakdown that could not be parsed');
  }
  const draft = parsed.data as BreakdownDraft;

  // The model misbehaving (generating disallowed content) fails the whole breakdown rather than
  // silently dropping individual shots/characters — this is meant to be a rare, loud failure.
  assertPromptsAllowed(
    draft.logline,
    ...draft.characters.map((c) => c.description),
    ...draft.locations.map((l) => l.description),
    ...draft.scenes.flatMap((s) => [s.description, ...s.shots.flatMap((sh) => [sh.action, sh.dialogue])]),
  );

  return draft;
}

// ───────────────────────────── enhancePrompt ─────────────────────────────

export interface EnhancePromptOpts {
  prompt: string;
  target: 'image' | 'video';
}

const ENHANCE_SCHEMA = {
  type: 'object',
  properties: { prompt: { type: 'string' } },
  required: ['prompt'],
} as const;

export async function enhancePrompt(opts: EnhancePromptOpts): Promise<string> {
  assertPromptsAllowed(opts.prompt);

  const system =
    opts.target === 'video'
      ? 'You are a cinematographer rewriting rough prompts into detailed, cinematic video-generation prompts. Emphasize motion, action progression over time, and camera movement language. Return one prompt, no preamble.'
      : 'You are a cinematographer rewriting rough prompts into detailed, cinematic image-generation prompts. Emphasize composition, lighting, lens choice, and film stock/style. Return one prompt, no preamble.';

  const raw = await callLlmForJson<{ prompt?: unknown }>({
    system,
    user: opts.prompt,
    toolName: 'submit_enhancement',
    toolDescription: 'Submit the rewritten, enhanced prompt.',
    schema: ENHANCE_SCHEMA,
  });

  const enhanced = typeof raw?.prompt === 'string' ? raw.prompt.trim() : '';
  if (!enhanced) {
    throw new Error('The AI did not return an enhanced prompt');
  }
  // The model shouldn't introduce disallowed content, but verify the output too.
  assertPromptsAllowed(enhanced);
  return enhanced;
}

// ───────────────────────────── applyBreakdown ─────────────────────────────

/**
 * Loosely arrange N characters on a semicircle around the scene's subject point, facing back
 * toward it. Aesthetics don't matter much here — just produce valid, in-bounds marks. A single
 * character sits dead ahead of the subject; more characters fan out across a 120 degree arc.
 */
function buildBlockingArc(characterIds: ID[], map: LocationMap): CharacterMark[] {
  const n = characterIds.length;
  if (n === 0) return [];
  const radiusM = 1.2;
  return characterIds.map((characterId, i) => {
    const angleDeg = n === 1 ? 0 : -60 + i * (120 / (n - 1));
    const angleRad = (angleDeg * Math.PI) / 180;
    // camera.ts convention: angle 0 = up/north = -y direction, clockwise.
    const dir = { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
    const pos = {
      x: Math.min(map.widthM, Math.max(0, map.subject.x + dir.x * radiusM)),
      y: Math.min(map.heightM, Math.max(0, map.subject.y + dir.y * radiusM)),
    };
    const facingDeg = ((angleDeg + 180) % 360 + 360) % 360;
    return { characterId, pos, facingDeg };
  });
}

export function applyBreakdown(projectId: ID, draft: BreakdownDraft): ProjectDetail {
  // Guard-check everything up front so we never write a half-applied result to the DB.
  assertPromptsAllowed(
    draft.logline,
    ...draft.characters.map((c) => c.description),
    ...draft.locations.map((l) => l.description),
    ...draft.scenes.flatMap((s) => [s.description, ...s.shots.flatMap((sh) => [sh.action, sh.dialogue])]),
  );

  // ── characters: match existing by existingId, then case-insensitive name, else create ──
  const existingCharacters = db.characters.list();
  const characterById = new Map(existingCharacters.map((c) => [c.id, c]));
  const characterByNameLower = new Map(existingCharacters.map((c) => [c.name.toLowerCase(), c]));
  const nameToCharacterId = new Map<string, ID>();
  let newCharacterCount = 0;
  for (const c of draft.characters) {
    let match = c.existingId ? characterById.get(c.existingId) : undefined;
    if (!match) match = characterByNameLower.get(c.name.toLowerCase());
    if (!match) {
      const color = CHARACTER_COLORS[newCharacterCount % CHARACTER_COLORS.length];
      match = db.characters.create({ name: c.name, description: c.description, color });
      newCharacterCount++;
    }
    nameToCharacterId.set(c.name.toLowerCase(), match.id);
  }

  // ── locations: same matching strategy ──
  const existingLocations = db.locations.list();
  const locationById = new Map(existingLocations.map((l) => [l.id, l]));
  const locationByNameLower = new Map(existingLocations.map((l) => [l.name.toLowerCase(), l]));
  const nameToLocation = new Map<string, (typeof existingLocations)[number]>();
  for (const l of draft.locations) {
    let match = l.existingId ? locationById.get(l.existingId) : undefined;
    if (!match) match = locationByNameLower.get(l.name.toLowerCase());
    if (!match) {
      match = db.locations.create({ name: l.name, description: l.description, map: defaultLocationMap() });
    }
    nameToLocation.set(l.name.toLowerCase(), match);
  }

  // ── scenes + shots ──
  for (const s of draft.scenes) {
    const location = nameToLocation.get(s.locationName.toLowerCase());
    const scene = db.scenes.create({
      projectId,
      title: s.title,
      description: s.description,
      locationId: location?.id,
      timeOfDay: s.timeOfDay,
    });

    const map = location?.map ?? defaultLocationMap();

    // Every character appearing in any shot of this scene gets a blocking mark, built once per scene.
    const sceneCharacterIds: ID[] = [];
    const seen = new Set<ID>();
    for (const sh of s.shots) {
      for (const name of sh.characterNames) {
        const id = nameToCharacterId.get(name.toLowerCase());
        if (id && !seen.has(id)) {
          seen.add(id);
          sceneCharacterIds.push(id);
        }
      }
    }
    const blocking = buildBlockingArc(sceneCharacterIds, map);
    db.scenes.update(scene.id, { blocking });

    for (const sh of s.shots) {
      const characterIds = sh.characterNames
        .map((name) => nameToCharacterId.get(name.toLowerCase()))
        .filter((id): id is ID => Boolean(id));
      const camera = placeCamera(map, map.subject, sh.cameraSide ?? 'front', sh.shotSize);
      db.shots.create({
        sceneId: scene.id,
        action: sh.action,
        dialogue: sh.dialogue,
        shotSize: sh.shotSize,
        cameraMove: sh.cameraMove,
        characterIds,
        durationSec: clampDuration(sh.durationSec),
        camera,
        // shot.blocking left undefined — falls back to the scene's blocking.
      });
    }
  }

  const project = db.projects.get(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const scenes = db.scenes.listByProject(projectId);
  return {
    project,
    scenes: scenes.map((scene) => ({ ...scene, shots: db.shots.listByScene(scene.id) })),
  };
}

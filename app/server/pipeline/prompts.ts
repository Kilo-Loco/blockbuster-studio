// The shot pipeline: turns storyboard data (project/scene/shot/location/characters/style) into
// the concrete prompts and LoRA lists the ComfyUI job runners consume.
import type {
  Character,
  CharacterMark,
  ID,
  Location,
  Lora,
  LoraFamily,
  LoraRef,
  Project,
  Scene,
  Shot,
  Style,
} from '../../shared/types';
import { angleKey, anglePrompt, defaultLocationMap, projectMarks, shotAngle, type ScreenPlacement } from '../../shared/camera';
import { CAMERA_MOVE_BY_ID, SHOT_SIZE_BY_ID } from '../../shared/presets';

export interface ShotContext {
  project: Project;
  scene: Scene;
  shot: Shot;
  location?: Location;
  /** Characters referenced by shot.characterIds, in that order. */
  characters: Character[];
  style?: Style;
  /** True when qwen_edit's model files are present (drives the default compose/generate choice). */
  editEngineAvailable: boolean;
}

export interface ShotPlan {
  mode: 'compose' | 'generate';
  angle: ReturnType<typeof shotAngle>;
  placements: ScreenPlacement[];
  keyframePrompt: string;
  motionPrompt: string;
  /** compose only: the angle plate can reuse the establishing image directly (front / eye-level / medium). */
  usesEstablishingDirectly: boolean;
  /** compose only: a previously-rendered angle plate for this exact angle bucket. */
  cachedAngleAssetId?: ID;
  /** compose only: the angle-plate prompt (for the multi-angle LoRA), when a new plate must be rendered. */
  anglePlatePrompt: string;
  /** Up to 2 characters with a reference image, used as image2/image3 in the compose edit. */
  composeReferenceCharacters: Character[];
}

function charById(characters: Character[]): Map<ID, Character> {
  return new Map(characters.map((c) => [c.id, c]));
}

function blockingFor(ctx: ShotContext): CharacterMark[] {
  const marks = ctx.shot.blocking ?? ctx.scene.blocking;
  const ids = new Set(ctx.shot.characterIds);
  return marks.filter((m) => ids.has(m.characterId));
}

export function computeMode(ctx: ShotContext): 'compose' | 'generate' {
  if (ctx.shot.keyframeMode === 'compose' || ctx.shot.keyframeMode === 'generate') return ctx.shot.keyframeMode;
  return ctx.location?.establishingAssetId && ctx.editEngineAvailable ? 'compose' : 'generate';
}

const SCREEN_X_PHRASE: Record<ScreenPlacement['screenX'], string> = {
  left: 'at frame left',
  'center-left': 'left of center',
  center: 'in the center of frame',
  'center-right': 'right of center',
  right: 'at frame right',
};
const DEPTH_PHRASE: Record<ScreenPlacement['depth'], string> = {
  foreground: 'in the foreground',
  midground: 'in the midground',
  background: 'in the background',
};
const FACING_PHRASE: Record<ScreenPlacement['facing'], string> = {
  'toward camera': 'facing the camera',
  'away from camera': 'facing away from the camera',
  'screen left': 'facing screen left',
  'screen right': 'facing screen right',
};

function placementPhrase(sp: ScreenPlacement, label: string): string {
  return `${label} is positioned ${SCREEN_X_PHRASE[sp.screenX]}, ${DEPTH_PHRASE[sp.depth]}, ${FACING_PHRASE[sp.facing]}`;
}

function characterLabel(c: Character, withTrigger: boolean): string {
  const trigger = withTrigger && c.triggerWord ? `${c.triggerWord}, ` : '';
  return `${c.name} (${trigger}${c.description})`;
}

export function buildShotPlan(ctx: ShotContext): ShotPlan {
  const mode = computeMode(ctx);
  const map = ctx.location?.map ?? defaultLocationMap();
  const marks = blockingFor(ctx);
  const angle = shotAngle({ camera: ctx.shot.camera, shotSize: ctx.shot.shotSize, marks, map, elevationOverride: ctx.shot.elevation });
  const placements = projectMarks(ctx.shot.camera, ctx.shot.shotSize, marks, map);
  const byId = charById(ctx.characters);
  const key = angleKey(angle);
  const cachedAngleAssetId = ctx.location?.angleViews.find((v) => v.key === key)?.assetId;
  const usesEstablishingDirectly = angle.azimuth === 'front view' && angle.elevation === 'eye-level shot' && angle.distance === 'medium shot';

  const visible = placements.filter((p) => p.visible);
  const composeReferenceCharacters = visible
    .map((p) => byId.get(p.characterId))
    .filter((c): c is Character => Boolean(c && c.referenceAssetIds.length > 0))
    .slice(0, 2);
  const composeReferenceIds = new Set(composeReferenceCharacters.map((c) => c.id));

  const shotSizePhrase = SHOT_SIZE_BY_ID[ctx.shot.shotSize].phrase;
  const cameraMovePhrase = CAMERA_MOVE_BY_ID[ctx.shot.cameraMove]?.phrase ?? '';
  const stylePrompt = ctx.style?.prompt ?? '';

  let keyframePrompt: string;
  if (ctx.shot.keyframePrompt) {
    keyframePrompt = ctx.shot.keyframePrompt;
  } else if (mode === 'compose') {
    const parts: string[] = [];
    for (const p of visible) {
      const c = byId.get(p.characterId);
      if (!c) continue;
      const label = characterLabel(c, false);
      parts.push(placementPhrase(p, label));
    }
    keyframePrompt = [
      parts.join('. '),
      `${shotSizePhrase}.`,
      ctx.shot.action,
      `${ctx.scene.timeOfDay}.`,
      stylePrompt,
      'Keep the environment from image 1 unchanged. Cinematic film still, photorealistic.',
    ]
      .filter(Boolean)
      .join(' ');
  } else {
    const charParts = visible
      .map((p) => {
        const c = byId.get(p.characterId);
        if (!c) return undefined;
        return `${placementPhrase(p, characterLabel(c, true))}`;
      })
      .filter(Boolean)
      .join('. ');
    keyframePrompt = [
      `Cinematic film still, ${shotSizePhrase}, ${angle.azimuth} ${angle.elevation}.`,
      `${ctx.location?.description ?? ctx.scene.description}, ${ctx.scene.timeOfDay}.`,
      charParts,
      ctx.shot.action,
      stylePrompt,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const motionPrompt =
    ctx.shot.motionPrompt ??
    [ctx.shot.action, ctx.shot.dialogue ? `The character speaks: "${ctx.shot.dialogue}"` : '', cameraMovePhrase, stylePrompt]
      .filter(Boolean)
      .join(' ');

  return {
    mode,
    angle,
    placements,
    keyframePrompt,
    motionPrompt,
    usesEstablishingDirectly,
    cachedAngleAssetId,
    anglePlatePrompt: anglePrompt(angle),
    composeReferenceCharacters,
  };
}

/** LoRAs for a Z-Image keyframe (generate mode): character + style + location LoRAs, plus shot.loras (zimage family only). */
export function resolveGenerateLoras(ctx: ShotContext, loraLookup: Map<ID, Lora>): LoraRef[] {
  const refs: LoraRef[] = [];
  const seen = new Set<ID>();
  const addLora = (id: ID | undefined, strength?: number) => {
    if (!id || seen.has(id)) return;
    const lora = loraLookup.get(id);
    if (!lora || lora.family !== 'zimage') return;
    seen.add(id);
    refs.push({ loraId: id, strength: strength ?? lora.defaultStrength });
  };
  for (const c of ctx.characters) addLora(c.loraId, 0.8);
  addLora(ctx.style?.loraId, ctx.style?.loraStrength);
  addLora(ctx.location?.loraId);
  for (const ref of ctx.shot.loras ?? []) {
    const lora = loraLookup.get(ref.loraId);
    if (lora?.family === 'zimage' && !seen.has(ref.loraId)) {
      seen.add(ref.loraId);
      refs.push(ref);
    }
  }
  return refs;
}

/** LoRAs for the compose edit step (qwen_edit family). Character/style/location LoRAs generally don't apply to Qwen edit; only explicit shot.loras of that family are honored. */
export function resolveComposeLoras(ctx: ShotContext, loraLookup: Map<ID, Lora>): LoraRef[] {
  return (ctx.shot.loras ?? []).filter((ref) => loraLookup.get(ref.loraId)?.family === 'qwen_edit');
}

/** Wan LoRAs for the motion step: shot.loras of the wan22 family. */
export function resolveMotionLoras(ctx: ShotContext, loraLookup: Map<ID, Lora>): LoraRef[] {
  return (ctx.shot.loras ?? []).filter((ref) => loraLookup.get(ref.loraId)?.family === 'wan22');
}

export function loraFamilyFilter(refs: LoraRef[], loraLookup: Map<ID, Lora>, family: LoraFamily): LoraRef[] {
  return refs.filter((r) => loraLookup.get(r.loraId)?.family === family);
}

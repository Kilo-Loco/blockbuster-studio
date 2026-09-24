import { describe, expect, it } from 'vitest';
import { buildShotPlan, computeMode, resolveGenerateLoras, type ShotContext } from './prompts';
import { defaultLocationMap, placeCamera } from '../../shared/camera';
import type { Character, Location, Lora, Project, Scene, Shot, Style } from '../../shared/types';

const map = defaultLocationMap();

function baseProject(): Project {
  return {
    id: 'proj1',
    name: 'Test film',
    logline: '',
    aspect: '16:9',
    script: '',
    createdAt: '',
    updatedAt: '',
  };
}

function baseScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene1',
    projectId: 'proj1',
    order: 0,
    title: 'INT. BAR - NIGHT',
    description: 'a neon-lit bar',
    locationId: 'loc1',
    timeOfDay: 'night',
    blocking: [{ characterId: 'char1', pos: { x: 5, y: 4 }, facingDeg: 180 }],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function baseShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'shot1',
    sceneId: 'scene1',
    order: 0,
    action: 'Mara slides the envelope across the counter without looking up.',
    shotSize: 'MS',
    cameraMove: 'push_in',
    camera: placeCamera(map, map.subject, 'front', 'MS'),
    characterIds: ['char1'],
    durationSec: 5,
    keyframeMode: 'auto',
    keyframeCandidates: [],
    videoCandidates: [],
    status: 'draft',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function baseCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char1',
    name: 'Mara',
    description: 'a woman in her 30s with short silver hair, black trench coat',
    referenceAssetIds: [],
    color: '#f5a524',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function baseLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc1',
    name: 'Ramen bar',
    description: 'a neon-lit ramen bar, rain on the windows, 1980s Tokyo',
    establishingAssetId: 'estab1',
    map,
    angleViews: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function baseStyle(): Style {
  return { id: 'style1', name: 'Neo-noir', prompt: '35mm film, anamorphic, teal and orange grade', createdAt: '' };
}

describe('computeMode', () => {
  it('defaults to compose when the location has an establishing image and edit is available', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene(),
      shot: baseShot(),
      location: baseLocation(),
      characters: [baseCharacter()],
      style: baseStyle(),
      editEngineAvailable: true,
    };
    expect(computeMode(ctx)).toBe('compose');
  });

  it('falls back to generate when there is no establishing image', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene({ locationId: undefined }),
      shot: baseShot(),
      location: undefined,
      characters: [baseCharacter()],
      editEngineAvailable: true,
    };
    expect(computeMode(ctx)).toBe('generate');
  });

  it('falls back to generate when the edit engine is unavailable', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene(),
      shot: baseShot(),
      location: baseLocation(),
      characters: [baseCharacter()],
      editEngineAvailable: false,
    };
    expect(computeMode(ctx)).toBe('generate');
  });

  it('honors an explicit shot.keyframeMode override', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene(),
      shot: baseShot({ keyframeMode: 'generate' }),
      location: baseLocation(),
      characters: [baseCharacter()],
      editEngineAvailable: true,
    };
    expect(computeMode(ctx)).toBe('generate');
  });
});

describe('buildShotPlan compose mode', () => {
  const ctx: ShotContext = {
    project: baseProject(),
    scene: baseScene(),
    shot: baseShot(),
    location: baseLocation(),
    characters: [baseCharacter()],
    style: baseStyle(),
    editEngineAvailable: true,
  };

  it('produces a keyframe prompt describing placement and ends with the compose closing line', () => {
    const plan = buildShotPlan(ctx);
    expect(plan.mode).toBe('compose');
    expect(plan.keyframePrompt).toContain('Mara');
    expect(plan.keyframePrompt).toContain('Keep the environment from image 1 unchanged');
    expect(plan.keyframePrompt).toMatch(/Cinematic film still, photorealistic\.$/);
  });

  it('builds punctuated sentences (no run-ons between parts)', () => {
    const plan = buildShotPlan(ctx);
    // Every lowercase-letter→Uppercase transition across a space must be preceded by punctuation.
    expect(plan.keyframePrompt).not.toMatch(/[a-z] [A-Z][a-z]+ (the|slides|walks|sits)/);
    expect(plan.motionPrompt).not.toMatch(/[a-z] The camera/);
    expect(plan.motionPrompt).toMatch(/\.$/);
  });

  it('the front/eye-level/medium camera reuses the establishing image directly', () => {
    const plan = buildShotPlan(ctx);
    expect(plan.usesEstablishingDirectly).toBe(true);
  });

  it('a non-default angle does not reuse the establishing image and has no cache yet', () => {
    const shot = baseShot({ camera: { pos: { x: 2, y: 4 }, heightM: 1.6 } });
    const plan = buildShotPlan({ ...ctx, shot });
    expect(plan.usesEstablishingDirectly).toBe(false);
    expect(plan.cachedAngleAssetId).toBeUndefined();
    expect(plan.anglePlatePrompt).toMatch(/^<sks> /);
  });

  it('finds a cached angle plate when one exists for the bucket', () => {
    const shot = baseShot({ camera: { pos: { x: 2, y: 4 }, heightM: 1.6 } });
    const plan1 = buildShotPlan({ ...ctx, shot });
    const location = baseLocation({ angleViews: [{ key: `${plan1.angle.azimuth}|${plan1.angle.elevation}|${plan1.angle.distance}`, assetId: 'cached1' }] });
    const plan2 = buildShotPlan({ ...ctx, shot, location });
    expect(plan2.cachedAngleAssetId).toBe('cached1');
  });

  it('uses up to 2 characters with reference images for the compose edit, describing the rest in text only', () => {
    const chars = ['a', 'b', 'c'].map((id) =>
      baseCharacter({ id, name: `Char${id}`, referenceAssetIds: [`ref-${id}`] }),
    );
    const blocking = chars.map((c, i) => ({ characterId: c.id, pos: { x: 3 + i * 2, y: 4 }, facingDeg: 180 }));
    const shot = baseShot({ characterIds: chars.map((c) => c.id) });
    const scene = baseScene({ blocking });
    const plan = buildShotPlan({ ...ctx, shot, scene, characters: chars });
    expect(plan.composeReferenceCharacters.length).toBeLessThanOrEqual(2);
    // The 3rd character is still described in the text prompt even without an image ref.
    expect(plan.keyframePrompt).toContain('Charc');
  });
});

describe('buildShotPlan generate mode', () => {
  const ctx: ShotContext = {
    project: baseProject(),
    scene: baseScene({ locationId: undefined }),
    shot: baseShot(),
    location: undefined,
    characters: [baseCharacter({ triggerWord: 'ohwx_mara' })],
    style: baseStyle(),
    editEngineAvailable: true,
  };

  it('builds a Z-Image prompt with shot size, angle words, location/time, character, action and style', () => {
    const plan = buildShotPlan(ctx);
    expect(plan.mode).toBe('generate');
    expect(plan.keyframePrompt).toContain('Cinematic film still');
    expect(plan.keyframePrompt).toContain('medium shot');
    expect(plan.keyframePrompt).toContain('ohwx_mara');
    expect(plan.keyframePrompt).toContain('35mm film');
  });
});

describe('motion prompt', () => {
  it('includes action, dialogue, camera move phrase and style', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene(),
      shot: baseShot({ dialogue: "It's not what you think." }),
      location: baseLocation(),
      characters: [baseCharacter()],
      style: baseStyle(),
      editEngineAvailable: true,
    };
    const plan = buildShotPlan(ctx);
    expect(plan.motionPrompt).toContain('Mara slides the envelope');
    expect(plan.motionPrompt).toContain('It\'s not what you think.');
    expect(plan.motionPrompt).toContain('dollies in');
    expect(plan.motionPrompt).toContain('35mm film');
  });

  it('honors a user override', () => {
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene(),
      shot: baseShot({ motionPrompt: 'Custom motion prompt.' }),
      location: baseLocation(),
      characters: [baseCharacter()],
      editEngineAvailable: true,
    };
    expect(buildShotPlan(ctx).motionPrompt).toBe('Custom motion prompt.');
  });
});

describe('resolveGenerateLoras', () => {
  it('includes character, style and location LoRAs of the zimage family, and filters shot.loras by family', () => {
    const charLora: Lora = {
      id: 'l1', name: 'Mara', filename: 'mara.safetensors', family: 'zimage', kind: 'character',
      defaultStrength: 1, source: 'trained', status: 'ready', createdAt: '',
    };
    const wanLora: Lora = {
      id: 'l2', name: 'Motion', filename: 'motion.safetensors', family: 'wan22', kind: 'motion',
      defaultStrength: 1, source: 'trained', status: 'ready', createdAt: '',
    };
    const lookup = new Map([[charLora.id, charLora], [wanLora.id, wanLora]]);
    const ctx: ShotContext = {
      project: baseProject(),
      scene: baseScene({ locationId: undefined }),
      shot: baseShot({ loras: [{ loraId: 'l2', strength: 1 }] }),
      characters: [baseCharacter({ loraId: 'l1' })],
      editEngineAvailable: false,
    };
    const refs = resolveGenerateLoras(ctx, lookup);
    expect(refs.map((r) => r.loraId)).toEqual(['l1']);
  });
});

describe('off-screen characters', () => {
  it('marks cast members named in the action who are not in frame and pins the head count', async () => {
    const { markOffscreen } = await import('./prompts');
    expect(markOffscreen('Hank looks up at Jo and smiles', ['Jo', 'Hank'], ['Hank'])).toBe('Hank looks up at Jo (off-screen) and smiles');
    expect(markOffscreen('Jo (off-screen) waves', ['Jo'], [])).toBe('Jo (off-screen) waves');
    expect(markOffscreen('Joanna waves', ['Jo'], [])).toBe('Joanna waves');
  });
});

// Source of truth for the data model and the REST/SSE contract shared by server and web.
// Keep this file free of runtime imports so both sides can use it.

export type ID = string; // nanoid
export type ISODate = string;

// ───────────────────────────── Models / engines ─────────────────────────────

export type ModelGroupId = 'image' | 'video' | 'edit' | 'perform' | 't2v';

export interface ModelGroupStatus {
  id: ModelGroupId;
  label: string;
  ready: boolean;
  enabled: boolean; // part of this pod's download plan
  downloadedBytes: number;
  totalBytes: number;
  currentFile?: string;
  error?: string;
}

/** Engines the user can pick in the Studio composer. */
export type EngineId =
  | 'zimage' //            text → image  (Z-Image Turbo)
  | 'qwen_edit' //         image(s) + instruction → image  (Qwen-Image-Edit 2511)
  | 'qwen_angle' //        image → same scene from another camera angle (multi-angle LoRA)
  | 'wan_i2v' //           image → video  (Wan 2.2 I2V A14B)
  | 'wan_t2v' //           text → video  (Wan 2.2 T2V if installed, else zimage → wan_i2v)
  | 'wan_animate'; //      your recording + a character image → that character performing it (Wan Animate 2)

export type LoraFamily = 'zimage' | 'wan22' | 'qwen_edit';
export type LoraKind = 'character' | 'location' | 'style' | 'motion' | 'other';

export interface LoraRef {
  loraId: ID;
  strength: number; // 0..2, default 1 (0.8 for character)
  /** Wan 2.2 only: which expert(s) receive the LoRA. Default 'low'. */
  expert?: 'high' | 'low' | 'both';
}

// ───────────────────────────── Assets / jobs ─────────────────────────────

export type AssetKind = 'image' | 'video';
export type AssetOrigin = 'generated' | 'upload' | 'export';

export interface Asset {
  id: ID;
  kind: AssetKind;
  origin: AssetOrigin;
  /** Served by the studio at `/media/${file}` (auth required). */
  file: string;
  /** Poster/thumbnail (jpg/webp) path under /media, for videos and large images. */
  thumb?: string;
  width: number;
  height: number;
  durationSec?: number;
  fps?: number;
  prompt?: string;
  engine?: EngineId;
  params?: Record<string, unknown>; // the resolved GenerateRequest (for "Reuse")
  jobId?: ID;
  projectId?: ID;
  shotId?: ID;
  favorite: boolean;
  createdAt: ISODate;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export type JobType =
  | 'generate' //        Studio composer request (any engine)
  | 'location_establishing'
  | 'location_angle'
  | 'character_refs'
  | 'shot_keyframe'
  | 'shot_video'
  | 'project_export'
  | 'lora_train'
  | 'lora_download';

export interface Job {
  id: ID;
  type: JobType;
  status: JobStatus;
  /** 0..1 over the whole job (all stages). */
  progress: number;
  /** Human-readable current stage, e.g. "Rendering angle plate", "Denoising 3/4". */
  stage?: string;
  title: string; // short label for the queue UI
  params: Record<string, unknown>;
  outputAssetIds: ID[];
  error?: string;
  projectId?: ID;
  shotId?: ID;
  /** Position in queue when queued (1 = next). */
  queuePosition?: number;
  createdAt: ISODate;
  startedAt?: ISODate;
  finishedAt?: ISODate;
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
export type VideoQuality = 'fast' | 'hd';

/** Studio composer request. The server resolves presets into concrete sizes. */
export interface GenerateRequest {
  engine: EngineId;
  prompt: string;
  negativePrompt?: string;
  aspect: AspectRatio;
  /** Images: 1..4 variations. Videos: 1..2. */
  count: number;
  seed?: number; // omitted → random per item
  loras?: LoraRef[];
  /** Reference/input images (asset IDs). qwen_edit: 1..3, qwen_angle / wan_i2v: exactly 1.
   *  wan_animate: [characterImageAssetId, drivingVideoAssetId]. */
  inputAssetIds?: ID[];
  /** wan_animate: what the person in the recording is doing (helps motion transfer). Optional. */
  motionPrompt?: string;
  /** wan_animate: appearance of the character (e.g. a Cast character's description). `prompt` is the scene/background. */
  characterPrompt?: string;
  // video
  durationSec?: number; // 2..7 (Wan 16 fps → frames = 16*s+1 rounded to 4n+1)
  quality?: VideoQuality;
  cameraMove?: CameraMoveId;
  // angle
  angle?: AngleSpec;
  projectId?: ID;
  shotId?: ID;
}

// ───────────────────────────── Camera / blocking ─────────────────────────────

export type ShotSize = 'ECU' | 'CU' | 'MCU' | 'MS' | 'MWS' | 'WS' | 'EWS';

export type CameraMoveId =
  | 'static'
  | 'push_in'
  | 'pull_out'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'orbit_left'
  | 'orbit_right'
  | 'crane_up'
  | 'crane_down'
  | 'tracking'
  | 'handheld'
  | 'crash_zoom'
  | 'dolly_zoom'
  | 'fpv_drone'
  | 'whip_pan';

/** The multi-angle LoRA vocabulary (8 × 4 × 3 = 96 poses). */
export type Azimuth =
  | 'front view'
  | 'front-right quarter view'
  | 'right side view'
  | 'back-right quarter view'
  | 'back view'
  | 'back-left quarter view'
  | 'left side view'
  | 'front-left quarter view';
export type Elevation = 'low-angle shot' | 'eye-level shot' | 'elevated shot' | 'high-angle shot';
export type Distance = 'close-up' | 'medium shot' | 'wide shot';

export interface AngleSpec {
  azimuth: Azimuth;
  elevation: Elevation;
  distance: Distance;
}

/** 2D point on a location map, in meters. x → right, y → down (SVG convention). */
export interface Vec2 {
  x: number;
  y: number;
}

/** A camera placed on a location map. */
export interface MapCamera {
  pos: Vec2;
  /** Where the camera looks. If omitted, look at the centroid of visible characters or the location subject point. */
  target?: Vec2;
  heightM: number; // lens height above the floor, default 1.6
  /** Horizontal field of view in degrees; derived from the shot size when omitted. */
  fovDeg?: number;
}

export type MapElementType = 'wall' | 'rect' | 'circle' | 'door' | 'window' | 'zone' | 'label';

export interface MapElement {
  id: ID;
  type: MapElementType;
  /** wall/door/window: 2 points (segment). rect/zone: 2 points (opposite corners). circle: center + a point on the rim. label: 1 point. */
  points: Vec2[];
  label?: string;
  color?: string;
}

export interface LocationMap {
  widthM: number; // default 12
  heightM: number; // default 8
  elements: MapElement[];
  /** Point of interest the establishing shot is framed on (default: map center). */
  subject: Vec2;
  /** Where the establishing ("front view") image was taken from. Defines azimuth 0. */
  referenceCamera: MapCamera;
  /** Optional background image (e.g. an uploaded floor plan) stretched to the map bounds. */
  backgroundAssetId?: ID;
}

export interface CharacterMark {
  characterId: ID;
  pos: Vec2;
  /** Facing direction in degrees, 0 = up/north on the map, clockwise. */
  facingDeg: number;
}

// ───────────────────────────── Library ─────────────────────────────

export interface Character {
  id: ID;
  name: string;
  /** Appearance prompt fragment, e.g. "a woman in her 30s with short silver hair, black trench coat". */
  description: string;
  referenceAssetIds: ID[]; // first = primary (used for compositing)
  loraId?: ID;
  triggerWord?: string;
  color: string; // map token color
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface LocationAngleView {
  key: string; // `${azimuth}|${elevation}|${distance}`
  assetId: ID;
}

export interface Location {
  id: ID;
  name: string;
  description: string; // prompt fragment, e.g. "a neon-lit ramen bar, rain on the windows, 1980s Tokyo"
  establishingAssetId?: ID;
  map: LocationMap;
  angleViews: LocationAngleView[];
  loraId?: ID;
  triggerWord?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Style {
  id: ID;
  name: string;
  prompt: string; // appended to image prompts, e.g. "35mm film, anamorphic, teal and orange grade"
  negativePrompt?: string;
  loraId?: ID;
  loraStrength?: number;
  createdAt: ISODate;
}

export type LoraSource = 'bundled' | 'upload' | 'civitai' | 'huggingface' | 'url' | 'trained';
export type LoraStatus = 'ready' | 'downloading' | 'training' | 'error';

export interface Lora {
  id: ID;
  name: string;
  /** File name inside /workspace/models/loras (what ComfyUI's lora_name expects). */
  filename: string;
  family: LoraFamily;
  kind: LoraKind;
  triggerWord?: string;
  defaultStrength: number;
  source: LoraSource;
  sourceUrl?: string;
  previewAssetId?: ID;
  status: LoraStatus;
  error?: string;
  sizeBytes?: number;
  createdAt: ISODate;
}

export interface LoraTrainRequest {
  name: string;
  kind: LoraKind;
  triggerWord: string; // e.g. "ohwx_mara"
  /** Captions default to `${triggerWord}, ${description}`. */
  description?: string;
  assetIds: ID[]; // 8–40 images recommended
  steps?: number; // default 1500
  rank?: number; // default 16
  learningRate?: number; // default 1e-4
  characterId?: ID; // attach result to this character
  locationId?: ID; //  … or this location
}

export interface LoraImportRequest {
  /** Civitai model/model-version page URL, Hugging Face file URL, or direct .safetensors URL. */
  url: string;
  family?: LoraFamily; // auto-detected from Civitai baseModel when possible
  kind?: LoraKind;
  name?: string;
}

// ───────────────────────────── Projects / storyboard ─────────────────────────────

export type TimeOfDay = 'dawn' | 'day' | 'golden hour' | 'dusk' | 'night';

export interface Project {
  id: ID;
  name: string;
  logline: string;
  aspect: AspectRatio; // governs keyframe + video sizes for all shots
  styleId?: ID;
  script: string; // free text (idea, treatment, or screenplay)
  coverAssetId?: ID;
  exportAssetId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Scene {
  id: ID;
  projectId: ID;
  order: number;
  title: string; // slugline, e.g. "INT. RAMEN BAR - NIGHT"
  description: string;
  locationId?: ID;
  timeOfDay: TimeOfDay;
  /** Default character marks for the scene (shots may override). */
  blocking: CharacterMark[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ShotStatus = 'draft' | 'keyframe_queued' | 'keyframe_ready' | 'video_queued' | 'video_ready' | 'error';

export interface Shot {
  id: ID;
  sceneId: ID;
  order: number;
  /** What happens: "Mara slides the envelope across the counter without looking up." */
  action: string;
  dialogue?: string;
  shotSize: ShotSize;
  cameraMove: CameraMoveId;
  /** Explicit elevation override; otherwise derived from camera height. */
  elevation?: Elevation;
  camera: MapCamera;
  characterIds: ID[];
  /** Per-shot overrides of scene blocking. */
  blocking?: CharacterMark[];
  durationSec: number; // 2..7, default 5
  /** User overrides of the auto-built prompts (undefined → auto). */
  keyframePrompt?: string;
  motionPrompt?: string;
  keyframeMode: 'auto' | 'compose' | 'generate';
  loras?: LoraRef[];
  seed?: number;
  keyframeAssetId?: ID;
  keyframeCandidates: ID[]; // previous keyframes the user can switch back to
  videoAssetId?: ID;
  videoCandidates: ID[];
  status: ShotStatus;
  error?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ProjectDetail {
  project: Project;
  scenes: (Scene & { shots: Shot[] })[];
}

/** Output of the AI script breakdown, reviewed by the user before it is applied. */
export interface BreakdownDraft {
  logline: string;
  characters: { name: string; description: string; existingId?: ID }[];
  locations: { name: string; description: string; existingId?: ID }[];
  scenes: {
    title: string;
    description: string;
    locationName: string;
    timeOfDay: TimeOfDay;
    shots: {
      action: string;
      dialogue?: string;
      shotSize: ShotSize;
      cameraMove: CameraMoveId;
      characterNames: string[];
      durationSec: number;
      /** Rough camera placement relative to the action: where around the subject the camera stands. */
      cameraSide?: 'front' | 'front-left' | 'front-right' | 'left' | 'right' | 'back' | 'overhead';
    }[];
  }[];
}

// ───────────────────────────── System / settings ─────────────────────────────

export type LlmProvider = 'none' | 'anthropic' | 'openai_compatible';

export interface Settings {
  llmProvider: LlmProvider;
  anthropicModel: string; // default "claude-sonnet-5"
  openaiBaseUrl: string; // e.g. https://openrouter.ai/api/v1
  openaiModel: string;
  /** Write-only secrets: the server returns `true` if set, never the value. */
  anthropicApiKeySet: boolean;
  openaiApiKeySet: boolean;
  civitaiTokenSet: boolean;
  hfTokenSet: boolean;
  defaultAspect: AspectRatio;
  defaultVideoQuality: VideoQuality;
}

export type SettingsUpdate = Partial<
  Omit<Settings, 'anthropicApiKeySet' | 'openaiApiKeySet' | 'civitaiTokenSet' | 'hfTokenSet'>
> & {
  anthropicApiKey?: string; // '' clears
  openaiApiKey?: string;
  civitaiToken?: string;
  hfToken?: string;
};

export interface SystemInfo {
  version: string;
  comfy: { online: boolean; queueRemaining: number; vramTotalMB?: number; vramFreeMB?: number; gpuName?: string };
  models: ModelGroupStatus[];
  /** Engine → available (all its model files present). */
  engines: Record<EngineId, boolean>;
  llmConfigured: boolean;
  trainerInstalled: boolean;
  /** Result of the container's boot-time CUDA self-check (absent in dev / before it ran). */
  gpuCheck?: { ok: boolean; error?: string; gpu?: string; torch?: string };
  disk: { totalBytes: number; freeBytes: number };
  podId?: string;
}

// ───────────────────────────── SSE events (/api/events) ─────────────────────────────

export type ServerEvent =
  | { type: 'job'; job: Job }
  | { type: 'asset'; asset: Asset }
  | { type: 'asset_deleted'; id: ID }
  | { type: 'shot'; shot: Shot }
  | { type: 'location'; location: Location }
  | { type: 'character'; character: Character }
  | { type: 'lora'; lora: Lora }
  | { type: 'models'; models: ModelGroupStatus[] }
  | { type: 'system'; system: SystemInfo }
  | { type: 'ping'; t: number };

// ───────────────────────────── REST helpers ─────────────────────────────

export interface Paged<T> {
  items: T[];
  nextCursor?: string;
}

export interface ApiError {
  error: string;
  detail?: unknown;
}

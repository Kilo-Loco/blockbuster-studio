// Source of truth for the data model and the REST/SSE contract shared by server and web.
// Keep this file free of runtime imports so both sides can use it.

export type ID = string; // nanoid
export type ISODate = string;

// ───────────────────────────── Models / engines ─────────────────────────────

export type ModelGroupId = 'image' | 'video' | 'edit' | 'perform' | 't2v' | 'voice' | 'minimax' | 'minimax_ref' | 'ltx' | 'control' | 'wan_vace' | 'ltx_ic' | 'ltx_ingredients';

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
  | 'wan_animate' //       your recording + a character image → that character performing it (Wan Animate 2)
  | 'wan_control' //       a control video (depth / edges / a 3D blockout) + a reference image → that motion, rendered (Wan 2.2 Fun-Control)
  | 'wan_vace' //          a control video (e.g. a Blender previs) + 1..N reference images (sheets) → that motion, keeping every sheet's identity (Wan 2.2 VACE-Fun)
  | 'h3_ref' //            reference images (character / vehicle / location sheets) + optional reference videos + prompt → clip with sound (MiniMax H3 Ref2VA)
  | 'ltx_ic'; //           a control video (e.g. a Blender previs) + an optional reference image → that motion, rendered with sound (LTX-2.5 IC-LoRA union control)

export type EngineState = 'ready' | 'downloading' | 'off';

export type LoraFamily = 'zimage' | 'wan22' | 'qwen_edit' | 'minimax_h3' | 'ltx2';
export type LoraKind = 'character' | 'location' | 'style' | 'motion' | 'other';

export interface LoraRef {
  loraId: ID;
  strength: number; // 0..2, default 1 (0.8 for character)
  /** Wan 2.2 only: which expert(s) receive the LoRA. Default 'low'. */
  expert?: 'high' | 'low' | 'both';
}

// ───────────────────────────── Assets / jobs ─────────────────────────────

export type AssetKind = 'image' | 'video' | 'audio';
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
  | 'character_turnaround' // Z-Image four-view turnaround sheet (person or prop) on plain mid-grey
  | 'character_face' //       Z-Image 1:1 head-and-shoulders close-up on the same grey (person only)
  | 'scene_reference_sheet' // composites the scene's characters/props/location into one Ingredients sheet
  | 'shot_keyframe'
  | 'shot_video'
  | 'project_export'
  | 'lora_train'
  | 'lora_download'
  | 'character_voice' // design a character's voice from a description, or set it from an uploaded clip
  | 'dialogue_line'; //  render a shot's line in its speaker's voice

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
  /** Who queued it: a person signed in with the password, or an agent using the agent token. */
  actor?: 'human' | 'agent';
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
  /** Reference/input images (asset IDs). qwen_edit: 1..3, qwen_angle: exactly 1, wan_i2v: the start
   *  image plus an optional end image (first/last-frame mode). wan_animate: [characterImageAssetId, drivingVideoAssetId]. */
  inputAssetIds?: ID[];
  /** wan_control / wan_vace / ltx_ic: the control video's asset id. wan_control: inputAssetIds[0] is the optional
   *  reference image. wan_vace: referenceAssetIds are 1..4 sheets composited into one reference image. ltx_ic:
   *  referenceAssetIds[0] is the optional single reference image. Optional for ltx_ic when referenceSheetAssetId
   *  is given (sheet-only mode); combining both stacks two IC-LoRAs (experimental). */
  controlVideoAssetId?: ID;
  /** wan_control / wan_vace / ltx_ic: 'canny' (default) extracts edges from the control video first, right for RGB
   *  footage and gray blockouts; 'none' feeds it as is (depth or edge renders). */
  controlPreprocess?: 'none' | 'canny';
  /** ltx_ic: the union-control IC-LoRA loader strength (0-1.5, default 1.0). Lightricks: 1.0 full adherence,
   *  0.5-0.8 softer, more texture and freedom. Only applies with controlVideoAssetId. */
  controlStrength?: number;
  /** ltx_ic: extra single-image guides (LTXVAddGuide keyframes), each pinning the clip at a point in time.
   *  A keyframe at or past the clip's duration is an end frame. */
  keyframes?: { assetId: ID; timeSec: number; strength?: number }[];
  /** ltx_ic: an image asset built into a static "reference sheet" video (Lightricks/LTX-2.5-22b-IC-LoRA-
   *  Ingredients): the still held for the whole clip at output size/fps, steering identity from a composited
   *  sheet of characters/props/locations. Write the prompt as "Reference sheet: … / Generated video: …" per
   *  the model card; the studio otherwise leaves the prompt as written. */
  referenceSheetAssetId?: ID;
  /** h3_ref: up to 9 image assets the clip keeps identity from (character sheets, vehicle sheets, location plates),
   *  in the order the prompt's <Picture N> labels refer to them. wan_vace: 1..4 sheets composited side by side into
   *  one reference image. ltx_ic: at most 1, the single reference image. */
  referenceAssetIds?: ID[];
  /** h3_ref: up to 3 video assets (<Video N>): a previs cut for camera and timing, footage to edit or continue. */
  referenceVideoAssetIds?: ID[];
  /** h3_ref: 'match' (default) scales references to the render size; 'max' keeps them large for identity, several times slower. */
  referenceImageSize?: 'match' | 'max';
  /** Video: which installed model renders (unset → the studio's default). */
  videoModel?: VideoModelId;
  /** wan_animate: what the person in the recording is doing (helps motion transfer). Optional. */
  motionPrompt?: string;
  /** wan_animate: appearance of the character (e.g. a Cast character's description). `prompt` is the scene/background. */
  characterPrompt?: string;
  // video
  durationSec?: number; // seconds; the range depends on the video model (see VIDEO_DURATIONS)
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
  /** Placed by the studio (see aimCamera): re-aimed when the shot's cast, size or blocking changes.
   *  Moving the camera by hand clears it. */
  auto?: boolean;
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

/** A character's voice (Qwen3-TTS): a reference clip every line is cloned from, so it stays the same voice. */
export interface CharacterVoice {
  source: 'designed' | 'cloned';
  /** Designed voices: what the voice sounds like, e.g. "gravelly, tired man in his 60s, slow drawl". */
  description?: string;
  /** The reference clip (an audio asset). */
  refAssetId: ID;
  /** What is said in the reference clip. Empty for an uploaded clip without a transcript (less faithful clone). */
  refText: string;
  /** Qwen3-TTS language name ("English", …) or "Auto". */
  language: string;
  updatedAt: ISODate;
}

export interface Character {
  id: ID;
  name: string;
  /** Appearance prompt fragment, e.g. "a woman in her 30s with short silver hair, black trench coat". */
  description: string;
  referenceAssetIds: ID[]; // first = primary (used for compositing)
  /** 'person' (default) or 'prop' (a vehicle, object, etc.): props skip the face-close-up sheet and speaker
   *  assignment, and get product-style turnaround panels on a scene reference sheet instead of a portrait. */
  kind?: 'person' | 'prop';
  loraId?: ID;
  triggerWord?: string;
  voice?: CharacterVoice;
  /** Suggested voice description (from the AI breakdown) not generated yet. */
  voiceHint?: string;
  /** Sheet-ready reference images (Z-Image, plain light-grey #C8C8C8 backdrop — SHEET_BACKDROP), set by the character_face /
   *  character_turnaround jobs (or by hand, pointing at any existing asset id). The scene reference-sheet
   *  builder (scene_reference_sheet) reads these first, falling back to referenceAssetIds[0]. */
  sheetAssets?: { face?: ID; turnaround?: ID };
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
  /** Export colour grade: 'none' (default, neutral) or 'film' (a subtle warm/S-curve/grain pass; see
   *  project_export.ts FILM_GRADE_FILTER). */
  grade?: 'none' | 'film';
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
  /** A composited "Ingredients" reference sheet (characters + props + location) built by the
   *  scene_reference_sheet job, or pointed at any uploaded image by hand. */
  referenceSheetAssetId?: ID;
  /** The two-part LTX Ingredients prompt's "Reference sheet: …" panel description, auto-written by
   *  scene_reference_sheet from each panel's position, and editable afterwards. */
  referenceSheetText?: string;
  /** The scene's Blender previs playblast (a video asset): drives camera/timing for every shot in it. */
  previsAssetId?: ID;
  /** Optional depth pass of the same previs (near = bright); preferred over previsAssetId itself as the LTX
   *  control video when present (controlPreprocess 'none' instead of 'canny'). */
  previsDepthAssetId?: ID;
  /** Cut times in seconds, one less than the scene's shot count, marking where each shot after the first
   *  begins in the previs; unset (or mismatched) falls back to cumulative shot durationSec. Setting this via
   *  PATCH /api/scenes/:id recomputes every shot's durationSec from the new cuts. */
  previsCuts?: number[];
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
  /** Who says the line; unset → the one character in frame (see speakerFor). */
  dialogueSpeakerId?: ID;
  /** The line rendered in the speaker's voice (audio asset), and what it was rendered from (see dialogueKey). */
  dialogueAudioAssetId?: ID;
  dialogueAudioKey?: string;
  shotSize: ShotSize;
  cameraMove: CameraMoveId;
  /** Explicit elevation override; otherwise derived from camera height. */
  elevation?: Elevation;
  camera: MapCamera;
  characterIds: ID[];
  /** Per-shot overrides of scene blocking. */
  blocking?: CharacterMark[];
  durationSec: number; // seconds, default 5; the range depends on the video model (see VIDEO_DURATIONS)
  /** User overrides of the auto-built prompts (undefined → auto). */
  keyframePrompt?: string;
  motionPrompt?: string;
  keyframeMode: 'auto' | 'compose' | 'generate';
  loras?: LoraRef[];
  seed?: number;
  keyframeAssetId?: ID;
  keyframeCandidates: ID[]; // previous keyframes the user can switch back to
  /** Optional last frame of the clip (first/last-frame mode on every video model): with a previs
   *  render or a second keyframe, it holds the camera move and the end composition. */
  endKeyframeAssetId?: ID;
  /** Which installed video model animates this shot; unset → the studio's default (see pickVideoModel). */
  videoModel?: VideoModelId;
  /** Clip size: 'fast' (≈480p, the default) or 'hd' (720p, several times slower). */
  quality?: VideoQuality;
  /** Optional video asset whose motion the clip follows frame by frame (Wan 2.2 Fun-Control): a depth or edge
   *  render, or any footage. The keyframe is then the reference image for the look. */
  controlVideoAssetId?: ID;
  /** How the control video is read (see GenerateRequest.controlPreprocess). */
  controlPreprocess?: 'none' | 'canny';
  /** Reference images (sheets) the clip keeps identity from; with the reference model installed the shot renders
   *  reference-to-video instead of from its keyframe (see GenerateRequest.referenceAssetIds). */
  referenceAssetIds?: ID[];
  /** Reference video (<Video 1>): a previs cut for camera moves and timing. */
  referenceVideoAssetId?: ID;
  /** LTX-2.5 IC-LoRA union-control loader strength for this shot's previs-driven render (see shot_video.ts's
   *  scene-previs branch). Default 0.7 (Lightricks: 1.0 full adherence, 0.5-0.8 softer). */
  controlStrength?: number;
  /** When true and keyframeAssetId is set, the scene-previs render also pins the shot's keyframe as an
   *  LTX-2.5 keyframe guide at time 0 (strength 0.7), alongside the previs/sheet guides. Default false. */
  pinKeyframe?: boolean;
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
  characters: { name: string; description: string; voice?: string; existingId?: ID }[];
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

/** GET /api/agent-token: whether agents can sign in with the token. Never includes the token itself. */
export interface AgentAccess {
  enabled: boolean;
  /** off: AGENT_ACCESS=false; env: STUDIO_AGENT_TOKEN; file: generated on the pod at `path`. */
  source: 'off' | 'env' | 'file';
  path?: string;
}

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

/** The model that renders Video/Animate/storyboard clips. */
export type VideoModelId = 'wan' | 'minimax_h3' | 'ltx_2_5';

export interface SystemInfo {
  version: string;
  comfy: { online: boolean; queueRemaining: number; vramTotalMB?: number; vramFreeMB?: number; gpuName?: string };
  models: ModelGroupStatus[];
  /** Engine → available (all its model files present). */
  engines: Record<EngineId, boolean>;
  /** Engine → 'ready' (usable), 'downloading' (in this pod's install plan, not done yet) or 'off'
   *  (not part of the chosen preset: hide it in the UI). */
  engineState: Record<EngineId, EngineState>;
  /** Which model renders Video/Animate/storyboard clips. MiniMax H3 (DOWNLOAD_MINIMAX_MODELS) and LTX-2.5
   *  (DOWNLOAD_LTX_MODELS) are opt-in; H3's license requires showing "Powered by MiniMax H3" when it is in use. */
  videoModel: VideoModelId | null;
  /** Every video model whose files are installed, so a shot can pick one when several are (videoModel is
   *  the default among them). */
  videoModels: VideoModelId[];
  /** Character voices (Qwen3-TTS sidecar): 'ready' when its models are downloaded and it answers. */
  voice: EngineState;
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
  | { type: 'scene'; scene: Scene }
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

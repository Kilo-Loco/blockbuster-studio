// Typed fetch wrapper against docs/API.md. 401 → redirect to /login.
import type {
  ApiError,
  Asset,
  AssetKind,
  BreakdownDraft,
  Character,
  GenerateRequest,
  Job,
  Lora,
  LoraImportRequest,
  LoraTrainRequest,
  Location,
  Paged,
  Project,
  ProjectDetail,
  Scene,
  Settings,
  SettingsUpdate,
  Shot,
  Style,
  SystemInfo,
  AngleSpec,
  ID,
} from '@shared/types';

class ApiClientError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, body: ApiError) {
    super(body.error || `Request failed (${status})`);
    this.status = status;
    this.detail = body.detail;
  }
}

let redirecting = false;

async function request<T>(method: string, path: string, body?: unknown, opts?: { isForm?: boolean }): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    if (opts?.isForm) {
      init.body = body as FormData;
    } else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, init);
  if (res.status === 401) {
    if (!redirecting && !location.pathname.startsWith('/login')) {
      redirecting = true;
      location.href = '/login';
    }
    throw new ApiClientError(401, { error: 'unauthorized' });
  }
  if (!res.ok) {
    let payload: ApiError = { error: `Request failed (${res.status})` };
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiClientError(res.status, payload);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const api = {
  // Auth & system
  login: (password: string) => request<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  session: () => request<{ authenticated: boolean }>('GET', '/api/session'),
  health: () => request<{ ok: true; version: string }>('GET', '/api/health'),
  system: () => request<SystemInfo>('GET', '/api/system'),
  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (body: SettingsUpdate) => request<Settings>('PUT', '/api/settings', body),

  // Media & assets
  upload: (file: File, projectId?: ID) => {
    const fd = new FormData();
    fd.set('file', file);
    if (projectId) fd.set('projectId', projectId);
    return request<Asset>('POST', '/api/uploads', fd, { isForm: true });
  },
  assets: (params: { kind?: AssetKind; favorite?: boolean; projectId?: ID; shotId?: ID; q?: string; cursor?: string; limit?: number }) =>
    request<Paged<Asset>>('GET', `/api/assets${qs({ ...params, favorite: params.favorite ? 1 : undefined })}`),
  asset: (id: ID) => request<Asset>('GET', `/api/assets/${id}`),
  updateAsset: (id: ID, body: { favorite?: boolean }) => request<Asset>('PATCH', `/api/assets/${id}`, body),
  deleteAsset: (id: ID) => request<{ ok: true }>('DELETE', `/api/assets/${id}`),

  // Generation & jobs
  generate: (body: GenerateRequest) => request<Job>('POST', '/api/generate', body),
  jobs: (params: { active?: boolean; limit?: number } = {}) =>
    request<Job[]>('GET', `/api/jobs${qs({ active: params.active ? 1 : undefined, limit: params.limit })}`),
  job: (id: ID) => request<Job>('GET', `/api/jobs/${id}`),
  cancelJob: (id: ID) => request<Job>('POST', `/api/jobs/${id}/cancel`),
  retryJob: (id: ID) => request<Job>('POST', `/api/jobs/${id}/retry`),
  enhance: (prompt: string, target: 'image' | 'video') => request<{ prompt: string }>('POST', '/api/ai/enhance', { prompt, target }),

  // Library
  characters: () => request<Character[]>('GET', '/api/characters'),
  createCharacter: (body: Partial<Character>) => request<Character>('POST', '/api/characters', body),
  character: (id: ID) => request<Character>('GET', `/api/characters/${id}`),
  updateCharacter: (id: ID, body: Partial<Character>) => request<Character>('PATCH', `/api/characters/${id}`, body),
  deleteCharacter: (id: ID) => request<{ ok: true }>('DELETE', `/api/characters/${id}`),
  characterReferences: (id: ID, body: { count?: number; prompt?: string }) => request<Job>('POST', `/api/characters/${id}/references`, body),

  locations: () => request<Location[]>('GET', '/api/locations'),
  createLocation: (body: Partial<Location>) => request<Location>('POST', '/api/locations', body),
  location: (id: ID) => request<Location>('GET', `/api/locations/${id}`),
  updateLocation: (id: ID, body: Partial<Location>) => request<Location>('PATCH', `/api/locations/${id}`, body),
  deleteLocation: (id: ID) => request<{ ok: true }>('DELETE', `/api/locations/${id}`),
  locationEstablishing: (id: ID, body: { prompt?: string }) => request<Job>('POST', `/api/locations/${id}/establishing`, body),
  locationAngle: (id: ID, angle: AngleSpec) => request<Job>('POST', `/api/locations/${id}/angles`, { angle }),

  styles: () => request<Style[]>('GET', '/api/styles'),
  createStyle: (body: Partial<Style>) => request<Style>('POST', '/api/styles', body),
  updateStyle: (id: ID, body: Partial<Style>) => request<Style>('PATCH', `/api/styles/${id}`, body),
  deleteStyle: (id: ID) => request<{ ok: true }>('DELETE', `/api/styles/${id}`),

  loras: (family?: string) => request<Lora[]>('GET', `/api/loras${qs({ family })}`),
  importLora: (body: LoraImportRequest) => request<Lora>('POST', '/api/loras/import', body),
  uploadLora: (file: File, family: string, kind: string, name: string, triggerWord?: string) => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('family', family);
    fd.set('kind', kind);
    fd.set('name', name);
    if (triggerWord) fd.set('triggerWord', triggerWord);
    return request<Lora>('POST', '/api/loras/upload', fd, { isForm: true });
  },
  trainLora: (body: LoraTrainRequest) => request<Job>('POST', '/api/loras/train', body),
  updateLora: (id: ID, body: Partial<Lora>) => request<Lora>('PATCH', `/api/loras/${id}`, body),
  deleteLora: (id: ID) => request<{ ok: true }>('DELETE', `/api/loras/${id}`),

  // Projects / storyboard
  projects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (body: { name: string; logline?: string; aspect?: string }) => request<Project>('POST', '/api/projects', body),
  project: (id: ID) => request<ProjectDetail>('GET', `/api/projects/${id}`),
  updateProject: (id: ID, body: Partial<Project>) => request<Project>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: ID) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),

  createScene: (projectId: ID, body: Partial<Scene>) => request<Scene>('POST', `/api/projects/${projectId}/scenes`, body),
  updateScene: (id: ID, body: Partial<Scene>) => request<Scene>('PATCH', `/api/scenes/${id}`, body),
  deleteScene: (id: ID) => request<{ ok: true }>('DELETE', `/api/scenes/${id}`),
  reorderScenes: (projectId: ID, sceneIds: ID[]) => request<ProjectDetail>('POST', `/api/projects/${projectId}/scenes/reorder`, { sceneIds }),

  createShot: (sceneId: ID, body: Partial<Shot>) => request<Shot>('POST', `/api/scenes/${sceneId}/shots`, body),
  updateShot: (id: ID, body: Partial<Shot>) => request<Shot>('PATCH', `/api/shots/${id}`, body),
  deleteShot: (id: ID) => request<{ ok: true }>('DELETE', `/api/shots/${id}`),
  reorderShots: (sceneId: ID, shotIds: ID[]) => request<ProjectDetail>('POST', `/api/scenes/${sceneId}/shots/reorder`, { shotIds }),
  duplicateShot: (id: ID) => request<Shot>('POST', `/api/shots/${id}/duplicate`),
  shotPreview: (id: ID) =>
    request<{
      angle: AngleSpec & { azimuthDeg: number; elevationDeg: number };
      placements: unknown[];
      keyframePrompt: string;
      motionPrompt: string;
      mode: 'compose' | 'generate';
    }>('GET', `/api/shots/${id}/preview`),
  shotKeyframe: (id: ID) => request<Job>('POST', `/api/shots/${id}/keyframe`),
  shotVideo: (id: ID) => request<Job>('POST', `/api/shots/${id}/video`),
  selectShotCandidate: (id: ID, body: { keyframeAssetId?: ID } | { videoAssetId?: ID }) => request<Shot>('POST', `/api/shots/${id}/select`, body),

  renderProject: (id: ID, body: { what: 'keyframes' | 'videos' | 'all'; onlyMissing?: boolean }) =>
    request<Job[]>('POST', `/api/projects/${id}/render`, body),
  exportProject: (id: ID) => request<Job>('POST', `/api/projects/${id}/export`),
  breakdown: (id: ID, script: string) => request<BreakdownDraft>('POST', `/api/projects/${id}/breakdown`, { script }),
  applyBreakdown: (id: ID, draft: BreakdownDraft) => request<ProjectDetail>('POST', `/api/projects/${id}/breakdown/apply`, draft),

  // Bulk downloads
  downloadAssets: (body: { assetIds: ID[] } | { all: true }) =>
    request<{ url: string; count: number }>('POST', '/api/downloads', body),
  backupProject: (id: ID) => request<{ url: string; count: number }>('POST', `/api/projects/${id}/backup`),
};

export { ApiClientError };

export function mediaUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith('/media') || path.startsWith('http') ? path : `/media/${path.replace(/^\/+/, '')}`;
}

/** Kick off a browser-native download via a hidden `<a download>` so its download manager
 *  (not our JS heap) handles the transfer — required for multi-GB ZIPs. */
export function startDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

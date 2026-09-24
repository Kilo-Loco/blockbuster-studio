// Environment configuration with sensible dev defaults.
// Server code imports shared files with RELATIVE paths (esbuild bundle uses --packages=external).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}
function envOpt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const PORT = Number(envStr('PORT', '3000'));
export const HOST = envStr('HOST', '0.0.0.0');
export const COMFY_URL = envStr('COMFY_URL', 'http://127.0.0.1:8188');

export const DATA_DIR = path.resolve(envStr('DATA_DIR', './.data'));
export const MODELS_DIR = path.resolve(envStr('MODELS_DIR', path.join(DATA_DIR, '..', 'models')));

// If set, read ComfyUI outputs directly from disk instead of hitting /view.
export const COMFY_INPUT_DIR = envOpt('COMFY_INPUT_DIR');
export const COMFY_OUTPUT_DIR = envOpt('COMFY_OUTPUT_DIR');

export const MODELS_STATUS_FILE = envStr('MODELS_STATUS_FILE', path.join(DATA_DIR, 'models-status.json'));
export const AI_TOOLKIT_DIR = envStr('AI_TOOLKIT_DIR', '/workspace/ai-toolkit');
export const WEB_DIST = path.resolve(envStr('WEB_DIST', 'dist/web'));

export const ANTHROPIC_API_KEY = envOpt('ANTHROPIC_API_KEY');
export const OPENAI_API_KEY = envOpt('OPENAI_API_KEY');
export const OPENAI_BASE_URL = envOpt('OPENAI_BASE_URL');
export const OPENAI_MODEL = envOpt('OPENAI_MODEL');
export const CIVITAI_TOKEN = envOpt('CIVITAI_TOKEN');
export const HF_TOKEN = envOpt('HF_TOKEN');
export const RUNPOD_POD_ID = envOpt('RUNPOD_POD_ID');

export const COMFY_MOCK = process.env.COMFY_MOCK === '1';

// Ensure DATA_DIR exists before anything else touches it (db, password file, session secret).
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true });

// The public Runpod template ships STUDIO_PASSWORD=change-me so the field is visible on the deploy
// page (Runpod drops empty env vars from public templates). An unchanged placeholder counts as unset:
// the server then generates a random password and prints it to the pod logs.
const rawPassword = envOpt('STUDIO_PASSWORD');
export const STUDIO_PASSWORD = rawPassword && !/^(change[-_ ]?me|changeme|your[-_ ]?password)$/i.test(rawPassword.trim()) ? rawPassword : undefined;

function loadOrCreateSessionSecret(): string {
  const file = path.join(DATA_DIR, 'session-secret.txt');
  const fromEnv = envOpt('SESSION_SECRET');
  if (fromEnv) return fromEnv;
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // fall through to generate
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const SESSION_SECRET = loadOrCreateSessionSecret();

export const VERSION = '0.1.0';

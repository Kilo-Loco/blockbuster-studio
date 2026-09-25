// Validates every workflow builder against a real ComfyUI's /prompt validation.
// ComfyUI checks node types, input names/types and that every model/LoRA/image filename exists,
// so point it at an instance with (placeholder) model files present. Accepted prompts are removed
// from the queue immediately, so nothing is actually executed.
//
//   COMFY_URL=http://127.0.0.1:8199 VALIDATE_IMAGE=example.png VALIDATE_LORA=test_character.safetensors npm run validate:workflows

import { buildMiniMaxH3, buildQwenEdit, buildWanAnimate2, buildWanI2V, buildWanT2V, buildZImage, h3FramesForDuration, type ApiWorkflow } from './workflows';
import { WAN_NEGATIVE } from '../../shared/presets';

const COMFY = process.env.COMFY_URL ?? 'http://127.0.0.1:8199';
const IMG = process.env.VALIDATE_IMAGE ?? 'example.png';
const LORA = process.env.VALIDATE_LORA ?? 'test_character.safetensors';
const VID = process.env.VALIDATE_VIDEO ?? 'drive.mp4';

const wanBase = { prompt: 'a cat walks', negativePrompt: WAN_NEGATIVE, width: 832, height: 480, length: 81, fps: 16, seed: 42 };

const cases: [string, ApiWorkflow][] = [
  ['zimage', buildZImage({ prompt: 'a cat', width: 1344, height: 768, seed: 1 })],
  ['zimage+lora+batch', buildZImage({ prompt: 'a cat', width: 1024, height: 1024, seed: 1, batch: 4, loras: [{ filename: LORA, strength: 0.8 }] })],
  ['qwen_edit 1 image', buildQwenEdit({ images: [IMG], prompt: 'make it night', seed: 3 })],
  ['qwen_edit 3 images', buildQwenEdit({ images: [IMG, IMG, IMG], prompt: 'put the person from image 2 and image 3 into image 1', seed: 3, loras: [{ filename: LORA, strength: 1 }] })],
  ['qwen_edit slow', buildQwenEdit({ images: [IMG], prompt: 'x', seed: 3, fast: false })],
  ['qwen_angle', buildQwenEdit({ images: [IMG], prompt: '<sks> front-right quarter view elevated shot medium shot', seed: 3, angles: true })],
  ['wan_i2v fast', buildWanI2V({ ...wanBase, startImage: IMG })],
  ['wan_i2v slow + loras', buildWanI2V({ ...wanBase, startImage: IMG, fast: false, loras: [{ filename: LORA, strength: 0.8, expert: 'both' }] })],
  ['wan_flf2v', buildWanI2V({ ...wanBase, startImage: IMG, endImage: IMG })],
  ['wan_t2v', buildWanT2V({ ...wanBase, loras: [{ filename: LORA, strength: 1 }] })],
  ['wan_animate 1 seg', buildWanAnimate2({ referenceImage: IMG, drivingVideo: VID, prompt: 'a knight in armor, castle courtyard', motionPrompt: 'a person dancing', negativePrompt: WAN_NEGATIVE, width: 480, height: 832, segments: 1, seed: 5 })],
  ['minimax_h3 t2v', buildMiniMaxH3({ prompt: 'a cat walks. Audio: rain', width: 864, height: 480, length: h3FramesForDuration(5), seed: 7 })],
  ['minimax_h3 i2v', buildMiniMaxH3({ prompt: 'a cat walks', width: 864, height: 480, length: h3FramesForDuration(5), seed: 7, startImage: IMG })],
  ['minimax_h3 flf2v', buildMiniMaxH3({ prompt: 'a cat walks', width: 1280, height: 736, length: h3FramesForDuration(7), seed: 7, startImage: IMG, endImage: IMG })],
  ['wan_animate 3 seg', buildWanAnimate2({ referenceImage: IMG, drivingVideo: VID, prompt: 'a knight', motionPrompt: 'a person dancing', negativePrompt: WAN_NEGATIVE, width: 832, height: 480, segments: 3, seed: 5 })],
];

let failed = 0;
for (const [name, prompt] of cases) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'validator' }),
  });
  const body = (await res.json()) as { prompt_id?: string; error?: unknown; node_errors?: Record<string, unknown> };
  const ok = res.ok && body.prompt_id && Object.keys(body.node_errors ?? {}).length === 0;
  if (body.prompt_id) {
    await fetch(`${COMFY}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [body.prompt_id] }) });
  }
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    failed++;
    console.log(JSON.stringify({ error: body.error, node_errors: body.node_errors }, null, 2));
  }
}
await fetch(`${COMFY}/interrupt`, { method: 'POST' });
if (failed) {
  console.error(`${failed} workflow(s) failed validation`);
  process.exit(1);
}
console.log('All workflows valid.');

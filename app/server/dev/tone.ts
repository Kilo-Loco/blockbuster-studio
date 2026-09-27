// Test/dev stand-in for speech: a quiet tone WAV (24 kHz mono, 16-bit) whose length follows the text.
export const SAMPLE_RATE = 24_000;

/** ~14 characters a second, like unhurried speech; a quiet 220 Hz tone stands in for the voice. */
export function toneWav(text: string, hz = 220): Buffer {
  const seconds = Math.max(1, Math.min(30, text.length / 14));
  const n = Math.round(seconds * SAMPLE_RATE);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 6000), 44 + i * 2);
  return buf;
}

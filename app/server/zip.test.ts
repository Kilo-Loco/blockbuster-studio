import { describe, expect, it } from 'vitest';
import { ZipArchive } from 'archiver';
import { readZip } from './zip';

async function zipOf(entries: { name: string; content: Buffer | string }[], store: boolean): Promise<Buffer> {
  const archive = new ZipArchive({ store });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const e of entries) archive.append(e.content, { name: e.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

describe('readZip', () => {
  const entries = [
    { name: 'character.json', content: '{"a":1}' },
    { name: 'assets/x.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'lora/big.safetensors', content: Buffer.alloc(100_000, 7) },
  ];
  it('reads stored archives (what the studio writes)', async () => {
    const files = readZip(await zipOf(entries, true));
    expect(files.map((f) => f.name)).toEqual(entries.map((e) => e.name));
    expect(files[0]!.bytes.toString()).toBe('{"a":1}');
    expect(files[1]!.bytes).toEqual(entries[1]!.content);
    expect(files[2]!.bytes.length).toBe(100_000);
  });
  it('reads deflated archives too', async () => {
    const files = readZip(await zipOf(entries, false));
    expect(files[2]!.bytes.equals(entries[2]!.content as Buffer)).toBe(true);
  });
  it('rejects something that is not a zip', () => {
    expect(() => readZip(Buffer.from('hello, not a zip at all'))).toThrow(/Not a ZIP/);
  });
});

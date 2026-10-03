// A small ZIP reader for archives the studio itself wrote (character packs): walks the central directory and
// returns each file's bytes. Stored and deflated entries only, no encryption, no ZIP64 (packs stay well under
// 4 GB). archiver (the writer) is a dependency already; adding a reader library for this would be more code
// than these few lines.
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipFile {
  name: string;
  bytes: Buffer;
}

/** Every file in the archive (directories skipped), in central-directory order. */
export function readZip(buf: Buffer): ZipFile[] {
  // The end-of-central-directory record is at the very end, before an optional comment (≤ 65535 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files: ZipFile[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('Corrupt ZIP (central directory)');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('Corrupt ZIP (local header)');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) files.push({ name, bytes: Buffer.from(data) });
    else if (method === 8) files.push({ name, bytes: zlib.inflateRawSync(data) });
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
  }
  return files;
}

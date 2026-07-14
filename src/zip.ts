/**
 * Minimal ZIP central-directory reader. outtake never inflates file data —
 * it lists names and sizes straight from the central directory at the end
 * of the archive, so scanning a 50 GB Takeout part reads only a few MB.
 *
 * Supports the fields Takeout exports actually use: stored + deflated
 * entries, UTF-8 names (flag bit 11), directory markers, archive comments,
 * and ZIP64 (Takeout parts above 4 GB, or with >65535 entries).
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

import type { ArchiveEntry } from "./types.js";

/** Raised for structurally broken or non-ZIP input. */
export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;

/** Fixed part of the EOCD record, before the variable-length comment. */
const EOCD_MIN = 22;
/** Max EOCD scan window: fixed part + maximum comment length. */
const EOCD_MAX = EOCD_MIN + 0xffff;
const EOCD64_LOCATOR_LEN = 20;
const EOCD64_MIN = 56;
const CENTRAL_MIN = 46;

interface Eocd {
  entryCount: number;
  cdSize: number;
  cdOffset: number;
}

/**
 * Locate the End Of Central Directory record inside the tail of the file.
 * Scans backwards so an archive comment containing the magic bytes cannot
 * fool it: a candidate only wins if its comment length reaches file end.
 */
export function findEocd(tail: Buffer, tailStart: number, fileSize: number): { eocd: Eocd; eocdPos: number } {
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    if (tailStart + i + EOCD_MIN + commentLen !== fileSize) continue;
    return {
      eocdPos: tailStart + i,
      eocd: {
        entryCount: tail.readUInt16LE(i + 10),
        cdSize: tail.readUInt32LE(i + 12),
        cdOffset: tail.readUInt32LE(i + 16),
      },
    };
  }
  throw new ZipError("no end-of-central-directory record found (not a ZIP file, or truncated)");
}

/** Read the ZIP64 EOCD record when the classic one carries overflow markers. */
function readZip64Eocd(fd: number, tail: Buffer, tailStart: number, eocdPos: number): Eocd {
  const locatorPos = eocdPos - EOCD64_LOCATOR_LEN;
  if (locatorPos < 0) throw new ZipError("ZIP64 markers present but no ZIP64 locator");
  const locator = readAt(fd, locatorPos, EOCD64_LOCATOR_LEN, tail, tailStart);
  if (locator.readUInt32LE(0) !== EOCD64_LOCATOR_SIG) {
    throw new ZipError("ZIP64 markers present but the ZIP64 locator signature is wrong");
  }
  const eocd64Offset = Number(locator.readBigUInt64LE(8));
  const rec = readAt(fd, eocd64Offset, EOCD64_MIN, tail, tailStart);
  if (rec.readUInt32LE(0) !== EOCD64_SIG) {
    throw new ZipError("ZIP64 end-of-central-directory signature is wrong");
  }
  return {
    entryCount: Number(rec.readBigUInt64LE(32)),
    cdSize: Number(rec.readBigUInt64LE(40)),
    cdOffset: Number(rec.readBigUInt64LE(48)),
  };
}

/** Read `len` bytes at `pos`, serving from the already-read tail when possible. */
function readAt(fd: number, pos: number, len: number, tail: Buffer, tailStart: number): Buffer {
  if (pos >= tailStart && pos + len <= tailStart + tail.length) {
    return tail.subarray(pos - tailStart, pos - tailStart + len);
  }
  const buf = Buffer.alloc(len);
  const got = readSync(fd, buf, 0, len, pos);
  if (got !== len) throw new ZipError("unexpected end of file while reading ZIP structures");
  return buf;
}

/**
 * Parse a central-directory buffer into entries. Exported separately so the
 * structural logic is unit-testable without a file descriptor.
 */
export function parseCentralDirectory(cd: Buffer, entryCount: number): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let pos = 0;
  for (let n = 0; n < entryCount; n++) {
    if (pos + CENTRAL_MIN > cd.length) {
      throw new ZipError(`central directory truncated at entry ${n + 1} of ${entryCount}`);
    }
    if (cd.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new ZipError(`bad central-directory signature at entry ${n + 1} of ${entryCount}`);
    }
    const flags = cd.readUInt16LE(pos + 8);
    let size = cd.readUInt32LE(pos + 24);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    const externalAttrs = cd.readUInt32LE(pos + 38);
    const nameStart = pos + CENTRAL_MIN;
    if (nameStart + nameLen + extraLen + commentLen > cd.length) {
      throw new ZipError(`central directory truncated inside entry ${n + 1}`);
    }
    // Flag bit 11 marks UTF-8; Takeout always sets it. Names without the
    // flag are decoded as Latin-1, which is lossless for byte inspection.
    const utf8 = (flags & 0x0800) !== 0;
    const path = cd.toString(utf8 ? "utf8" : "latin1", nameStart, nameStart + nameLen);

    if (size === 0xffffffff) {
      size = readZip64Size(cd, nameStart + nameLen, extraLen, size);
    }
    const isDirectory = path.endsWith("/") || (externalAttrs >>> 16 & 0o170000) === 0o040000;
    entries.push({ path, size: isDirectory ? 0 : size, isDirectory });
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Pull the 64-bit uncompressed size out of the ZIP64 extra field (id 0x0001).
 * Per spec the field only contains values whose 32-bit slot overflowed, in
 * fixed order: uncompressed size, compressed size, local offset, disk start —
 * so when we are called, the uncompressed size is always the first value.
 */
function readZip64Size(cd: Buffer, extraStart: number, extraLen: number, fallback: number): number {
  let p = extraStart;
  const end = extraStart + extraLen;
  while (p + 4 <= end) {
    const id = cd.readUInt16LE(p);
    const len = cd.readUInt16LE(p + 2);
    if (id === 0x0001 && p + 4 + 8 <= end) {
      return Number(cd.readBigUInt64LE(p + 4));
    }
    p += 4 + len;
  }
  return fallback;
}

/**
 * List the entries of a ZIP file from disk. Reads only the tail of the file
 * plus the central directory; file data is never touched.
 */
export function readZipEntries(filePath: string): ArchiveEntry[] {
  const fd = openSync(filePath, "r");
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize < EOCD_MIN) throw new ZipError("file too small to be a ZIP archive");
    const tailLen = Math.min(fileSize, EOCD_MAX);
    const tailStart = fileSize - tailLen;
    const tail = Buffer.alloc(tailLen);
    if (readSync(fd, tail, 0, tailLen, tailStart) !== tailLen) {
      throw new ZipError("unexpected end of file while reading ZIP tail");
    }
    let { eocd, eocdPos } = findEocd(tail, tailStart, fileSize);
    if (eocd.entryCount === 0xffff || eocd.cdSize === 0xffffffff || eocd.cdOffset === 0xffffffff) {
      eocd = readZip64Eocd(fd, tail, tailStart, eocdPos);
    }
    if (eocd.cdOffset + eocd.cdSize > fileSize) {
      throw new ZipError("central directory extends past end of file (truncated download?)");
    }
    const cd = readAt(fd, eocd.cdOffset, eocd.cdSize, tail, tailStart);
    return parseCentralDirectory(cd, eocd.entryCount);
  } finally {
    closeSync(fd);
  }
}

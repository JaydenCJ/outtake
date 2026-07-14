/**
 * Streaming tar lister for `.tgz` / `.tar` Takeout exports. Headers are
 * parsed and file bodies are skipped without buffering, so listing a large
 * gzipped export uses constant memory (only decompression, never storage).
 *
 * Handles the header variants real exports contain: ustar name+prefix,
 * GNU long names (type `L`), pax extended headers (`x`, `path`/`size`
 * overrides), and GNU base-256 sizes for files over 8 GB.
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

import type { ArchiveEntry } from "./types.js";

/** Raised for structurally broken or non-tar input. */
export class TarError extends Error {}

const BLOCK = 512;

/** Parse an octal or GNU base-256 numeric tar field. */
export function parseTarNumber(buf: Buffer): number {
  const first = buf[0] ?? 0;
  if ((first & 0x80) !== 0) {
    // GNU base-256: big-endian binary with the top bit of byte 0 set.
    let value = first & 0x7f;
    for (let i = 1; i < buf.length; i++) value = value * 256 + (buf[i] ?? 0);
    return value;
  }
  const text = buf.toString("latin1").replace(/\0/g, "").trim();
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  if (Number.isNaN(value)) throw new TarError(`bad numeric field: ${JSON.stringify(text)}`);
  return value;
}

/** NUL-terminated string field. */
function str(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.toString("utf8", 0, nul === -1 ? len : nul);
}

/** Verify the header checksum (sum of bytes with the chksum field as spaces). */
function checksumOk(header: Buffer): boolean {
  const stored = parseTarNumber(header.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i] ?? 0;
  }
  return sum === stored;
}

/** Parse `len key=value\n` records from a pax extended header body. */
export function parsePaxRecords(body: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos);
    if (space === -1) break;
    const recLen = Number.parseInt(body.toString("latin1", pos, space), 10);
    if (!Number.isInteger(recLen) || recLen <= 0 || pos + recLen > body.length) break;
    const record = body.toString("utf8", space + 1, pos + recLen - 1); // strip trailing \n
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    pos += recLen;
  }
  return out;
}

/**
 * Incremental tar parser. Feed it chunks with `push()`, collect entries,
 * call `finish()` at end of stream. Skipped bodies are only counted, never
 * retained; the small bodies of `L`/`x` records are the only buffered data.
 */
export class TarScanner {
  readonly entries: ArchiveEntry[] = [];
  private pending: Buffer = Buffer.alloc(0);
  private skip = 0;
  /** Body bytes to collect for the next meta record (padded length). */
  private collect = 0;
  private collectKind: "L" | "x" | null = null;
  private collected: Buffer[] = [];
  private nextName: string | null = null;
  private nextPax: Map<string, string> | null = null;
  private zeroBlocks = 0;
  private done = false;
  private sawHeader = false;

  push(chunk: Buffer): void {
    if (this.done) return;
    let data = chunk;
    // Fast path: burn body bytes we are skipping without concatenating.
    if (this.skip > 0) {
      const burn = Math.min(this.skip, data.length);
      this.skip -= burn;
      data = data.subarray(burn);
      if (data.length === 0) return;
    }
    this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    while (!this.done) {
      if (this.skip > 0) {
        const burn = Math.min(this.skip, this.pending.length);
        this.skip -= burn;
        this.pending = this.pending.subarray(burn);
        if (this.skip > 0) return;
      }
      if (this.collect > 0) {
        if (this.pending.length < this.collect) return;
        this.collected.push(this.pending.subarray(0, this.collect));
        this.pending = this.pending.subarray(this.collect);
        this.absorbCollected();
      }
      if (this.pending.length < BLOCK) return;
      const header = this.pending.subarray(0, BLOCK);
      this.pending = this.pending.subarray(BLOCK);
      this.header(header);
    }
  }

  private absorbCollected(): void {
    const body = Buffer.concat(this.collected);
    if (this.collectKind === "L") {
      const nul = body.indexOf(0);
      this.nextName = body.toString("utf8", 0, nul === -1 ? body.length : nul);
    } else if (this.collectKind === "x") {
      this.nextPax = parsePaxRecords(body);
    }
    this.collect = 0;
    this.collectKind = null;
    this.collected = [];
  }

  private header(header: Buffer): void {
    if (isZeroBlock(header)) {
      this.zeroBlocks += 1;
      if (this.zeroBlocks >= 2) this.done = true;
      return;
    }
    this.zeroBlocks = 0;
    if (!checksumOk(header)) {
      throw new TarError(
        this.sawHeader ? "tar header checksum mismatch (corrupted archive?)" : "not a tar archive",
      );
    }
    this.sawHeader = true;

    const typeflag = String.fromCharCode(header[156] ?? 0);
    const rawSize = parseTarNumber(header.subarray(124, 136));
    const padded = Math.ceil(rawSize / BLOCK) * BLOCK;

    if (typeflag === "L" || typeflag === "x") {
      // Meta record: its body describes the NEXT real entry.
      this.collect = padded;
      this.collectKind = typeflag;
      if (this.collect === 0) this.absorbCollected();
      return;
    }
    if (typeflag === "K" || typeflag === "g") {
      // Long linkname / global pax: irrelevant to an inventory, skip body.
      this.skip = padded;
      return;
    }

    let name = str(header, 0, 100);
    const prefix = str(header, 345, 155);
    if (prefix !== "") name = `${prefix}/${name}`;
    let size = rawSize;
    if (this.nextName !== null) name = this.nextName;
    if (this.nextPax !== null) {
      const paxPath = this.nextPax.get("path");
      if (paxPath !== undefined) name = paxPath;
      const paxSize = this.nextPax.get("size");
      if (paxSize !== undefined) size = Number.parseInt(paxSize, 10);
    }
    this.nextName = null;
    this.nextPax = null;

    const isDirectory = typeflag === "5" || name.endsWith("/");
    if (typeflag === "0" || typeflag === "\0" || typeflag === "7" || typeflag === "5") {
      this.entries.push({ path: name, size: isDirectory ? 0 : size, isDirectory });
    }
    // Bodies exist for regular files regardless of whether we recorded them.
    this.skip = typeflag === "5" ? 0 : Math.ceil(size / BLOCK) * BLOCK;
  }

  finish(): ArchiveEntry[] {
    if (!this.done && !this.sawHeader) throw new TarError("not a tar archive (no headers found)");
    if (!this.done && (this.skip > 0 || this.collect > 0 || this.pending.length >= BLOCK)) {
      throw new TarError("tar stream ended mid-entry (truncated archive?)");
    }
    return this.entries;
  }
}

function isZeroBlock(buf: Buffer): boolean {
  for (let i = 0; i < BLOCK; i++) if (buf[i] !== 0) return false;
  return true;
}

/** List a tar held fully in memory (used by tests and small archives). */
export function parseTarBuffer(buf: Buffer): ArchiveEntry[] {
  const scanner = new TarScanner();
  scanner.push(buf);
  return scanner.finish();
}

/** List a `.tgz`/`.tar.gz` (gzipped) or plain `.tar` file from disk. */
export async function readTarEntries(filePath: string, gzipped: boolean): Promise<ArchiveEntry[]> {
  const scanner = new TarScanner();
  const raw = createReadStream(filePath);
  const stream = gzipped ? raw.pipe(createGunzip()) : raw;
  for await (const chunk of stream) {
    scanner.push(chunk as Buffer);
  }
  return scanner.finish();
}

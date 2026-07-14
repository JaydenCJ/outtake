/**
 * Source loading: figure out what each command-line path is (ZIP, tgz, tar
 * or extracted directory), list it, and parse Takeout part numbering from
 * the filename. Detection is by magic bytes, not extension, so a part
 * saved as `takeout.bin` still scans.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename } from "node:path";

import { readTarEntries } from "./tar.js";
import type { ArchiveEntry, PartInfo, Source, SourceKind } from "./types.js";
import { readDirEntries } from "./walk.js";
import { readZipEntries } from "./zip.js";

/** Raised when a path cannot be read or identified. */
export class SourceError extends Error {}

/**
 * Parse Takeout's archive naming scheme:
 * `takeout-20260412T081523Z-001.zip` (classic numbered parts) and the
 * `-of-N` variant some exports carry. Returns null for other names.
 */
export function parsePartName(name: string): PartInfo | null {
  const m = /^takeout-(\d{8}T\d{6}Z)-(\d{1,4})(?:-of-(\d{1,4}))?\.(?:zip|tgz|tar\.gz|tar)$/i.exec(name);
  if (m === null) return null;
  const index = Number.parseInt(m[2] as string, 10);
  if (index === 0) return null; // parts are 1-based; a 000 name is not Takeout's
  return {
    stamp: m[1] as string,
    index,
    total: m[3] === undefined ? null : Number.parseInt(m[3] as string, 10),
  };
}

/** Identify a file by magic bytes. */
export function sniffKind(head: Buffer): Exclude<SourceKind, "dir"> | null {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) return "zip"; // "PK"
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return "tgz"; // gzip
  if (head.length >= 263 && head.toString("latin1", 257, 262) === "ustar") return "tar";
  return null;
}

/** Load one command-line path into a fully-listed `Source`. */
export async function loadSource(filePath: string): Promise<Source> {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new SourceError(`cannot read ${filePath}: no such file or directory`);
  }

  if (stats.isDirectory()) {
    const entries = readDirEntries(filePath);
    return finish(filePath, "dir", sumSizes(entries), entries, null);
  }

  const head = readHead(filePath, 263);
  const kind = sniffKind(head);
  if (kind === null) {
    throw new SourceError(
      `${filePath} is not a ZIP, gzip or tar archive (unrecognized magic bytes)`,
    );
  }
  const entries =
    kind === "zip" ? readZipEntries(filePath) : await readTarEntries(filePath, kind === "tgz");
  return finish(filePath, kind, stats.size, entries, parsePartName(basename(filePath)));
}

function readHead(filePath: string, len: number): Buffer {
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(len);
    const got = readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

function sumSizes(entries: ArchiveEntry[]): number {
  let total = 0;
  for (const e of entries) total += e.size;
  return total;
}

function finish(
  file: string,
  kind: SourceKind,
  sizeOnDisk: number,
  entries: ArchiveEntry[],
  part: PartInfo | null,
): Source {
  return { file, kind, sizeOnDisk, extractedBytes: sumSizes(entries), entries, part };
}

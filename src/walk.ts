/**
 * Directory-tree lister: turns an already-extracted Takeout folder into the
 * same `ArchiveEntry` shape the archive readers produce, so every later
 * stage is agnostic about where the data came from.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ArchiveEntry } from "./types.js";

/**
 * Recursively list files under `root`. Paths in the result are relative to
 * `root` and `/`-separated. Symbolic links are skipped (never followed) so
 * a link cycle or an escape outside the tree cannot distort the inventory.
 * Entries are sorted by name at each level for deterministic output.
 */
export function readDirEntries(root: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  walk(root, "", entries);
  return entries;
}

function walk(dir: string, rel: string, out: ArchiveEntry[]): void {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.isSymbolicLink())
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const dirent of names) {
    const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
    if (dirent.isDirectory()) {
      out.push({ path: `${childRel}/`, size: 0, isDirectory: true });
      walk(join(dir, dirent.name), childRel, out);
    } else if (dirent.isFile()) {
      out.push({ path: childRel, size: statSync(join(dir, dirent.name)).size, isDirectory: false });
    }
    // Sockets, FIFOs etc. are ignored: they cannot appear in a Takeout tree.
  }
}

/**
 * Inventory building: merge the entries of every source into per-product
 * statistics, detect multi-part sets and their gaps, and surface anything
 * suspicious as an issue. Pure — takes loaded sources, returns values.
 */
import { extensionOf } from "./formats.js";
import { resolveProduct } from "./products.js";
import { pluralize } from "./report.js";
import type {
  ArchiveEntry,
  FormatStat,
  Inventory,
  Issue,
  LargeFile,
  ProductStats,
  SetInfo,
  Source,
} from "./types.js";

const LARGEST_CAP = 25;

interface Bucket {
  id: string;
  name: string;
  known: boolean;
  portability: ProductStats["portability"];
  files: number;
  bytes: number;
  formats: Map<string, { files: number; bytes: number }>;
  perSource: Map<string, { files: number; bytes: number }>;
}

/** Strip the `Takeout/` root a source may carry; returns null for dir markers. */
function relativePath(entry: ArchiveEntry, hasRoot: boolean): string | null {
  if (entry.isDirectory) return null;
  let p = entry.path;
  if (p.startsWith("./")) p = p.slice(2);
  if (hasRoot && p.startsWith("Takeout/")) p = p.slice("Takeout/".length);
  return p;
}

/** Build the full inventory from loaded sources. Source order is preserved. */
export function buildInventory(sources: Source[]): Inventory {
  const buckets = new Map<string, Bucket>();
  const issues: Issue[] = [];
  const largest: LargeFile[] = [];
  const seenPaths = new Map<string, number>();
  let totalFiles = 0;
  let totalBytes = 0;
  let sizeOnDisk = 0;

  const rootBySource = new Map<string, boolean>();
  for (const source of sources) {
    sizeOnDisk += source.sizeOnDisk;
    const hasRoot = source.entries.some((e) => e.path.startsWith("Takeout/") || e.path.startsWith("./Takeout/"));
    rootBySource.set(source.file, hasRoot);
    let sawKnown = false;
    let sawFolder = false;

    for (const entry of source.entries) {
      const rel = relativePath(entry, hasRoot);
      if (rel === null || rel === "") continue;

      const slash = rel.indexOf("/");
      const folder = slash === -1 ? null : rel.slice(0, slash);
      if (folder !== null) sawFolder = true;
      const product = folder === null ? resolveProduct("(Takeout root)") : resolveProduct(folder);
      if (product !== null && product.id !== "root") sawKnown = true;

      const key = product !== null ? product.id : `unknown:${folder}`;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = {
          id: product !== null ? product.id : "unknown",
          name: product !== null ? product.folder : (folder as string),
          known: product !== null,
          portability: product !== null ? product.portability : null,
          files: 0,
          bytes: 0,
          formats: new Map(),
          perSource: new Map(),
        };
        buckets.set(key, bucket);
      }

      bucket.files += 1;
      bucket.bytes += entry.size;
      totalFiles += 1;
      totalBytes += entry.size;

      const ext = extensionOf(rel);
      const fmt = bucket.formats.get(ext) ?? { files: 0, bytes: 0 };
      fmt.files += 1;
      fmt.bytes += entry.size;
      bucket.formats.set(ext, fmt);

      const share = bucket.perSource.get(source.file) ?? { files: 0, bytes: 0 };
      share.files += 1;
      share.bytes += entry.size;
      bucket.perSource.set(source.file, share);

      seenPaths.set(rel, (seenPaths.get(rel) ?? 0) + 1);
      insertLargest(largest, { path: rel, size: entry.size, product: bucket.name });
    }

    if (sawFolder && !sawKnown && !hasRoot) {
      issues.push({
        level: "warning",
        code: "not-takeout",
        message: `${source.file}: no Takeout/ root and no recognized product folders — is this a Takeout export?`,
      });
    }
  }

  const duplicates = [...seenPaths.values()].filter((n) => n > 1).length;
  if (duplicates > 0) {
    issues.push({
      level: "warning",
      code: "duplicate-path",
      message: `${pluralize(duplicates, "file path")} appear${duplicates === 1 ? "s" : ""} in more than one source — are you scanning an archive and its extraction together?`,
    });
  }

  const set = detectSet(sources, issues);

  const products: ProductStats[] = [...buckets.values()]
    .map((b) => ({
      id: b.id,
      name: b.name,
      known: b.known,
      portability: b.portability,
      files: b.files,
      bytes: b.bytes,
      formats: sortedFormats(b.formats),
      perSource: sources
        .filter((s) => b.perSource.has(s.file))
        .map((s) => ({ file: s.file, ...(b.perSource.get(s.file) as { files: number; bytes: number }) })),
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  for (const p of products) {
    if (!p.known) {
      issues.push({
        level: "warning",
        code: "unknown-product",
        message: `unknown product folder "${p.name}" (${pluralize(p.files, "file")}) — not in the catalog`,
      });
    }
  }

  return {
    sources: sources.map((s) => ({
      file: s.file,
      kind: s.kind,
      sizeOnDisk: s.sizeOnDisk,
      extractedBytes: s.extractedBytes,
      files: s.entries.filter((e) => !e.isDirectory).length,
      part: s.part,
      hasTakeoutRoot: rootBySource.get(s.file) ?? false,
    })),
    set,
    products,
    largest,
    issues,
    totals: { files: totalFiles, bytes: totalBytes, sizeOnDisk },
  };
}

/** Keep the running top-N largest files, smallest evicted first. */
function insertLargest(list: LargeFile[], candidate: LargeFile): void {
  if (list.length === LARGEST_CAP && candidate.size <= (list[list.length - 1] as LargeFile).size) return;
  let i = list.length;
  while (i > 0 && (list[i - 1] as LargeFile).size < candidate.size) i--;
  list.splice(i, 0, candidate);
  if (list.length > LARGEST_CAP) list.pop();
}

function sortedFormats(map: Map<string, { files: number; bytes: number }>): FormatStat[] {
  return [...map.entries()]
    .map(([ext, v]) => ({ ext, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.ext.localeCompare(b.ext));
}

/**
 * Detect the multi-part archive set from filenames. One stamp with
 * contiguous parts is healthy; gaps or mixed stamps produce issues, because
 * a missing part silently loses whole product folders.
 */
function detectSet(sources: Source[], issues: Issue[]): SetInfo | null {
  const parts = sources.filter((s) => s.part !== null);
  if (parts.length === 0) return null;

  const stamps = [...new Set(parts.map((s) => (s.part as NonNullable<Source["part"]>).stamp))];
  if (stamps.length > 1) {
    issues.push({
      level: "warning",
      code: "mixed-set",
      message: `sources mix ${stamps.length} different export stamps (${stamps.join(", ")}) — parts from different exports do not combine cleanly`,
    });
    return null;
  }

  const stamp = stamps[0] as string;
  const present = [...new Set(parts.map((s) => (s.part as NonNullable<Source["part"]>).index))].sort(
    (a, b) => a - b,
  );
  const totals = parts
    .map((s) => (s.part as NonNullable<Source["part"]>).total)
    .filter((t): t is number => t !== null);
  const total = totals.length > 0 ? Math.max(...totals) : null;

  const missing: number[] = [];
  const upTo = total ?? Math.max(...present);
  for (let i = 1; i <= upTo; i++) {
    if (!present.includes(i)) missing.push(i);
  }
  const complete = total !== null ? missing.length === 0 : missing.length === 0 ? null : false;

  if (missing.length > 0) {
    issues.push({
      level: "warning",
      code: "missing-part",
      message: `archive set ${stamp} is missing part${missing.length === 1 ? "" : "s"} ${missing.join(", ")}${
        total !== null ? ` of ${total}` : ""
      } — whole product folders may be absent from this inventory`,
    });
  }
  return { stamp, present, total, missing, complete };
}

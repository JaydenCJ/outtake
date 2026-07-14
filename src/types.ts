/**
 * Shared types for outtake. Everything here is a plain value — the parsers
 * and aggregators are pure functions over these shapes, and only the CLI
 * layer touches the filesystem.
 */

/** A single file (or directory marker) found inside an archive or tree. */
export interface ArchiveEntry {
  /** Path inside the archive, `/`-separated, no leading slash. */
  path: string;
  /** Uncompressed size in bytes (0 for directories). */
  size: number;
  /** True for explicit directory entries. */
  isDirectory: boolean;
}

/** How a source was read. */
export type SourceKind = "zip" | "tgz" | "tar" | "dir";

/** Part-number information parsed from a Takeout archive filename. */
export interface PartInfo {
  /** Export timestamp from the filename, e.g. `20260412T081523Z`. */
  stamp: string;
  /** 1-based part index. */
  index: number;
  /** Total part count when the filename carries `-of-N`, else null. */
  total: number | null;
}

/** One input the user pointed outtake at: an archive file or a directory. */
export interface Source {
  /** Path exactly as given on the command line. */
  file: string;
  kind: SourceKind;
  /** Bytes the source occupies on disk (archive size, or tree total). */
  sizeOnDisk: number;
  /** Sum of uncompressed entry sizes ("extracted size"). */
  extractedBytes: number;
  entries: ArchiveEntry[];
  /** Part info when the filename follows the Takeout naming scheme. */
  part: PartInfo | null;
}

/** How portable a product's export formats are, out of the box. */
export type Portability = "high" | "medium" | "low";

/** A catalog entry: what one Takeout product ships and what to do with it. */
export interface ProductInfo {
  /** Stable lowercase id, e.g. `photos`, `mail`. Used with `--only`. */
  id: string;
  /** Canonical folder name under `Takeout/` (English-locale export). */
  folder: string;
  /** Alternate folder names: legacy names and common localizations. */
  aliases: string[];
  /** One-sentence description of what the export contains. */
  summary: string;
  /** Expected primary formats, as prose. */
  formats: string;
  portability: Portability;
  /** Ordered next-step tooling suggestions, most useful first. */
  nextSteps: string[];
}

/** Per-extension aggregate inside one product. */
export interface FormatStat {
  /** Lowercase extension without the dot, or `(none)`. */
  ext: string;
  files: number;
  bytes: number;
}

/** Contribution of a single source to one product. */
export interface SourceShare {
  file: string;
  files: number;
  bytes: number;
}

/** Aggregated statistics for one product folder found in the export. */
export interface ProductStats {
  /** Catalog id, or `unknown` when the folder is not in the catalog. */
  id: string;
  /** Folder name as seen in the archive. */
  name: string;
  known: boolean;
  portability: Portability | null;
  files: number;
  bytes: number;
  /** Sorted descending by bytes. */
  formats: FormatStat[];
  /** Which sources hold this product, sorted by the source order given. */
  perSource: SourceShare[];
}

/** Multi-part set detection result. */
export interface SetInfo {
  stamp: string;
  /** Sorted part indexes present. */
  present: number[];
  /** Total from `-of-N` filenames, or null when unknown. */
  total: number | null;
  /** Indexes known or inferred to be missing. */
  missing: number[];
  /** true = provably complete, false = provably incomplete, null = no gaps but total unknown. */
  complete: boolean | null;
}

/** A non-fatal problem worth surfacing (and failing on under `--strict`). */
export interface Issue {
  level: "warning";
  code:
    | "missing-part"
    | "mixed-set"
    | "unknown-product"
    | "duplicate-path"
    | "not-takeout";
  message: string;
}

/** One of the largest files in the export. */
export interface LargeFile {
  path: string;
  size: number;
  product: string;
}

/** Summary of one source, kept in the inventory instead of raw entries. */
export interface SourceSummary {
  file: string;
  kind: SourceKind;
  sizeOnDisk: number;
  extractedBytes: number;
  files: number;
  part: PartInfo | null;
  /** True when entries live under a `Takeout/` root inside the source. */
  hasTakeoutRoot: boolean;
}

/** The full inventory of one Takeout export. */
export interface Inventory {
  sources: SourceSummary[];
  set: SetInfo | null;
  products: ProductStats[];
  largest: LargeFile[];
  issues: Issue[];
  totals: { files: number; bytes: number; sizeOnDisk: number };
}

/** One numbered step of an extraction plan. */
export interface PlanStep {
  title: string;
  /** Prose lines under the title. */
  body: string[];
  /** Copy-pasteable shell commands, when the step has any. */
  commands: string[];
}

/** An ordered extraction plan for selected products. */
export interface Plan {
  dest: string;
  /** Product ids the plan covers, in report order. */
  selected: string[];
  /** Uncompressed bytes the selection will occupy at `dest`. */
  totalBytes: number;
  steps: PlanStep[];
}

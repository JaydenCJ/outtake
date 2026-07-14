/**
 * Rendering: human-readable text reports and stable-shape JSON for the
 * `scan`, `plan` and `products` commands. All output is deterministic —
 * same input, byte-identical report.
 */
import { productById } from "./products.js";
import type { Inventory, Plan, ProductInfo, ProductStats, SetInfo } from "./types.js";
import { VERSION } from "./version.js";

export type SortKey = "size" | "files" | "name";

/** 1024-based human size with one decimal above bytes. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = n;
  let unit = "B";
  for (const u of units) {
    value /= 1024;
    unit = u;
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/** Thousands-separated integer, locale-pinned so output never varies. */
export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Count plus a correctly pluralized noun: `1 file`, `2 files`. */
export function pluralize(n: number, noun: string): string {
  return `${formatInt(n)} ${noun}${n === 1 ? "" : "s"}`;
}

type Align = "left" | "right";

/** Render rows as an aligned table with two-space gutters. */
export function renderTable(rows: string[][], aligns: Align[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        const w = widths[i] ?? 0;
        return (aligns[i] ?? "left") === "right" ? cell.padStart(w) : cell.padEnd(w);
      })
      .join("  ")
      .trimEnd(),
  );
}

function sortProducts(products: ProductStats[], sort: SortKey): ProductStats[] {
  const sorted = [...products];
  if (sort === "size") sorted.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  if (sort === "files") sorted.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

function topFormats(p: ProductStats, limit = 3): string {
  const shown = p.formats.slice(0, limit).map((f) => `${f.ext} ${formatInt(f.files)}`);
  const rest = p.formats.length - limit;
  return shown.join(" · ") + (rest > 0 ? ` (+${rest})` : "");
}

function setLine(set: SetInfo): string {
  const parts = `part${set.present.length === 1 ? "" : "s"} ${set.present.join(", ")}${
    set.total !== null ? ` of ${set.total}` : ""
  }`;
  if (set.complete === true) return `Archive set ${set.stamp}: ${parts} — complete`;
  if (set.complete === false) {
    return `Archive set ${set.stamp}: ${parts} — INCOMPLETE, missing ${set.missing.join(", ")}`;
  }
  return `Archive set ${set.stamp}: ${parts} — no gaps seen, but total part count is unknown`;
}

export interface ScanRenderOptions {
  sort?: SortKey;
  /** How many of the largest files to list (0 hides the section). */
  top?: number;
}

/** The `scan` command's text report. */
export function renderScanText(inventory: Inventory, options: ScanRenderOptions = {}): string {
  const sort = options.sort ?? "size";
  const top = options.top ?? 5;
  const lines: string[] = [];
  const t = inventory.totals;
  lines.push(
    `outtake ${VERSION} — ${pluralize(inventory.sources.length, "source")}, ${pluralize(t.files, "file")}, ` +
      `${humanBytes(t.bytes)} extracted (${humanBytes(t.sizeOnDisk)} on disk)`,
  );
  lines.push("");

  if (inventory.set !== null) {
    lines.push(setLine(inventory.set));
  }
  const srcRows: string[][] = [["SOURCE", "KIND", "ON DISK", "EXTRACTED", "FILES"]];
  for (const s of inventory.sources) {
    srcRows.push([s.file, s.kind, humanBytes(s.sizeOnDisk), humanBytes(s.extractedBytes), formatInt(s.files)]);
  }
  lines.push(...renderTable(srcRows, ["left", "left", "right", "right", "right"]).map((l) => `  ${l}`));
  lines.push("");

  const products = sortProducts(inventory.products, sort);
  lines.push(`Products (${products.length})`);
  const prodRows: string[][] = [["PRODUCT", "FILES", "EXTRACTED", "TOP FORMATS", "PORTABILITY"]];
  for (const p of products) {
    prodRows.push([
      p.known ? p.name : `${p.name} (?)`,
      formatInt(p.files),
      humanBytes(p.bytes),
      topFormats(p),
      p.portability ?? "-",
    ]);
  }
  lines.push(...renderTable(prodRows, ["left", "right", "right", "left", "left"]).map((l) => `  ${l}`));
  lines.push("");

  if (top > 0 && inventory.largest.length > 0) {
    lines.push(`Largest files (top ${Math.min(top, inventory.largest.length)})`);
    for (const f of inventory.largest.slice(0, top)) {
      lines.push(`  ${humanBytes(f.size).padStart(9)}  ${f.path}`);
    }
    lines.push("");
  }

  if (inventory.issues.length > 0) {
    lines.push(`Issues (${inventory.issues.length})`);
    for (const issue of inventory.issues) {
      lines.push(`  ! [${issue.code}] ${issue.message}`);
    }
    lines.push("");
  }

  const withSteps = products.filter((p) => p.known && p.id !== "root");
  if (withSteps.length > 0) {
    lines.push("Next steps");
    for (const p of withSteps) {
      lines.push(`  ${p.name}: ${firstStep(p.id)}`);
    }
    lines.push("  Run `outtake plan` for the full per-product playbook.");
  }
  return lines.join("\n");
}

function firstStep(id: string): string {
  const info = productById(id);
  return info !== null && info.nextSteps.length > 0 ? (info.nextSteps[0] as string) : "";
}

/** The `scan` command's JSON report (stable shape: `outtake/scan@1`). */
export function renderScanJson(inventory: Inventory, options: ScanRenderOptions = {}): string {
  const sort = options.sort ?? "size";
  return JSON.stringify(
    {
      schema: "outtake/scan@1",
      version: VERSION,
      totals: inventory.totals,
      set: inventory.set,
      sources: inventory.sources,
      products: sortProducts(inventory.products, sort),
      largest: inventory.largest,
      issues: inventory.issues,
    },
    null,
    2,
  );
}

/** The `plan` command's text report. */
export function renderPlanText(plan: Plan): string {
  const lines: string[] = [];
  lines.push(
    `outtake ${VERSION} — extraction plan: ${pluralize(plan.selected.length, "product")}, ` +
      `${humanBytes(plan.totalBytes)} → ${plan.dest}`,
  );
  plan.steps.forEach((step, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${step.title}`);
    for (const line of step.body) lines.push(`   ${line}`);
    for (const cmd of step.commands) lines.push(`   $ ${cmd}`);
  });
  return lines.join("\n");
}

/** The `plan` command's JSON report (stable shape: `outtake/plan@1`). */
export function renderPlanJson(plan: Plan): string {
  return JSON.stringify({ schema: "outtake/plan@1", version: VERSION, ...plan }, null, 2);
}

/** The `products` catalog as a table. */
export function renderProductsText(products: readonly ProductInfo[]): string {
  const rows: string[][] = [["ID", "FOLDER", "PORTABILITY", "FORMATS"]];
  for (const p of products) {
    rows.push([p.id, p.folder, p.portability, p.formats]);
  }
  return renderTable(rows, ["left", "left", "left", "left"]).join("\n");
}

/** One product's full catalog card. */
export function renderProductDetail(p: ProductInfo): string {
  const lines: string[] = [];
  lines.push(`${p.folder} (id: ${p.id})`);
  lines.push(`  ${p.summary}`);
  lines.push(`  Formats: ${p.formats}`);
  lines.push(`  Portability: ${p.portability}`);
  if (p.aliases.length > 0) lines.push(`  Also seen as: ${p.aliases.join(", ")}`);
  lines.push("  Next steps:");
  for (const s of p.nextSteps) lines.push(`    - ${s}`);
  return lines.join("\n");
}

/** The `products` catalog as JSON (stable shape: `outtake/products@1`). */
export function renderProductsJson(products: readonly ProductInfo[]): string {
  return JSON.stringify({ schema: "outtake/products@1", version: VERSION, products }, null, 2);
}

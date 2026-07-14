/**
 * Extraction planning: turn an inventory into an ordered, copy-pasteable
 * playbook — complete the part set, check disk space, extract only the
 * product folders you asked for with the right tool per archive kind, then
 * follow each product's migration next-steps.
 */
import { productById, UNKNOWN_ADVICE } from "./products.js";
import { humanBytes, pluralize } from "./report.js";
import type { Inventory, Plan, PlanStep, ProductStats, SourceSummary } from "./types.js";

/** Raised for an impossible selection (unknown id, product not in export). */
export class PlanError extends Error {}

export interface PlanOptions {
  /** Product ids or folder names to include; empty/absent = everything. */
  only?: string[];
  /** Extraction destination shown in commands. Default `./takeout-extracted`. */
  dest?: string;
}

/** Single-quote a string for POSIX shells. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function selectProducts(inventory: Inventory, only: string[] | undefined): ProductStats[] {
  if (only === undefined || only.length === 0) {
    return inventory.products;
  }
  const picked: ProductStats[] = [];
  for (const raw of only) {
    const token = raw.trim().toLowerCase();
    if (token === "") continue;
    const matches = inventory.products.filter(
      (p) => p.id.toLowerCase() === token || p.name.toLowerCase() === token,
    );
    if (matches.length === 0) {
      const known = productById(token);
      throw new PlanError(
        known !== null
          ? `product "${token}" (${known.folder}) is not present in this export`
          : `unknown product "${token}" — use ids from \`outtake products\` or folder names from \`outtake scan\``,
      );
    }
    for (const m of matches) {
      if (!picked.includes(m)) picked.push(m);
    }
  }
  return picked;
}

/** The command that extracts one product folder from one source. */
export function extractCommand(source: SourceSummary, folder: string, dest: string): string {
  const inner = source.hasTakeoutRoot ? `Takeout/${folder}` : folder;
  switch (source.kind) {
    case "zip":
      return `unzip -n ${shellQuote(source.file)} ${shellQuote(`${inner}/*`)} -d ${shellQuote(dest)}`;
    case "tgz":
      return `tar -xzf ${shellQuote(source.file)} -C ${shellQuote(dest)} --wildcards ${shellQuote(`${inner}/*`)}`;
    case "tar":
      return `tar -xf ${shellQuote(source.file)} -C ${shellQuote(dest)} --wildcards ${shellQuote(`${inner}/*`)}`;
    case "dir":
      return `cp -a ${shellQuote(`${source.file}/${inner}`)} ${shellQuote(`${dest}/`)}`;
  }
}

/** Build the ordered extraction plan for the selected products. */
export function buildPlan(inventory: Inventory, options: PlanOptions = {}): Plan {
  const dest = options.dest ?? "./takeout-extracted";
  const selected = selectProducts(inventory, options.only);
  const steps: PlanStep[] = [];
  const totalBytes = selected.reduce((sum, p) => sum + p.bytes, 0);
  const totalFiles = selected.reduce((sum, p) => sum + p.files, 0);

  const missing = inventory.set?.missing ?? [];
  if (missing.length > 0) {
    steps.push({
      title: "Complete the archive set first",
      body: [
        `Set ${(inventory.set as NonNullable<Inventory["set"]>).stamp} is missing part${
          missing.length === 1 ? "" : "s"
        } ${missing.join(", ")}.`,
        "Re-download them from the Takeout page before extracting — a missing part means whole product folders are silently absent.",
      ],
      commands: [],
    });
  }

  steps.push({
    title: `Check free space at ${dest}`,
    body: [
      `The ${pluralize(selected.length, "selected product")} extract${selected.length === 1 ? "s" : ""} to ${humanBytes(totalBytes)} (${pluralize(totalFiles, "file")}).`,
      `The source archives keep occupying ${humanBytes(inventory.totals.sizeOnDisk)} until you delete them, so budget both.`,
    ],
    commands: [`mkdir -p ${shellQuote(dest)} && df -h ${shellQuote(dest)}`],
  });

  for (const product of selected) {
    const sources = inventory.sources.filter((s) => product.perSource.some((ps) => ps.file === s.file));
    const commands = sources
      .filter((s) => s.kind !== "dir" || s.file !== dest)
      .map((s) => extractCommand(s, product.name, dest));
    const where =
      sources.length === 1
        ? `lives entirely in ${(sources[0] as SourceSummary).file}`
        : `is split across ${sources.length} sources`;
    const info = productById(product.id);
    const body: string[] = [`${product.name} ${where}: ${pluralize(product.files, "file")}, ${humanBytes(product.bytes)}.`];
    if (info !== null && product.known) {
      body.push(`Formats: ${info.formats}.`);
      body.push("Then:");
      for (const step of info.nextSteps) body.push(`  - ${step}`);
    } else {
      body.push(`Then:`);
      body.push(`  - ${UNKNOWN_ADVICE}`);
    }
    steps.push({
      title: `Extract ${product.name} — ${humanBytes(product.bytes)}`,
      body,
      commands,
    });
  }

  steps.push({
    title: "Verify the extraction",
    body: [
      `Re-run outtake against the destination; file counts and sizes must match this plan (${pluralize(totalFiles, "file")}, ${humanBytes(totalBytes)}).`,
    ],
    commands: [`outtake scan ${shellQuote(dest)}`],
  });

  return { dest, selected: selected.map((p) => p.id), totalBytes, steps };
}

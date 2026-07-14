#!/usr/bin/env node
/**
 * CLI entry point. All logic lives in pure modules; this file only wires
 * argv to them and maps errors to exit codes:
 *   0 — success
 *   1 — issues found under `scan --strict`
 *   2 — usage error, unreadable input, or broken archive
 */
import { HELP, parseArgs, UsageError } from "./cliargs.js";
import { buildInventory } from "./inventory.js";
import { buildPlan, PlanError } from "./plan.js";
import { productById, PRODUCTS } from "./products.js";
import {
  renderPlanJson,
  renderPlanText,
  renderProductDetail,
  renderProductsJson,
  renderProductsText,
  renderScanJson,
  renderScanText,
} from "./report.js";
import { loadSource, SourceError } from "./sources.js";
import { TarError } from "./tar.js";
import type { Inventory, Source } from "./types.js";
import { VERSION } from "./version.js";
import { ZipError } from "./zip.js";

async function loadAll(paths: string[]): Promise<Source[]> {
  const sources: Source[] = [];
  for (const path of paths) {
    try {
      sources.push(await loadSource(path));
    } catch (err) {
      if (err instanceof ZipError || err instanceof TarError) {
        throw new SourceError(`${path}: ${err.message}`);
      }
      throw err;
    }
  }
  return sources;
}

function runScan(inventory: Inventory, args: ReturnType<typeof parseArgs>): number {
  const options = { sort: args.sort, top: args.top };
  process.stdout.write(
    (args.format === "json" ? renderScanJson(inventory, options) : renderScanText(inventory, options)) + "\n",
  );
  return args.strict && inventory.issues.length > 0 ? 1 : 0;
}

function runPlan(inventory: Inventory, args: ReturnType<typeof parseArgs>): number {
  const plan = buildPlan(inventory, { only: args.only, dest: args.dest ?? undefined });
  process.stdout.write((args.format === "json" ? renderPlanJson(plan) : renderPlanText(plan)) + "\n");
  return 0;
}

function runProducts(args: ReturnType<typeof parseArgs>): number {
  if (args.paths.length > 1) throw new UsageError("products takes at most one id");
  const id = args.paths[0];
  if (id !== undefined) {
    const info = productById(id);
    if (info === null) throw new UsageError(`unknown product id "${id}" — run \`outtake products\` for the list`);
    process.stdout.write(
      (args.format === "json" ? JSON.stringify(info, null, 2) : renderProductDetail(info)) + "\n",
    );
    return 0;
  }
  process.stdout.write(
    (args.format === "json" ? renderProductsJson(PRODUCTS) : renderProductsText(PRODUCTS)) + "\n",
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(HELP + "\n");
      return 0;
    }
    if (args.version) {
      process.stdout.write(VERSION + "\n");
      return 0;
    }
    if (args.command === "products") return runProducts(args);
    const inventory = buildInventory(await loadAll(args.paths));
    return args.command === "scan" ? runScan(inventory, args) : runPlan(inventory, args);
  } catch (err) {
    if (err instanceof UsageError || err instanceof SourceError || err instanceof PlanError) {
      process.stderr.write(`outtake: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`outtake: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  },
);

/**
 * Public programmatic API. Everything the CLI does is reachable from here:
 * load sources, build an inventory, build a plan, render reports.
 */
export { buildInventory } from "./inventory.js";
export { buildPlan, extractCommand, PlanError, shellQuote } from "./plan.js";
export type { PlanOptions } from "./plan.js";
export { productById, PRODUCTS, resolveProduct, UNKNOWN_ADVICE } from "./products.js";
export { extensionOf, isPhotoSidecar, kindOf } from "./formats.js";
export type { FormatKind } from "./formats.js";
export {
  formatInt,
  humanBytes,
  pluralize,
  renderPlanJson,
  renderPlanText,
  renderProductDetail,
  renderProductsJson,
  renderProductsText,
  renderScanJson,
  renderScanText,
} from "./report.js";
export type { ScanRenderOptions, SortKey } from "./report.js";
export { loadSource, parsePartName, sniffKind, SourceError } from "./sources.js";
export { parseTarBuffer, parsePaxRecords, parseTarNumber, readTarEntries, TarError, TarScanner } from "./tar.js";
export { readDirEntries } from "./walk.js";
export { findEocd, parseCentralDirectory, readZipEntries, ZipError } from "./zip.js";
export { HELP, parseArgs, UsageError } from "./cliargs.js";
export type { Command, ParsedArgs } from "./cliargs.js";
export { VERSION } from "./version.js";
export type * from "./types.js";

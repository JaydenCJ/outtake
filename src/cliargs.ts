/**
 * Command-line parsing: a small, dependency-free argv parser with exact
 * error messages. Parsing is pure; the CLI layer decides what errors mean.
 */
import type { SortKey } from "./report.js";

/** Raised for malformed invocations; the CLI maps it to exit code 2. */
export class UsageError extends Error {}

export type Command = "scan" | "plan" | "products";

export interface ParsedArgs {
  command: Command | null;
  /** Positional arguments after the command. */
  paths: string[];
  format: "text" | "json";
  sort: SortKey;
  top: number;
  only: string[];
  dest: string | null;
  strict: boolean;
  help: boolean;
  version: boolean;
}

const COMMANDS: readonly Command[] = ["scan", "plan", "products"];

export const HELP = `outtake — inventory a Google Takeout export: contents, sizes, formats and extraction plans.

Usage:
  outtake scan <archive|dir>...      inventory the export (all parts at once)
  outtake plan <archive|dir>...      ordered extraction + migration playbook
  outtake products [id]              the product catalog (what each folder is)

Options:
  --format text|json        output format (default: text)
  --sort size|files|name    product ordering for scan (default: size)
  --top N                   largest files to list in scan (default: 5, 0 hides)
  --only IDS                plan: comma-separated product ids or folder names
  --dest DIR                plan: extraction destination (default: ./takeout-extracted)
  --strict                  scan: exit 1 when any issue is found
  -h, --help                show this help
  -V, --version             print the version

Exit codes: 0 success, 1 issues under --strict, 2 usage or read error.`;

/** Take a flag's value from `--flag value` or `--flag=value`. */
function takeValue(argv: string[], i: number, flag: string): [string, number] {
  const arg = argv[i] as string;
  const eq = arg.indexOf("=");
  if (eq !== -1) return [arg.slice(eq + 1), i];
  const next = argv[i + 1];
  if (next === undefined) throw new UsageError(`${flag} requires a value`);
  return [next, i + 1];
}

/** Parse argv (without the node/script prefix). */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    paths: [],
    format: "text",
    sort: "size",
    top: 5,
    only: [],
    dest: null,
    strict: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const flag = arg.startsWith("--") && arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    switch (flag) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-V":
      case "--version":
        out.version = true;
        break;
      case "--strict":
        out.strict = true;
        break;
      case "--format": {
        const [value, next] = takeValue(argv, i, "--format");
        if (value !== "text" && value !== "json") {
          throw new UsageError(`--format must be text or json, got "${value}"`);
        }
        out.format = value;
        i = next;
        break;
      }
      case "--sort": {
        const [value, next] = takeValue(argv, i, "--sort");
        if (value !== "size" && value !== "files" && value !== "name") {
          throw new UsageError(`--sort must be size, files or name, got "${value}"`);
        }
        out.sort = value;
        i = next;
        break;
      }
      case "--top": {
        const [value, next] = takeValue(argv, i, "--top");
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n < 0 || String(n) !== value) {
          throw new UsageError(`--top must be a non-negative integer, got "${value}"`);
        }
        out.top = n;
        i = next;
        break;
      }
      case "--only": {
        const [value, next] = takeValue(argv, i, "--only");
        out.only.push(...value.split(",").map((s) => s.trim()).filter((s) => s !== ""));
        i = next;
        break;
      }
      case "--dest": {
        const [value, next] = takeValue(argv, i, "--dest");
        out.dest = value;
        i = next;
        break;
      }
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new UsageError(`unknown option ${arg} (see --help)`);
        }
        if (out.command === null) {
          if (!COMMANDS.includes(arg as Command)) {
            throw new UsageError(`unknown command "${arg}" — expected one of: ${COMMANDS.join(", ")}`);
          }
          out.command = arg as Command;
        } else {
          out.paths.push(arg);
        }
    }
  }

  if (!out.help && !out.version) {
    if (out.command === null) throw new UsageError("no command given (see --help)");
    if ((out.command === "scan" || out.command === "plan") && out.paths.length === 0) {
      throw new UsageError(`${out.command} needs at least one archive or directory path`);
    }
  }
  return out;
}

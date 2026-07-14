// Argument parsing: commands, flags, both --flag value and --flag=value
// forms, and exact usage errors.
import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, UsageError } from "../dist/cliargs.js";

test("parses a scan invocation with paths and defaults", () => {
  const args = parseArgs(["scan", "a.zip", "b.zip"]);
  assert.equal(args.command, "scan");
  assert.deepEqual(args.paths, ["a.zip", "b.zip"]);
  assert.equal(args.format, "text");
  assert.equal(args.sort, "size");
  assert.equal(args.top, 5);
  assert.equal(args.strict, false);
});

test("accepts both --flag value and --flag=value forms", () => {
  const a = parseArgs(["scan", "x.zip", "--format", "json", "--top", "10"]);
  const b = parseArgs(["scan", "x.zip", "--format=json", "--top=10"]);
  assert.equal(a.format, "json");
  assert.equal(b.format, "json");
  assert.equal(a.top, 10);
  assert.equal(b.top, 10);
});

test("--only splits on commas and accumulates across repeats", () => {
  const args = parseArgs(["plan", "x.zip", "--only", "photos, mail", "--only", "keep"]);
  assert.deepEqual(args.only, ["photos", "mail", "keep"]);
});

test("flags may appear before, between and after positionals", () => {
  const args = parseArgs(["--strict", "scan", "a.zip", "--sort", "name", "b.zip"]);
  assert.equal(args.strict, true);
  assert.equal(args.sort, "name");
  assert.deepEqual(args.paths, ["a.zip", "b.zip"]);
});

test("rejects bad enum values with the offending value in the message", () => {
  assert.throws(() => parseArgs(["scan", "x", "--format", "yaml"]), /got "yaml"/);
  assert.throws(() => parseArgs(["scan", "x", "--sort", "date"]), /got "date"/);
  assert.throws(() => parseArgs(["scan", "x", "--top", "-1"]), UsageError);
  assert.throws(() => parseArgs(["scan", "x", "--top", "many"]), UsageError);
});

test("rejects unknown options, commands and missing values", () => {
  assert.throws(() => parseArgs(["scan", "x", "--frobnicate"]), /unknown option/);
  assert.throws(() => parseArgs(["explode", "x"]), /unknown command/);
  assert.throws(() => parseArgs(["scan", "x", "--dest"]), /requires a value/);
});

test("scan and plan require a path; products, help and version do not", () => {
  assert.throws(() => parseArgs(["scan"]), /at least one/);
  assert.throws(() => parseArgs(["plan"]), UsageError);
  assert.equal(parseArgs(["products"]).command, "products");
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-V"]).version, true);
  assert.equal(parseArgs(["scan", "--help"]).help, true);
});

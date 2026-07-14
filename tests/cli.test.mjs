// End-to-end CLI tests: the built binary in a subprocess against fixture
// archives in fresh temp dirs. Exit codes are part of the contract.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildZip, makeTakeoutSet, rmrf, runCli, tmpDir, writeTree } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("--version matches package.json; --help documents the surface", () => {
  const version = runCli(["--version"]);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const word of ["scan", "plan", "products", "--format", "--only", "--dest", "--strict", "--top"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
});

test("usage and read errors exit 2 with a message on stderr, never a crash", () => {
  const bad = runCli(["explode"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command/);
  const missing = runCli(["scan", "/nonexistent/takeout.zip"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file/);
  const dir = tmpDir();
  const file = join(dir, "notes.txt");
  writeFileSync(file, "just some text, definitely not an archive");
  try {
    const notArchive = runCli(["scan", file]);
    assert.equal(notArchive.status, 2);
    assert.match(notArchive.stderr, /unrecognized magic bytes/);
  } finally {
    rmrf(dir);
  }
});

test("scan inventories a two-part zip set", () => {
  const { dir, part1, part2 } = makeTakeoutSet();
  try {
    const { status, stdout } = runCli(["scan", part1, part2]);
    assert.equal(status, 0);
    assert.match(stdout, /Archive set 20260412T081523Z/);
    assert.match(stdout, /Google Photos/);
    assert.match(stdout, /Mail/);
    assert.match(stdout, /Next steps/);
    // Repeat runs are byte-identical: no timestamps, no randomness.
    assert.equal(runCli(["scan", part1, part2]).stdout, stdout);
  } finally {
    rmrf(dir);
  }
});

test("scan --format json emits valid, schema-tagged JSON", () => {
  const { dir, part1, part2 } = makeTakeoutSet();
  try {
    const { status, stdout } = runCli(["scan", part1, part2, "--format", "json"]);
    assert.equal(status, 0);
    const doc = JSON.parse(stdout);
    assert.equal(doc.schema, "outtake/scan@1");
    assert.equal(doc.sources.length, 2);
    assert.ok(doc.products.some((p) => p.id === "photos"));
  } finally {
    rmrf(dir);
  }
});

test("scan --strict exits 1 when a part is missing, 0 when not strict", () => {
  const { dir, part1 } = makeTakeoutSet();
  const part3 = join(dir, "takeout-20260412T081523Z-003.zip");
  writeFileSync(part3, buildZip([{ path: "Takeout/Keep/n.json", data: "{}" }]));
  try {
    const relaxed = runCli(["scan", part1, part3]);
    assert.equal(relaxed.status, 0);
    assert.match(relaxed.stdout, /missing-part/);
    const strict = runCli(["scan", part1, part3, "--strict"]);
    assert.equal(strict.status, 1);
  } finally {
    rmrf(dir);
  }
});

test("scan works on an extracted directory tree", () => {
  const dir = tmpDir();
  writeTree(dir, {
    "Takeout/Mail/All mail Including Spam and Trash.mbox": "From a\n",
    "Takeout/Calendar/Personal.ics": "BEGIN:VCALENDAR\n",
  });
  try {
    const { status, stdout } = runCli(["scan", dir]);
    assert.equal(status, 0);
    assert.match(stdout, /Mail/);
    assert.match(stdout, /Calendar/);
    assert.match(stdout, /dir/);
  } finally {
    rmrf(dir);
  }
});

test("plan --only prints the right unzip commands and exits 0", () => {
  const { dir, part1, part2 } = makeTakeoutSet();
  try {
    const { status, stdout } = runCli(["plan", part1, part2, "--only", "photos", "--dest", "./out"]);
    assert.equal(status, 0);
    assert.match(stdout, /Extract Google Photos/);
    assert.ok(stdout.includes(`unzip -n '${part1}' 'Takeout/Google Photos/*' -d './out'`));
    assert.match(stdout, /Verify the extraction/);
  } finally {
    rmrf(dir);
  }
});

test("plan --only with an unknown product exits 2", () => {
  const { dir, part1 } = makeTakeoutSet();
  try {
    const { status, stderr } = runCli(["plan", part1, "--only", "frobnicator"]);
    assert.equal(status, 2);
    assert.match(stderr, /unknown product/);
  } finally {
    rmrf(dir);
  }
});

test("products prints the catalog; a product id prints its card", () => {
  const table = runCli(["products"]);
  assert.equal(table.status, 0);
  assert.match(table.stdout, /photos/);
  assert.match(table.stdout, /PORTABILITY/);
  const card = runCli(["products", "mail"]);
  assert.equal(card.status, 0);
  assert.match(card.stdout, /Thunderbird/);
  const bogus = runCli(["products", "frobnicator"]);
  assert.equal(bogus.status, 2);
});


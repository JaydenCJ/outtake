// Inventory building: product grouping, root handling, multi-part set
// detection and issue reporting. Sources are constructed in memory —
// buildInventory is pure, so no files are needed.
import assert from "node:assert/strict";
import test from "node:test";

import { buildInventory } from "../dist/inventory.js";
import { parsePartName } from "../dist/sources.js";

/** Compact in-memory Source: entries as [path, size] pairs. */
function src(file, entries, { kind = "zip", sizeOnDisk = 1000 } = {}) {
  const list = entries.map(([path, size]) => ({ path, size, isDirectory: path.endsWith("/") }));
  return {
    file,
    kind,
    sizeOnDisk,
    extractedBytes: list.reduce((s, e) => s + e.size, 0),
    entries: list,
    part: parsePartName(file),
  };
}

test("strips the Takeout/ root and groups files by product folder", () => {
  const inv = buildInventory([
    src("a.zip", [
      ["Takeout/", 0],
      ["Takeout/Mail/inbox.mbox", 5000],
      ["Takeout/Contacts/all.vcf", 300],
      ["Takeout/Contacts/work.vcf", 200],
    ]),
  ]);
  const mail = inv.products.find((p) => p.id === "mail");
  const contacts = inv.products.find((p) => p.id === "contacts");
  assert.equal(mail.files, 1);
  assert.equal(mail.bytes, 5000);
  assert.equal(contacts.files, 2);
  assert.equal(contacts.bytes, 500);
  assert.deepEqual(inv.totals, { files: 3, bytes: 5500, sizeOnDisk: 1000 });
  // Products come out ordered by extracted size, largest first.
  assert.deepEqual(inv.products.map((p) => p.id), ["mail", "contacts"]);
});

test("alias folders roll up under the canonical product name", () => {
  const inv = buildInventory([src("a.zip", [["Takeout/Location History (Timeline)/Records.json", 10]])]);
  const p = inv.products[0];
  assert.equal(p.id, "timeline");
  assert.equal(p.name, "Timeline");
  assert.equal(p.known, true);
});

test("files directly under Takeout/ land in the root bucket", () => {
  const inv = buildInventory([src("a.zip", [["Takeout/archive_browser.html", 42]])]);
  assert.equal(inv.products[0].id, "root");
  assert.equal(inv.products[0].name, "(Takeout root)");
});

test("an extracted directory pointed at the Takeout root still groups", () => {
  // A dir source often lacks the Takeout/ prefix: the user cd'd into it.
  const inv = buildInventory([src("/data/Takeout", [["Mail/inbox.mbox", 100]], { kind: "dir" })]);
  assert.equal(inv.products[0].id, "mail");
  assert.equal(inv.sources[0].hasTakeoutRoot, false);
  assert.equal(inv.issues.length, 0);
});

test("unknown product folders are kept as separate buckets and flagged", () => {
  const inv = buildInventory([
    src("a.zip", [
      ["Takeout/Mail/inbox.mbox", 100],
      ["Takeout/Google Frobnicator/data.bin", 900],
      ["Takeout/Mystery B/y", 2],
    ]),
  ]);
  const unknown = inv.products.filter((p) => !p.known);
  assert.equal(unknown.length, 2); // distinct folders stay distinct
  assert.equal(unknown[0].id, "unknown");
  assert.equal(unknown[0].name, "Google Frobnicator");
  assert.equal(unknown[0].bytes, 900);
  assert.ok(inv.issues.some((i) => i.code === "unknown-product" && i.message.includes("Google Frobnicator")));
});

test("a source with no Takeout root and no known folders raises not-takeout", () => {
  const inv = buildInventory([src("random.zip", [["photos/img.jpg", 10], ["docs/a.pdf", 20]])]);
  assert.ok(inv.issues.some((i) => i.code === "not-takeout"));
});

test("format histograms are per-product and sorted by bytes", () => {
  const inv = buildInventory([
    src("a.zip", [
      ["Takeout/Google Photos/a/IMG_1.jpg", 9000],
      ["Takeout/Google Photos/a/IMG_2.jpg", 8000],
      ["Takeout/Google Photos/a/IMG_1.jpg.json", 100],
      ["Takeout/Google Photos/a/clip.mp4", 20000],
    ]),
  ]);
  const photos = inv.products.find((p) => p.id === "photos");
  assert.deepEqual(
    photos.formats.map((f) => f.ext),
    ["mp4", "jpg", "json"],
  );
  assert.deepEqual(photos.formats[1], { ext: "jpg", files: 2, bytes: 17000 });
});

test("perSource records which archives hold each product, in input order", () => {
  const inv = buildInventory([
    src("takeout-20260412T081523Z-001.zip", [["Takeout/Google Photos/a.jpg", 10]]),
    src("takeout-20260412T081523Z-002.zip", [["Takeout/Google Photos/b.jpg", 20], ["Takeout/Mail/m.mbox", 5]]),
  ]);
  const photos = inv.products.find((p) => p.id === "photos");
  assert.deepEqual(photos.perSource, [
    { file: "takeout-20260412T081523Z-001.zip", files: 1, bytes: 10 },
    { file: "takeout-20260412T081523Z-002.zip", files: 1, bytes: 20 },
  ]);
  const mail = inv.products.find((p) => p.id === "mail");
  assert.equal(mail.perSource.length, 1);
});

test("largest files are globally ranked, capped and product-tagged", () => {
  const entries = [];
  for (let i = 1; i <= 40; i++) entries.push([`Takeout/Drive/f${String(i).padStart(2, "0")}.pdf`, i * 10]);
  const inv = buildInventory([src("a.zip", entries)]);
  assert.equal(inv.largest.length, 25);
  assert.equal(inv.largest[0].size, 400);
  assert.equal(inv.largest[0].product, "Drive");
  const sizes = inv.largest.map((f) => f.size);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
});

test("a contiguous -of-N set is provably complete", () => {
  const inv = buildInventory([
    src("takeout-20260412T081523Z-001-of-002.zip", [["Takeout/Mail/a.mbox", 1]]),
    src("takeout-20260412T081523Z-002-of-002.zip", [["Takeout/Keep/n.json", 1]]),
  ]);
  assert.deepEqual(inv.set, {
    stamp: "20260412T081523Z",
    present: [1, 2],
    total: 2,
    missing: [],
    complete: true,
  });
  assert.equal(inv.issues.length, 0);
});

test("a declared total with absent parts is provably incomplete", () => {
  const inv = buildInventory([src("takeout-20260412T081523Z-001-of-003.zip", [["Takeout/Mail/a.mbox", 1]])]);
  assert.deepEqual(inv.set.missing, [2, 3]);
  assert.equal(inv.set.complete, false);
  assert.ok(inv.issues.some((i) => i.code === "missing-part" && i.message.includes("2, 3")));
});

test("a numbering gap without a declared total is still incomplete", () => {
  const inv = buildInventory([
    src("takeout-20260412T081523Z-001.zip", [["Takeout/Mail/a.mbox", 1]]),
    src("takeout-20260412T081523Z-003.zip", [["Takeout/Keep/n.json", 1]]),
  ]);
  assert.deepEqual(inv.set.missing, [2]);
  assert.equal(inv.set.complete, false);
});

test("contiguous parts without a declared total stay honestly unproven", () => {
  const inv = buildInventory([
    src("takeout-20260412T081523Z-001.zip", [["Takeout/Mail/a.mbox", 1]]),
    src("takeout-20260412T081523Z-002.zip", [["Takeout/Keep/n.json", 1]]),
  ]);
  assert.equal(inv.set.complete, null); // cannot prove part 3 never existed
  assert.deepEqual(inv.set.missing, []);
});

test("mixing parts from two exports voids the set and warns", () => {
  const inv = buildInventory([
    src("takeout-20260412T081523Z-001.zip", [["Takeout/Mail/a.mbox", 1]]),
    src("takeout-20250101T000000Z-001.zip", [["Takeout/Keep/n.json", 1]]),
  ]);
  assert.equal(inv.set, null);
  assert.ok(inv.issues.some((i) => i.code === "mixed-set"));
});

test("the same path in two sources triggers the duplicate warning", () => {
  const inv = buildInventory([
    src("a.zip", [["Takeout/Mail/inbox.mbox", 100]]),
    src("b", [["Takeout/Mail/inbox.mbox", 100]], { kind: "dir" }),
  ]);
  const dup = inv.issues.find((i) => i.code === "duplicate-path");
  assert.ok(dup);
  assert.match(dup.message, /1 file path/);
});


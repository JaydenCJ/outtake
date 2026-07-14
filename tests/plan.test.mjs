// Extraction planning: product selection, per-archive-kind commands and
// the ordering guarantees (blockers first, verification last).
import assert from "node:assert/strict";
import test from "node:test";

import { buildInventory } from "../dist/inventory.js";
import { buildPlan, extractCommand, PlanError, shellQuote } from "../dist/plan.js";
import { parsePartName } from "../dist/sources.js";

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

const INV = () =>
  buildInventory([
    src("takeout-20260412T081523Z-001.zip", [
      ["Takeout/Google Photos/a/IMG_1.jpg", 9000],
      ["Takeout/Mail/inbox.mbox", 4000],
    ]),
    src("takeout-20260412T081523Z-002.zip", [["Takeout/Google Photos/b/IMG_2.jpg", 7000]]),
  ]);

test("default plan covers every product in size order", () => {
  const plan = buildPlan(INV());
  assert.deepEqual(plan.selected, ["photos", "mail"]);
  assert.equal(plan.totalBytes, 20000);
  assert.equal(plan.dest, "./takeout-extracted");
});

test("--only selects by id or folder name, deduplicated", () => {
  const plan = buildPlan(INV(), { only: ["mail", "Mail", "photos"] });
  assert.deepEqual(plan.selected, ["mail", "photos"]);
});

test("bad selections raise PlanError with a precise reason", () => {
  // Known product, absent from this export: say so by name.
  assert.throws(() => buildPlan(INV(), { only: ["calendar"] }), /Calendar.*not present in this export/);
  // Never heard of it: point at the catalogs.
  assert.throws(() => buildPlan(INV(), { only: ["frobnicator"] }), PlanError);
  assert.throws(() => buildPlan(INV(), { only: ["frobnicator"] }), /outtake products/);
});

test("extraction commands match the archive kind", () => {
  const base = { file: "part.zip", sizeOnDisk: 0, extractedBytes: 0, files: 0, part: null, hasTakeoutRoot: true };
  assert.equal(
    extractCommand({ ...base, kind: "zip" }, "Google Photos", "./out"),
    "unzip -n 'part.zip' 'Takeout/Google Photos/*' -d './out'",
  );
  assert.equal(
    extractCommand({ ...base, kind: "tgz" }, "Mail", "./out"),
    "tar -xzf 'part.zip' -C './out' --wildcards 'Takeout/Mail/*'",
  );
  assert.equal(
    extractCommand({ ...base, kind: "tar" }, "Mail", "./out"),
    "tar -xf 'part.zip' -C './out' --wildcards 'Takeout/Mail/*'",
  );
  assert.equal(
    extractCommand({ ...base, kind: "dir", file: "/data/Takeout" }, "Mail", "./out"),
    "cp -a '/data/Takeout/Takeout/Mail' './out/'",
  );
});

test("sources without a Takeout/ root get unprefixed patterns", () => {
  const source = { file: "flat.zip", kind: "zip", sizeOnDisk: 0, extractedBytes: 0, files: 0, part: null, hasTakeoutRoot: false };
  assert.equal(extractCommand(source, "Mail", "./out"), "unzip -n 'flat.zip' 'Mail/*' -d './out'");
  // Quoting survives spaces and embedded single quotes.
  assert.equal(shellQuote("Google Photos"), "'Google Photos'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test("a missing part becomes the first, blocking step", () => {
  const inv = buildInventory([src("takeout-20260412T081523Z-001-of-002.zip", [["Takeout/Mail/a.mbox", 1]])]);
  const plan = buildPlan(inv);
  assert.match(plan.steps[0].title, /Complete the archive set/);
  assert.match(plan.steps[0].body.join(" "), /missing part 2/);
});

test("plan wording agrees in number when one product is selected", () => {
  const plan = buildPlan(INV(), { only: ["mail"] });
  const space = plan.steps[0];
  assert.match(space.body[0], /^The 1 selected product extracts to /);
  assert.match(space.body[0], /\(1 file\)\.$/);
  const mail = plan.steps.find((s) => s.title.startsWith("Extract Mail"));
  assert.match(mail.body[0], /: 1 file, /);
});

test("a split product gets one extraction command per source", () => {
  const plan = buildPlan(INV(), { only: ["photos"], dest: "./x" });
  const photos = plan.steps.find((s) => s.title.startsWith("Extract Google Photos"));
  assert.equal(photos.commands.length, 2);
  assert.ok(photos.commands[0].includes("-001.zip"));
  assert.ok(photos.commands[1].includes("-002.zip"));
  assert.ok(photos.body.some((l) => l.includes("split across 2 sources")));
});

test("product steps carry the catalog's migration next-steps", () => {
  const plan = buildPlan(INV(), { only: ["mail"] });
  const mail = plan.steps.find((s) => s.title.startsWith("Extract Mail"));
  assert.ok(mail.body.some((l) => l.includes("Thunderbird")));
});

test("the plan ends by verifying the destination with outtake itself", () => {
  const plan = buildPlan(INV(), { dest: "./dest dir" });
  const last = plan.steps[plan.steps.length - 1];
  assert.equal(last.title, "Verify the extraction");
  assert.deepEqual(last.commands, ["outtake scan './dest dir'"]);
});

test("unknown products still get an extraction step with generic advice", () => {
  const inv = buildInventory([src("a.zip", [["Takeout/Mystery/x.bin", 10]])]);
  const plan = buildPlan(inv);
  const step = plan.steps.find((s) => s.title.startsWith("Extract Mystery"));
  assert.ok(step.body.some((l) => l.includes("Not in the catalog")));
});

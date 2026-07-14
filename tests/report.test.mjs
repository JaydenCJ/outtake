// Report rendering: size formatting, table alignment and the text/JSON
// shapes of scan, plan and products output. Rendering must be pure and
// deterministic — same inventory, byte-identical report.
import assert from "node:assert/strict";
import test from "node:test";

import { buildInventory } from "../dist/inventory.js";
import { buildPlan } from "../dist/plan.js";
import { PRODUCTS } from "../dist/products.js";
import {
  formatInt,
  humanBytes,
  pluralize,
  renderPlanJson,
  renderProductDetail,
  renderProductsText,
  renderScanJson,
  renderScanText,
  renderTable,
} from "../dist/report.js";

function inventory() {
  return buildInventory([
    {
      file: "takeout-20260412T081523Z-001.zip",
      kind: "zip",
      sizeOnDisk: 2048,
      extractedBytes: 14100,
      part: { stamp: "20260412T081523Z", index: 1, total: null },
      entries: [
        { path: "Takeout/Google Photos/a/IMG_1.jpg", size: 9000, isDirectory: false },
        { path: "Takeout/Google Photos/a/IMG_1.jpg.json", size: 100, isDirectory: false },
        { path: "Takeout/Mail/inbox.mbox", size: 5000, isDirectory: false },
      ],
    },
  ]);
}

test("humanBytes uses 1024 units with one decimal above bytes", () => {
  assert.equal(humanBytes(0), "0 B");
  assert.equal(humanBytes(1023), "1023 B");
  assert.equal(humanBytes(1024), "1.0 KiB");
  assert.equal(humanBytes(1536), "1.5 KiB");
  assert.equal(humanBytes(5 * 1024 ** 3), "5.0 GiB");
  assert.equal(humanBytes(3 * 1024 ** 4), "3.0 TiB");
  // Thousands separators are locale-pinned so output never varies by host.
  assert.equal(formatInt(1234567), "1,234,567");
  assert.equal(formatInt(0), "0");
});

test("counts agree in number — never '1 files' or '2 source(s)'", () => {
  assert.equal(pluralize(1, "file"), "1 file");
  assert.equal(pluralize(2, "file"), "2 files");
  assert.equal(pluralize(0, "file"), "0 files");
  assert.equal(pluralize(1200, "file"), "1,200 files");
  // A one-source, one-part inventory renders with singular forms throughout.
  const text = renderScanText(inventory());
  assert.match(text, /1 source, 3 files/);
  assert.match(text, /part 1 — no gaps seen/);
});

test("renderTable pads columns and right-aligns numeric ones", () => {
  const lines = renderTable(
    [
      ["NAME", "N"],
      ["a", "1"],
      ["long-name", "12"],
    ],
    ["left", "right"],
  );
  assert.deepEqual(lines, ["NAME        N", "a           1", "long-name  12"]);
});

test("scan text report carries every section", () => {
  const text = renderScanText(inventory());
  assert.match(text, /Archive set 20260412T081523Z/);
  assert.match(text, /PRODUCT\s+FILES\s+EXTRACTED\s+TOP FORMATS\s+PORTABILITY/);
  assert.match(text, /Google Photos\s+2\s+8\.9 KiB/);
  assert.match(text, /Largest files/);
  assert.match(text, /Next steps/);
  assert.match(text, /outtake plan/);
  // Rendering is pure: same inventory, byte-identical report.
  assert.equal(text, renderScanText(inventory()));
});

test("--top 0 hides the largest-files section", () => {
  const text = renderScanText(inventory(), { top: 0 });
  assert.doesNotMatch(text, /Largest files/);
});

test("sort=name and sort=files reorder the product table", () => {
  const byName = JSON.parse(renderScanJson(inventory(), { sort: "name" }));
  assert.deepEqual(
    byName.products.map((p) => p.id),
    ["photos", "mail"],
  );
  const byFiles = JSON.parse(renderScanJson(inventory(), { sort: "files" }));
  assert.equal(byFiles.products[0].id, "photos");
});

test("scan JSON has the stable schema tag and full statistics", () => {
  const doc = JSON.parse(renderScanJson(inventory()));
  assert.equal(doc.schema, "outtake/scan@1");
  assert.equal(doc.totals.files, 3);
  assert.equal(doc.totals.bytes, 14100);
  assert.equal(doc.set.stamp, "20260412T081523Z");
  const photos = doc.products.find((p) => p.id === "photos");
  assert.deepEqual(photos.formats[0], { ext: "jpg", files: 1, bytes: 9000 });
});

test("plan JSON has the stable schema tag and ordered steps", () => {
  const doc = JSON.parse(renderPlanJson(buildPlan(inventory())));
  assert.equal(doc.schema, "outtake/plan@1");
  assert.equal(doc.steps[doc.steps.length - 1].title, "Verify the extraction");
  assert.ok(doc.steps.every((s) => Array.isArray(s.body) && Array.isArray(s.commands)));
});

test("products table lists every catalog id; the detail card is complete", () => {
  const text = renderProductsText(PRODUCTS);
  for (const p of PRODUCTS) assert.ok(text.includes(p.id), `missing ${p.id}`);
  const photos = PRODUCTS.find((p) => p.id === "photos");
  const card = renderProductDetail(photos);
  assert.match(card, /Google Photos \(id: photos\)/);
  assert.match(card, /Also seen as: Google Fotos/);
  for (const step of photos.nextSteps) assert.ok(card.includes(step));
});

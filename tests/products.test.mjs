// Product catalog: folder-name resolution and structural invariants the
// whole tool relies on (stable unique ids, advice on every product).
import assert from "node:assert/strict";
import test from "node:test";

import { productById, PRODUCTS, resolveProduct } from "../dist/products.js";

test("resolves canonical folder names, case-insensitively and trimmed", () => {
  assert.equal(resolveProduct("Google Photos").id, "photos");
  assert.equal(resolveProduct("Mail").id, "mail");
  assert.equal(resolveProduct("YouTube and YouTube Music").id, "youtube");
  assert.equal(resolveProduct("google photos").id, "photos");
  assert.equal(resolveProduct("  MAIL  ").id, "mail");
});

test("resolves legacy and localized aliases to the same product", () => {
  assert.equal(resolveProduct("Location History (Timeline)").id, "timeline");
  assert.equal(resolveProduct("Location History").id, "timeline");
  assert.equal(resolveProduct("Hangouts").id, "chat");
  assert.equal(resolveProduct("Google Fotos").id, "photos");
});

test("unknown folders resolve to null, never a guess", () => {
  assert.equal(resolveProduct("Google Frobnicator"), null);
  assert.equal(resolveProduct(""), null);
});

test("productById finds ids case-insensitively and rejects unknowns", () => {
  assert.equal(productById("photos").folder, "Google Photos");
  assert.equal(productById("PHOTOS").folder, "Google Photos");
  assert.equal(productById("frobnicator"), null);
});

test("catalog invariant: ids are unique, lowercase and stable-looking", () => {
  const ids = PRODUCTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});

test("catalog invariant: no folder or alias maps to two products", () => {
  const names = PRODUCTS.flatMap((p) => [p.folder.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase())]);
  assert.equal(new Set(names).size, names.length);
});

test("catalog invariant: every product carries advice and a valid grade", () => {
  assert.ok(PRODUCTS.length >= 25, `expected a substantial catalog, got ${PRODUCTS.length}`);
  for (const p of PRODUCTS) {
    assert.ok(p.summary.length > 20, `${p.id}: summary too thin`);
    assert.ok(p.formats.length >= 3, `${p.id}: formats missing`);
    assert.ok(p.nextSteps.length >= 1, `${p.id}: no next steps`);
    assert.ok(["high", "medium", "low"].includes(p.portability), `${p.id}: bad portability`);
  }
});

// Format classification: extension extraction, kind rollups and Google
// Photos sidecar detection.
import assert from "node:assert/strict";
import test from "node:test";

import { extensionOf, isPhotoSidecar, kindOf } from "../dist/formats.js";

test("extensionOf lowercases and takes the last suffix", () => {
  assert.equal(extensionOf("Takeout/Google Photos/IMG_1.JPG"), "jpg");
  assert.equal(extensionOf("a/b/report.final.PDF"), "pdf");
});

test("extensionOf handles dotless names, dotfiles and trailing dots", () => {
  assert.equal(extensionOf("Takeout/Mail/README"), "(none)");
  assert.equal(extensionOf("Takeout/Chrome/.hidden"), "(none)");
  assert.equal(extensionOf("weird."), "(none)");
});

test("kindOf maps Takeout's staple formats to the right kinds", () => {
  assert.equal(kindOf("jpg"), "image");
  assert.equal(kindOf("mp4"), "video");
  assert.equal(kindOf("mbox"), "mailbox");
  assert.equal(kindOf("ics"), "calendar");
  assert.equal(kindOf("vcf"), "contacts");
  assert.equal(kindOf("json"), "data");
  assert.equal(kindOf("docx"), "document");
  assert.equal(kindOf("html"), "web");
  assert.equal(kindOf("xyz"), "other");
  assert.equal(kindOf("(none)"), "other");
});

test("isPhotoSidecar matches every sidecar shape Google Photos ships", () => {
  assert.equal(isPhotoSidecar("Photos from 2024/IMG_2001.jpg.json"), true);
  assert.equal(isPhotoSidecar("Photos from 2024/PXL_1.mp4.json"), true);
  assert.equal(isPhotoSidecar("a/IMG_1.jpg.supplemental-metadata.json"), true);
  assert.equal(isPhotoSidecar("Photos from 2024/metadata.json"), true);
});

test("isPhotoSidecar rejects ordinary JSON files", () => {
  assert.equal(isPhotoSidecar("YouTube and YouTube Music/history/watch-history.json"), false);
  assert.equal(isPhotoSidecar("Keep/note.json"), false);
  assert.equal(isPhotoSidecar("IMG_1.jpg"), false);
});

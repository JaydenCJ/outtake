// Source loading: filename part parsing, magic-byte sniffing and the
// unified loader over directories, ZIPs and tgz files.
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadSource, parsePartName, sniffKind, SourceError } from "../dist/sources.js";
import { readDirEntries } from "../dist/walk.js";
import { buildTgz, buildZip, rmrf, tmpDir, writeTree } from "./helpers.mjs";

test("parsePartName reads the classic numbered scheme", () => {
  assert.deepEqual(parsePartName("takeout-20260412T081523Z-001.zip"), {
    stamp: "20260412T081523Z",
    index: 1,
    total: null,
  });
  assert.equal(parsePartName("takeout-20260412T081523Z-017.tgz").index, 17);
});

test("parsePartName reads -of-N, and rejects non-Takeout names and part 000", () => {
  const part = parsePartName("takeout-20260412T081523Z-002-of-011.tar.gz");
  assert.deepEqual(part, { stamp: "20260412T081523Z", index: 2, total: 11 });
  assert.equal(parsePartName("backup-20260412T081523Z-001.zip"), null);
  assert.equal(parsePartName("takeout-20260412T081523Z-000.zip"), null);
  assert.equal(parsePartName("takeout.zip"), null);
});

test("sniffKind identifies zip, gzip and ustar magic", () => {
  assert.equal(sniffKind(buildZip([])), "zip");
  assert.equal(sniffKind(buildTgz([{ path: "a", data: "x" }])), "tgz");
  const tarHead = Buffer.alloc(263);
  tarHead.write("ustar", 257);
  assert.equal(sniffKind(tarHead), "tar");
  assert.equal(sniffKind(Buffer.alloc(263, 0x55)), null);
});

test("loadSource lists a directory tree with sizes", async () => {
  const dir = tmpDir();
  writeTree(dir, { "Takeout/Mail/inbox.mbox": "x".repeat(50), "Takeout/Keep/n.json": "{}" });
  try {
    const source = await loadSource(dir);
    assert.equal(source.kind, "dir");
    assert.equal(source.extractedBytes, 52);
    assert.equal(source.sizeOnDisk, 52);
    assert.equal(source.entries.filter((e) => !e.isDirectory).length, 2);
  } finally {
    rmrf(dir);
  }
});

test("loadSource sniffs archives by magic, not extension", async () => {
  const dir = tmpDir();
  const disguised = join(dir, "export.bin"); // a tgz wearing the wrong name
  writeFileSync(disguised, buildTgz([{ path: "Takeout/Chrome/Bookmarks.html", data: "<DL>" }]));
  try {
    const source = await loadSource(disguised);
    assert.equal(source.kind, "tgz");
    assert.equal(source.entries[0].path, "Takeout/Chrome/Bookmarks.html");
  } finally {
    rmrf(dir);
  }
});

test("loadSource attaches part info from the filename", async () => {
  const dir = tmpDir();
  const file = join(dir, "takeout-20260412T081523Z-003.zip");
  writeFileSync(file, buildZip([{ path: "Takeout/Keep/n.json", data: "{}" }]));
  try {
    const source = await loadSource(file);
    assert.equal(source.part.index, 3);
  } finally {
    rmrf(dir);
  }
});

test("loadSource raises SourceError for missing paths and unknown formats", async () => {
  const dir = tmpDir();
  const junk = join(dir, "junk.dat");
  writeFileSync(junk, Buffer.alloc(512, 0x33));
  try {
    await assert.rejects(loadSource(join(dir, "nope.zip")), SourceError);
    await assert.rejects(loadSource(junk), /unrecognized magic bytes/);
  } finally {
    rmrf(dir);
  }
});

test("readDirEntries walks deterministically sorted and skips symlinks", () => {
  const dir = tmpDir();
  writeTree(dir, { "b/two.txt": "22", "a/one.txt": "1" });
  symlinkSync(join(dir, "a"), join(dir, "z-link"));
  try {
    const entries = readDirEntries(dir);
    assert.deepEqual(
      entries.map((e) => e.path),
      ["a/", "a/one.txt", "b/", "b/two.txt"],
    );
  } finally {
    rmrf(dir);
  }
});

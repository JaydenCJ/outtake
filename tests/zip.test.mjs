// ZIP central-directory reader: real structures built by the in-repo store
// writer, plus the failure modes a half-downloaded Takeout part produces.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { findEocd, parseCentralDirectory, readZipEntries, ZipError } from "../dist/zip.js";
import { buildZip, rmrf, tmpDir } from "./helpers.mjs";

function writeZip(entries, options) {
  const dir = tmpDir();
  const file = join(dir, "test.zip");
  writeFileSync(file, buildZip(entries, options));
  return { dir, file };
}

test("lists names, sizes and directory flags from the central directory", () => {
  const { dir, file } = writeZip([
    { path: "Takeout/Mail", dir: true },
    { path: "Takeout/Mail/inbox.mbox", data: "x".repeat(1234) },
    { path: "Takeout/Calendar/cal.ics", data: "BEGIN:VCALENDAR" },
  ]);
  try {
    const entries = readZipEntries(file);
    assert.deepEqual(entries, [
      { path: "Takeout/Mail/", size: 0, isDirectory: true },
      { path: "Takeout/Mail/inbox.mbox", size: 1234, isDirectory: false },
      { path: "Takeout/Calendar/cal.ics", size: 15, isDirectory: false },
    ]);
  } finally {
    rmrf(dir);
  }
});

test("UTF-8 names survive: spaces, parentheses, non-ASCII", () => {
  const name = "Takeout/Location History (Timeline)/セマンティック/Records.json";
  const { dir, file } = writeZip([{ path: name, data: "{}" }]);
  try {
    assert.equal(readZipEntries(file)[0].path, name);
  } finally {
    rmrf(dir);
  }
});

test("archive comments — even ones embedding the EOCD magic — cannot fool the scanner", () => {
  // The backwards scan must reject a fake record whose comment length does
  // not reach end-of-file — otherwise crafted comments would corrupt counts.
  const plain = writeZip([{ path: "a.txt", data: "hi" }], { comment: "exported by tests" });
  const fake = Buffer.concat([Buffer.from("PK\x05\x06"), Buffer.alloc(18, 0xaa)]).toString("latin1");
  const tricky = writeZip([{ path: "a.txt", data: "hi" }], { comment: fake });
  try {
    assert.equal(readZipEntries(plain.file).length, 1);
    const entries = readZipEntries(tricky.file);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "a.txt");
  } finally {
    rmrf(plain.dir);
    rmrf(tricky.dir);
  }
});

test("ZIP64 end-of-central-directory records are followed", () => {
  const { dir, file } = writeZip(
    [
      { path: "big/one.bin", data: "abc" },
      { path: "big/two.bin", data: "defg" },
    ],
    { zip64: true },
  );
  try {
    const entries = readZipEntries(file);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].size, 4);
  } finally {
    rmrf(dir);
  }
});

test("ZIP64 per-entry extra field yields sizes above 4 GiB", () => {
  // The declared size lives only in the central directory, so a fixture can
  // claim 5 GiB without writing 5 GiB — exactly what the parser must trust.
  const fiveGiB = 5 * 1024 ** 3;
  const { dir, file } = writeZip([{ path: "video.mp4", data: "", declaredSize: fiveGiB, zip64: true }]);
  try {
    assert.equal(readZipEntries(file)[0].size, fiveGiB);
  } finally {
    rmrf(dir);
  }
});

test("an empty archive lists zero entries", () => {
  const { dir, file } = writeZip([]);
  try {
    assert.deepEqual(readZipEntries(file), []);
  } finally {
    rmrf(dir);
  }
});

test("non-ZIP bytes raise ZipError, whatever the file size", () => {
  const dir = tmpDir();
  const big = join(dir, "not.zip");
  const tiny = join(dir, "tiny.zip");
  writeFileSync(big, Buffer.alloc(4096, 0x42));
  writeFileSync(tiny, Buffer.from("PK")); // smaller than an EOCD record
  try {
    assert.throws(() => readZipEntries(big), ZipError);
    assert.throws(() => readZipEntries(tiny), ZipError);
  } finally {
    rmrf(dir);
  }
});

test("a truncated central directory raises ZipError, not garbage entries", () => {
  // Simulate an interrupted download: EOCD intact, central directory cut.
  const whole = buildZip([{ path: "a/b.txt", data: "hello" }]);
  const eocd = whole.subarray(whole.length - 22);
  const mangled = Buffer.concat([whole.subarray(0, whole.length - 42), eocd]);
  const dir = tmpDir();
  const file = join(dir, "cut.zip");
  writeFileSync(file, mangled);
  try {
    assert.throws(() => readZipEntries(file), ZipError);
  } finally {
    rmrf(dir);
  }
});

test("findEocd reports counts and offsets from a minimal record", () => {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(7, 10); // total entries
  eocd.writeUInt32LE(999, 12); // cd size
  eocd.writeUInt32LE(1000, 16); // cd offset
  const found = findEocd(eocd, 2000, 2022);
  assert.equal(found.eocd.entryCount, 7);
  assert.equal(found.eocd.cdSize, 999);
  assert.equal(found.eocd.cdOffset, 1000);
  assert.equal(found.eocdPos, 2000);
});

test("parseCentralDirectory rejects a wrong signature with entry position", () => {
  const bogus = Buffer.alloc(46);
  bogus.writeUInt32LE(0xdeadbeef, 0);
  assert.throws(() => parseCentralDirectory(bogus, 1), /entry 1 of 1/);
});

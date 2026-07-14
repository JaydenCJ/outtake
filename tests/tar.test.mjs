// Tar/tgz scanner: header variants real Takeout tgz exports contain (ustar
// prefix, GNU long names, pax overrides) and the truncation failure modes.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { parsePaxRecords, parseTarBuffer, parseTarNumber, readTarEntries, TarError, TarScanner } from "../dist/tar.js";
import { buildTar, rmrf, tmpDir } from "./helpers.mjs";

test("lists names, sizes and directory flags from a plain tar", () => {
  const tar = buildTar([
    { path: "Takeout/Mail", dir: true },
    { path: "Takeout/Mail/inbox.mbox", data: "x".repeat(700) },
    { path: "Takeout/Keep/note.json", data: "{}" },
  ]);
  assert.deepEqual(parseTarBuffer(tar), [
    { path: "Takeout/Mail/", size: 0, isDirectory: true },
    { path: "Takeout/Mail/inbox.mbox", size: 700, isDirectory: false },
    { path: "Takeout/Keep/note.json", size: 2, isDirectory: false },
  ]);
});

test("gzipped tars are transparently decompressed from disk", async () => {
  const dir = tmpDir();
  const file = join(dir, "export.tgz");
  writeFileSync(file, gzipSync(buildTar([{ path: "Takeout/Calendar/cal.ics", data: "BEGIN:VCALENDAR" }])));
  try {
    const entries = await readTarEntries(file, true);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].size, 15);
  } finally {
    rmrf(dir);
  }
});

test("GNU long names (type L) replace the truncated header name", () => {
  const long = `Takeout/Google Photos/${"very-long-album-".repeat(8)}x/IMG_0001.jpg`;
  assert.ok(long.length > 100);
  const entries = parseTarBuffer(buildTar([{ path: long, data: "jpeg", longName: true }]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, long);
});

test("pax extended headers override the entry path", () => {
  const paxPath = "Takeout/Location History (Timeline)/Records.json";
  const entries = parseTarBuffer(buildTar([{ path: "short-name", data: "{}", pax: { path: paxPath } }]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, paxPath);
});

test("ustar prefix field is rejoined onto the name", () => {
  const entries = parseTarBuffer(buildTar([{ path: "IMG_0001.jpg", prefix: "Takeout/Google Photos/2024", data: "j" }]));
  assert.equal(entries[0].path, "Takeout/Google Photos/2024/IMG_0001.jpg");
});

test("corruption raises TarError: bad checksum mid-stream, garbage up front", () => {
  const tar = buildTar([{ path: "a.txt", data: "hello" }, { path: "b.txt", data: "world" }]);
  tar[512 + 512 + 3] ^= 0xff; // flip a byte inside the second header
  assert.throws(() => parseTarBuffer(tar), /checksum/);
  assert.throws(() => parseTarBuffer(Buffer.alloc(2048, 0x41)), TarError);
});

test("a stream truncated mid-file raises TarError", () => {
  const tar = buildTar([{ path: "a.bin", data: "x".repeat(5000) }]);
  const scanner = new TarScanner();
  scanner.push(tar.subarray(0, 1024)); // header + first body block only
  assert.throws(() => scanner.finish(), /truncated/);
});

test("byte-at-a-time feeding produces identical results", () => {
  // The scanner is a state machine over arbitrary chunk boundaries; feeding
  // single bytes exercises every boundary at once.
  const tar = buildTar([
    { path: "Takeout/Contacts/all.vcf", data: "BEGIN:VCARD" },
    { path: "Takeout/Chrome/Bookmarks.html", data: "<DL>".repeat(200) },
  ]);
  const scanner = new TarScanner();
  for (const byte of tar) scanner.push(Buffer.from([byte]));
  assert.deepEqual(scanner.finish(), parseTarBuffer(tar));
});

test("a tar without trailing zero blocks still finishes cleanly", () => {
  const tar = buildTar([{ path: "a.txt", data: "hi" }], { terminator: false });
  const entries = parseTarBuffer(tar);
  assert.equal(entries.length, 1);
});

test("parseTarNumber handles octal, padded octal and GNU base-256", () => {
  assert.equal(parseTarNumber(Buffer.from("0000644\0")), 0o644);
  assert.equal(parseTarNumber(Buffer.from("   42 \0")), 0o42);
  assert.equal(parseTarNumber(Buffer.alloc(4)), 0);
  const big = Buffer.from([0x80, 0, 0, 0, 0x02, 0x00, 0x00, 0x00, 0x00]); // 2^33
  assert.equal(parseTarNumber(big), 2 ** 33);
});

test("parsePaxRecords splits length-prefixed key=value records", () => {
  const body = Buffer.from("32 path=Takeout/Mail/inbox.mbox\n11 size=42\n");
  const records = parsePaxRecords(body);
  assert.equal(records.get("path"), "Takeout/Mail/inbox.mbox");
  assert.equal(records.get("size"), "42");
});

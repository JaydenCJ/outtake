#!/usr/bin/env node
// Generates a small but realistic two-part Google Takeout export so you can
// try outtake without waiting days for a real one. Self-contained, offline,
// deterministic: same bytes on every run.
//
//   node examples/make-sample.mjs [destdir]     (default: ./sample)
//
// Produces takeout-20260412T081523Z-001.zip and -002.zip with the folder
// layout, sidecar files and naming conventions of a real export.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

/** Store-only ZIP writer — enough for a fixture archive. */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = entry.path.endsWith("/") ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names, like real Takeout parts
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x031e, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(entry.path.endsWith("/") ? ((0o040755 << 16) >>> 0) | 0x10 : (0o100644 << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

/** Deterministic filler bytes of a given size (media stand-ins). */
function filler(size, seed) {
  return Buffer.alloc(size, `${seed}:sample-media-bytes;`);
}

const sidecar = (title, ts) =>
  JSON.stringify(
    {
      title,
      photoTakenTime: { timestamp: String(ts), formatted: "Apr 12, 2026" },
      geoData: { latitude: 0, longitude: 0 },
    },
    null,
    2,
  );

const mbox = (count) => {
  let out = "";
  for (let i = 1; i <= count; i++) {
    out +=
      `From alice@example.test Sat Apr 12 08:15:${String(i % 60).padStart(2, "0")} 2026\n` +
      `From: alice@example.test\nTo: you@example.test\nSubject: Message ${i}\n` +
      `X-Gmail-Labels: Inbox,Archived\n\nBody of message ${i}.\n\n`;
  }
  return out;
};

const STAMP = "20260412T081523Z";
const dest = process.argv[2] ?? "./sample";
mkdirSync(dest, { recursive: true });

const part1 = buildZip([
  { path: "Takeout/archive_browser.html", data: "<html><title>Google Takeout</title></html>" },
  { path: "Takeout/Google Photos/Photos from 2024/IMG_2001.jpg", data: filler(824_412, "IMG_2001") },
  { path: "Takeout/Google Photos/Photos from 2024/IMG_2001.jpg.json", data: sidecar("IMG_2001.jpg", 1713600000) },
  { path: "Takeout/Google Photos/Photos from 2024/IMG_2002.jpg", data: filler(1_204_998, "IMG_2002") },
  { path: "Takeout/Google Photos/Photos from 2024/IMG_2002.jpg.json", data: sidecar("IMG_2002.jpg", 1713686400) },
  { path: "Takeout/Google Photos/Photos from 2024/PXL_2003.mp4", data: filler(2_866_003, "PXL_2003") },
  { path: "Takeout/Google Photos/Photos from 2024/PXL_2003.mp4.json", data: sidecar("PXL_2003.mp4", 1713772800) },
  { path: "Takeout/Google Photos/Photos from 2024/metadata.json", data: '{"title":"Photos from 2024"}' },
  { path: "Takeout/Mail/All mail Including Spam and Trash.mbox", data: mbox(2500) },
  { path: "Takeout/Contacts/All Contacts/All Contacts.vcf", data: "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEND:VCARD\n".repeat(120) },
  { path: "Takeout/Calendar/Personal.ics", data: "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n".repeat(40) },
]);

const part2 = buildZip([
  { path: "Takeout/Google Photos/Photos from 2025/IMG_3001.jpg", data: filler(933_120, "IMG_3001") },
  { path: "Takeout/Google Photos/Photos from 2025/IMG_3001.jpg.json", data: sidecar("IMG_3001.jpg", 1745107200) },
  { path: "Takeout/Drive/Projects/quarterly-report.docx", data: filler(48_233, "docx") },
  { path: "Takeout/Drive/Projects/budget.xlsx", data: filler(21_040, "xlsx") },
  { path: "Takeout/Drive/scans/lease.pdf", data: filler(392_002, "pdf") },
  { path: "Takeout/YouTube and YouTube Music/history/watch-history.json", data: `[${'{"title":"w"},'.repeat(3999)}{"title":"w"}]` },
  { path: "Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv", data: "Channel Id,Channel Url,Channel Title\n".repeat(60) },
  { path: "Takeout/Keep/2026-01-08T0912.json", data: '{"title":"groceries","listContent":[]}' },
  { path: "Takeout/Keep/2026-01-08T0912.html", data: "<html>groceries</html>" },
  { path: "Takeout/Chrome/Bookmarks.html", data: "<DL><DT><A HREF=\"https://example.test\">example</A></DL>\n".repeat(90) },
  { path: "Takeout/Location History (Timeline)/Records.json", data: `{"locations":[${'{"latitudeE7":0},'.repeat(2999)}{"latitudeE7":0}]}` },
]);

const file1 = join(dest, `takeout-${STAMP}-001.zip`);
const file2 = join(dest, `takeout-${STAMP}-002.zip`);
writeFileSync(file1, part1);
writeFileSync(file2, part2);
console.log(file1);
console.log(file2);

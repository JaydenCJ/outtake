// Shared factories for the test suite: an in-memory store-only ZIP writer
// (with optional ZIP64 structures), a tar/tgz builder covering the header
// variants the parser must handle, temp-dir helpers and a CLI runner.
// Everything is deterministic and offline.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "dist", "cli.js");

// ---------------------------------------------------------------------------
// ZIP writer (store method only — outtake never reads file data, so tests
// can even declare sizes that differ from the stored bytes).

function dosZero() {
  return { time: 0, date: 0x21 }; // 1980-01-01, the DOS epoch
}

/**
 * Build a ZIP archive buffer.
 * entries: { path, data?: Buffer|string, dir?: boolean, declaredSize?: number,
 *            zip64?: boolean }
 * options: { comment?: string, zip64?: boolean (force ZIP64 EOCD), utf8?: boolean }
 */
export function buildZip(entries, options = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const utf8Flag = options.utf8 === false ? 0 : 0x0800;

  for (const entry of entries) {
    const name = Buffer.from(entry.dir && !entry.path.endsWith("/") ? `${entry.path}/` : entry.path, "utf8");
    const data = entry.dir ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    const size = entry.declaredSize ?? data.length;
    const crc = crc32(data);
    const { time, date } = dosZero();
    const useZip64 = entry.zip64 === true;
    const sizeField = useZip64 ? 0xffffffff : size;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    let extra = Buffer.alloc(0);
    if (useZip64) {
      // ZIP64 extra field: uncompressed size, compressed size (both 8 bytes).
      extra = Buffer.alloc(4 + 16);
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(size), 4);
      extra.writeBigUInt64LE(BigInt(data.length), 12);
    }

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x031e, 4); // made by: unix
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(utf8Flag, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(sizeField, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(extra.length, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(entry.dir ? (0o040755 << 16 >>> 0) | 0x10 : (0o100644 << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name, extra]));

    offset += local.length + name.length + data.length;
  }

  const cd = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const tail = [];

  if (options.zip64 === true) {
    // ZIP64 EOCD record + locator, with the classic EOCD carrying overflow
    // markers — exactly what a >4 GB Takeout part looks like.
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(44n, 4);
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeUInt32LE(0, 16);
    eocd64.writeUInt32LE(0, 20);
    eocd64.writeBigUInt64LE(BigInt(entries.length), 24);
    eocd64.writeBigUInt64LE(BigInt(entries.length), 32);
    eocd64.writeBigUInt64LE(BigInt(cd.length), 40);
    eocd64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset + cd.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(eocd64, locator);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const overflow = options.zip64 === true;
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(overflow ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(overflow ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(overflow ? 0xffffffff : cd.length, 12);
  eocd.writeUInt32LE(overflow ? 0xffffffff : offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  tail.push(eocd, comment);

  return Buffer.concat([...chunks, cd, ...tail]);
}

// ---------------------------------------------------------------------------
// Tar builder.

function octal(value, len) {
  return value.toString(8).padStart(len - 1, "0") + "\0";
}

/** Build one 512-byte tar header. */
export function tarHeader({ name, size, typeflag = "0", prefix = "" }) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(size, 12), 124);
  header.write(octal(0, 12), 136);
  header.write("        ", 148); // checksum placeholder: spaces
  header.write(typeflag, 156, 1, "latin1");
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return header;
}

function padTo512(buf) {
  const rem = buf.length % 512;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(512 - rem)]);
}

/**
 * Build a tar buffer.
 * entries: { path, data?: Buffer|string, dir?: boolean, longName?: boolean,
 *            pax?: Record<string,string>, prefix?: string }
 */
export function buildTar(entries, { terminator = true } = {}) {
  const chunks = [];
  for (const entry of entries) {
    const data = entry.dir ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    if (entry.pax !== undefined) {
      let body = "";
      for (const [key, value] of Object.entries(entry.pax)) {
        // Record length counts itself; iterate to a fixed point (tar spec).
        const kv = `${key}=${value}`;
        let len = kv.length + 3;
        for (let i = 0; i < 4 && String(len).length + 1 + kv.length + 1 !== len; i++) {
          len = String(len).length + 1 + kv.length + 1;
        }
        body += `${len} ${kv}\n`;
      }
      const paxBody = Buffer.from(body, "utf8");
      chunks.push(tarHeader({ name: "PaxHeaders/x", size: paxBody.length, typeflag: "x" }), padTo512(paxBody));
    }
    if (entry.longName === true) {
      const nameBody = Buffer.from(entry.path + "\0", "utf8");
      chunks.push(tarHeader({ name: "././@LongLink", size: nameBody.length, typeflag: "L" }), padTo512(nameBody));
    }
    const headerName = entry.longName === true ? entry.path.slice(0, 100) : entry.path;
    chunks.push(
      tarHeader({
        name: entry.dir && !headerName.endsWith("/") ? `${headerName}/` : headerName,
        size: data.length,
        typeflag: entry.dir ? "5" : "0",
        prefix: entry.prefix ?? "",
      }),
    );
    if (!entry.dir) chunks.push(padTo512(data));
  }
  if (terminator) chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function buildTgz(entries, options = {}) {
  return gzipSync(buildTar(entries, options));
}

// ---------------------------------------------------------------------------
// Filesystem + CLI helpers.

/** Create a temp dir; caller cleans up with rmrf() or test teardown. */
export function tmpDir() {
  return mkdtempSync(join(tmpdir(), "outtake-test-"));
}

export function rmrf(path) {
  rmSync(path, { recursive: true, force: true });
}

/** Write { "rel/path": content } as a tree under dir. */
export function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Run the built CLI in a subprocess. Returns { status, stdout, stderr }. */
export function runCli(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: cwd ?? ROOT,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A tiny two-part Takeout-shaped fixture set written to disk.
 * Returns { dir, part1, part2 } paths.
 */
export function makeTakeoutSet(stamp = "20260412T081523Z") {
  const dir = tmpDir();
  const part1 = join(dir, `takeout-${stamp}-001.zip`);
  const part2 = join(dir, `takeout-${stamp}-002.zip`);
  writeFileSync(
    part1,
    buildZip([
      { path: "Takeout/", dir: true },
      { path: "Takeout/archive_browser.html", data: "<html>index</html>" },
      { path: "Takeout/Google Photos/album/IMG_1.jpg", data: "j".repeat(4000) },
      { path: "Takeout/Google Photos/album/IMG_1.jpg.json", data: '{"photoTakenTime":{}}' },
      { path: "Takeout/Mail/All mail Including Spam and Trash.mbox", data: "From x\n".repeat(500) },
    ]),
  );
  writeFileSync(
    part2,
    buildZip([
      { path: "Takeout/", dir: true },
      { path: "Takeout/Google Photos/album/IMG_2.jpg", data: "k".repeat(6000) },
      { path: "Takeout/Contacts/All Contacts/All Contacts.vcf", data: "BEGIN:VCARD\nEND:VCARD\n" },
      { path: "Takeout/Calendar/Personal.ics", data: "BEGIN:VCALENDAR\nEND:VCALENDAR\n" },
    ]),
  );
  return { dir, part1, part2 };
}

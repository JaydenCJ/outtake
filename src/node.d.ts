/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

interface Buffer extends Uint8Array {
  readUInt16LE(offset: number): number;
  readUInt32LE(offset: number): number;
  readBigUInt64LE(offset: number): bigint;
  subarray(start?: number, end?: number): Buffer;
  indexOf(value: number | string, byteOffset?: number): number;
  toString(encoding?: "utf8" | "latin1", start?: number, end?: number): string;
}

declare var Buffer: {
  alloc(size: number): Buffer;
  concat(list: readonly Uint8Array[]): Buffer;
  from(data: string | ArrayLike<number>, encoding?: "utf8" | "latin1"): Buffer;
};

declare module "node:fs" {
  export interface Stats {
    size: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function openSync(path: string, flags: "r"): number;
  export function closeSync(fd: number): void;
  export function readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  export function fstatSync(fd: number): Stats;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function createReadStream(path: string): NodeStream;
}

/** The async-iterable slice of a readable stream that this project consumes. */
interface NodeStream extends AsyncIterable<Buffer> {
  pipe(destination: NodeStream): NodeStream;
}

declare module "node:zlib" {
  export function createGunzip(): NodeStream;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function basename(p: string): string;
}

declare var process: {
  argv: string[];
  exitCode: number | undefined;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};

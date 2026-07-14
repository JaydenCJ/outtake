/**
 * File-format classification. The inventory groups files by extension and
 * rolls extensions up into kinds ("what sort of thing is this?") so the
 * report can say "mostly media" vs "mostly JSON metadata" at a glance.
 */

export type FormatKind =
  | "image"
  | "video"
  | "audio"
  | "mailbox"
  | "calendar"
  | "contacts"
  | "data"
  | "document"
  | "web"
  | "archive"
  | "text"
  | "other";

const KIND_BY_EXT: Record<string, FormatKind> = {
  // media
  jpg: "image", jpeg: "image", png: "image", gif: "image", heic: "image",
  webp: "image", dng: "image", raw: "image", nef: "image", cr2: "image",
  bmp: "image", tif: "image", tiff: "image", svg: "image",
  mp4: "video", mov: "video", m4v: "video", avi: "video", mkv: "video",
  webm: "video", mts: "video", "3gp": "video", wmv: "video",
  mp3: "audio", m4a: "audio", wav: "audio", flac: "audio", ogg: "audio",
  opus: "audio", amr: "audio", aac: "audio",
  // open interchange
  mbox: "mailbox", eml: "mailbox",
  ics: "calendar",
  vcf: "contacts",
  // structured data
  json: "data", geojson: "data", jsonl: "data", csv: "data", tsv: "data",
  xml: "data", yaml: "data", yml: "data", tcx: "data", gpx: "data", kml: "data",
  // documents
  pdf: "document", docx: "document", doc: "document", odt: "document",
  xlsx: "document", xls: "document", ods: "document", pptx: "document",
  ppt: "document", odp: "document", rtf: "document", md: "document",
  // web + archives + text
  html: "web", htm: "web", css: "web",
  zip: "archive", gz: "archive", tgz: "archive", tar: "archive",
  txt: "text", log: "text",
};

/** The extension label used everywhere: lowercase, no dot, `(none)` if absent. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "(none)";
  return base.slice(dot + 1).toLowerCase();
}

/** Roll an extension label up into a kind. */
export function kindOf(ext: string): FormatKind {
  return KIND_BY_EXT[ext] ?? "other";
}

/**
 * True for Google Photos metadata sidecars: `IMG_0001.jpg.json`,
 * `IMG_0001.jpg.supplemental-metadata.json` and album `metadata.json`.
 * The report calls these out because losing them loses the real timestamps.
 */
export function isPhotoSidecar(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (!base.endsWith(".json")) return false;
  if (base === "metadata.json") return true;
  return /\.(jpg|jpeg|png|gif|heic|webp|dng|mp4|mov|m4v|3gp)\.(?:[a-z-]+\.)?json$/.test(base);
}

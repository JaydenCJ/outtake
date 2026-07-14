# How a Google Takeout export is laid out

Notes on the structures outtake parses, collected from real exports.
Layout observed as of mid-2026; Google changes details without notice, so
treat this as a field guide, not a specification.

## Archive parts

An export bigger than the size you chose (2/4/10/50 GB) is split into
numbered parts:

```
takeout-20260412T081523Z-001.zip
takeout-20260412T081523Z-002.zip
...
```

- The timestamp is the moment the export job ran, shared by every part of
  one export. Parts from *different* exports do not combine cleanly —
  outtake warns (`mixed-set`) when stamps differ.
- Part numbers start at `001`. Some exports carry an explicit
  `-of-N` suffix; when it is absent, outtake can prove a *gap* (part 2
  missing between 1 and 3) but cannot prove *completeness* — the report
  says "no gaps seen, but total part count is unknown" in that case,
  because a missing final part is indistinguishable from a finished set.
- A product folder can span parts (Google Photos usually does), and a
  single part can end mid-folder. This is why scanning **all parts at
  once** matters: per-part numbers are meaningless on their own.
- `.tgz` is offered as an alternative to `.zip` at export time. ZIP parts
  above 4 GB use ZIP64 structures.

## Inside a part

Everything lives under a `Takeout/` root (the folder name is not
localized, but product folder names **are** localized to the account's
language):

```
Takeout/
├── archive_browser.html          ← Google's own HTML index of the export
├── Google Photos/
│   └── Photos from 2024/
│       ├── IMG_2001.jpg
│       ├── IMG_2001.jpg.json     ← metadata sidecar (see below)
│       └── metadata.json         ← album-level sidecar
├── Mail/
│   └── All mail Including Spam and Trash.mbox
├── Drive/…
└── …
```

## The details that bite

- **Photos sidecars carry the truth.** The JSON next to each media file
  (`IMG_2001.jpg.json`, sometimes `….jpg.supplemental-metadata.json`)
  holds the photo's taken-time, description and GPS. The media file's own
  EXIF may be stripped or stale. Losing the sidecars during a hasty
  extraction loses the real timestamps.
- **Localized folder names.** A German-locale account exports
  `Google Fotos`, not `Google Photos`. outtake's catalog resolves the
  aliases it knows and flags the rest as `unknown-product` instead of
  guessing.
- **Legacy names linger.** Old exports say `Hangouts` where new ones say
  `Google Chat`, and `Location History` became
  `Location History (Timeline)` and then `Timeline`.
- **Sizes in the ZIP central directory are trustworthy** — Takeout writes
  correct uncompressed sizes, so an inventory needs no decompression at
  all. outtake reads the central directory (or tar headers) and nothing
  else; file contents are never opened.
- **Truncated downloads** usually cut the ZIP central directory, which
  lives at the end of the file. outtake reports these as broken archives
  rather than showing a partial (and silently wrong) listing.

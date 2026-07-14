# Examples

Real Takeout exports take hours or days to arrive, so this directory
ships a generator instead of asking you to wait: `make-sample.mjs` writes
a two-part sample export with the folder layout, sidecar files and naming
conventions of the real thing — Google Photos with JSON sidecars, a Gmail
mbox, Drive documents, YouTube history, Keep notes, a Timeline dump and
the `archive_browser.html` index, split across
`takeout-20260412T081523Z-001.zip` and `-002.zip`.

The smoke test (`scripts/smoke.sh`) runs against the same generator, so
the sample is guaranteed to stay in sync with the tool.

## Try it

```bash
# from the repository root, after `npm install && npm run build`
node examples/make-sample.mjs sample        # writes sample/takeout-*.zip
node dist/cli.js scan sample/takeout-*.zip  # the umbrella inventory
node dist/cli.js plan sample/takeout-*.zip --only photos,mail --dest ./extracted
node dist/cli.js products photos            # one product's catalog card
```

## What the sample demonstrates

| Scenario | Where to look |
|---|---|
| A product split across archive parts | Google Photos spans both zips; `plan` emits one `unzip` per part |
| Photo metadata sidecars | `IMG_*.jpg.json` next to each image, counted under Google Photos |
| Alias resolution | the folder is `Location History (Timeline)`, reported as `Timeline` |
| Root-level files | `archive_browser.html` lands in the `(Takeout root)` bucket |
| Set detection | both parts share the `20260412T081523Z` stamp |
| Missing parts | copy a part to `…-004.zip` and rescan: a `missing-part` issue appears |

Everything the generator writes is deterministic filler — no real
personal data, same bytes on every run.

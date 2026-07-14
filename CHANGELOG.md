# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `outtake scan`: inventories a Google Takeout export — one or many `.zip`
  / `.tgz` / `.tar` parts or already-extracted directories — into a
  per-product report of file counts, extracted sizes, format histograms,
  largest files and portability grades, with a next-step tooling
  suggestion per product.
- Archive listing without extraction: a ZIP central-directory reader
  (UTF-8 names, archive comments, ZIP64 for >4 GB parts and >65k entries)
  and a streaming tar scanner (ustar prefix, GNU long names, pax
  overrides, base-256 sizes) read names and sizes only — a 50 GB part
  scans in a few MB of I/O and file data is never inflated.
- Multi-part set detection from Takeout filenames: contiguous sets,
  provable gaps, `-of-N` totals, and honest "no gaps seen, total unknown"
  when completeness cannot be proven.
- Issue reporting (`missing-part`, `mixed-set`, `unknown-product`,
  `duplicate-path`, `not-takeout`) with `--strict` turning any issue into
  exit code 1 for scripted checks.
- `outtake plan`: an ordered extraction playbook — part-set blockers
  first, disk-space check, per-product `unzip`/`tar`/`cp` commands scoped
  to exactly the selected folders (`--only`, `--dest`), each product's
  migration next-steps, and a final self-verification step.
- `outtake products`: the built-in catalog of 31 Takeout products —
  canonical folder names, legacy/localized aliases, expected formats,
  portability grades and migration advice — as a table, per-product
  detail cards, or JSON.
- Sniffing by magic bytes, not extension; `--format json` with stable
  schema tags (`outtake/scan@1`, `outtake/plan@1`, `outtake/products@1`);
  deterministic, locale-pinned output.
- `examples/make-sample.mjs`: generates a realistic two-part sample
  export so the tool can be tried without waiting days for a real one.
- Test suite: 92 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/outtake/releases/tag/v0.1.0

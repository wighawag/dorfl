# Pre-existing baseline test failures observed 2026-07-12

While completing `align-adr-format-doc-with-plain-slug-on-disk-convention` (a pure protocol-doc edit that touches only `skills/setup/protocol/ADR-FORMAT.md` and `work/protocol/ADR-FORMAT.md`), `pnpm -r test` fails with what appear to be pre-existing baseline failures unrelated to that edit. Confirmed by re-running the suite with the ADR-FORMAT changes stashed — the same failures reproduce on the untouched tip.

Reproducible on baseline (branch tip, no local changes):

- `test/prd-to-spec-leak-scan.test.ts` — FORWARD leak-scan flags `docs/adr/vocabulary-cutover-word-vs-identity-boundary-and-preserve-list.md` lines 11 & 20 for `work/prd-tasked/` code-span tokens.
- `test/prd-word-cutover-leak-scan.test.ts` — WORD leak-scan flags a batch of `work/tasks/ready/*.md` and one `work/notes/observations/*.md` for standalone `prd` tokens and the migrated-away folder path; also fails the "PRESERVE allow-list non-vacuous" check because provenance file `word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md` is missing. (Same class of drift as the sibling `prd-word-scan-structurally-retrips-on-its-own-cutover-provenance-2026-07-12.md` observation — the loop churns provenance entries.)

Also seen once, not on the second run — likely flaky:

- `test/prd-to-spec.test.ts` idempotency test: `ENOTEMPTY: directory not empty, rmdir '.../.git'` (filesystem race in fixture cleanup).

Not fixing here — out of scope for the ADR-FORMAT doc alignment.

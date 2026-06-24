<!-- dorfl-sidecar: item=observation:scan-json-prds-key-vs-jq-path-possible-mismatch type=observation slug=scan-json-prds-key-vs-jq-path-possible-mismatch allAnswered=false -->

## Q1

**Triage this observation: it flags a real wire-contract mismatch — `scan.ts`'s `RepoReport` serialises the sliceable-brief pool under the JSON key `briefs` (`packages/dorfl/src/scan.ts:169` — `briefs: ScannedBrief[]`; mirrored on `ScanReport.repos`), yet the propose-matrix `jq` emitted by `advance-ci-template.ts:142` and `advance-lifecycle-template.ts:314` reads `.repos[].prds[]?` + `.cwd.repo.prds[]?`, and the templates' own validators + tests (`advance-ci-template.test.ts:113-114`, `advance-lifecycle-template.test.ts:189-190`) ASSERT the `.prds[]` tokens verbatim. On the live cron the propose matrix would therefore enumerate ZERO briefs (capability B dead) — the inverse of the bug the `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` task guards against. How should this be routed?**

> Observation body at `work/notes/observations/scan-json-prds-key-vs-jq-path-possible-mismatch.md`. Verified against current `main`:
> - scan emits `briefs`: `packages/dorfl/src/scan.ts:169` (`briefs: ScannedBrief[]` on `RepoReport`).
> - jq still reads `.prds[]`: `advance-lifecycle-template.ts:314` and the `/\.prds\[\]/` validator at `:690`; same in `advance-ci-template.ts:142`.
> - Tests pin `.prds[]` verbatim: `advance-ci-template.test.ts:113-114`, `advance-lifecycle-template.test.ts:189-190`, plus rewrite sites at `:206-207` / `:512-513`.
> Observation explicitly left these `.prds[]` tokens verbatim (out of scope for the prose-only sweep) and asked the code-identifier rename lineage to align jq + tests + (the implicit) JSON-key choice in ONE change.

_Suggested default: promote-task — author a small task that picks ONE name for the sliceable-brief pool (recommend `briefs`, matching the TS field rename and the wider prose sweep) and aligns three sites in one atomic change: (1) the emitted jq in `advance-ci-template.ts` + `advance-lifecycle-template.ts` (including the `/\.prds\[\]/` self-validators), (2) the asserting tests, (3) any doc/comment references — with a regression test that runs `scan --json` and feeds its real output through the emitted jq so the wire contract is end-to-end pinned, not just textually asserted._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

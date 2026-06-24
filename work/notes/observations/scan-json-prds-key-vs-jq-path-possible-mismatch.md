---
needsAnswers: true
---

# Possible stale `scan --json` key: emitted-CI `jq` reads `.prds[]`, TS field is `briefs`

2026-06-23 (noticed during `rename-src-comment-prose-slicing-to-tasking`, the
src-comment prose sweep).

The advance CI/lifecycle workflow templates (`advance-ci-template.ts`,
`advance-lifecycle-template.ts`) emit a propose-matrix `jq` that reads
`.repos[].prds[]?` + `.cwd.repo.prds[]?` from `dorfl scan --json`, and the
matching validators + tests (`advance-ci-template.test.ts` L113-114,
`advance-lifecycle-template.test.ts`) ASSERT the template text contains
`\.repos\[\]\.prds\[\]\?` / `\.cwd\.repo\.prds\[\]\?`. But `scan.ts`'s
`RepoReport` TS field is now `briefs` (`ScannedBrief[]`), not `prds`. If the
serialized `scan --json` JSON key actually emits `briefs` (following the TS field
rename) while the `jq` still reads `.prds[]`, the propose matrix would silently
enumerate NO briefs (capability B dead on the cron) \u2014 the exact bug the
`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` task guards
against, but inverted by the key rename.

NOT verified (could not run a live `scan --json` here) and explicitly OUT OF SCOPE
for the prose-only sweep: these `.prds[]` tokens are a wire contract asserted by
tests, so I left them verbatim. Owned by the code-identifier rename lineage (the
config-keys / scan-JSON-key surface), which should confirm whether the `scan
--json` key is `prds` or `briefs` and align the emitted `jq` + its tests in ONE
change. Captured so the signal is not lost.

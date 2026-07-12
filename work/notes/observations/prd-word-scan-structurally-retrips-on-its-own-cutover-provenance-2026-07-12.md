# The prd-word cutover leak-scan structurally re-trips on the loop's own cutover provenance

Date: 2026-07-12

## What happened

The `verify` gate on an UNRELATED PR (a CI GitHub-Actions Node-24 bump) went red on three cutover leak-scan assertions in `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` and `prd-to-spec-leak-scan.test.ts`, none of which the PR touched. The failures were all on `main` itself: the autonomous advance loop keeps committing `work/` items and observations whose OWN SUBJECT is the `prd`->`spec` vocabulary cutover, so their prose legitimately contains the retired word `prd` + the migrated-away `work/prds/...` path, and the tree-wide WORD gate fires on its own subject matter.

This is NOT the first time. Several of the flagged task bodies carry a note: "Requeued after fix 7be9bd2d: the prd-word leak-scan failure was caused by two unswept task bodies (promote-rename-cutover-lessons + sweep-prose-prd-colon), now fixed on main." So the exact same class of false-positive has already reddened `main` at least once and been patched by adding files to the exemption. Two `PROVENANCE_FILE_BASENAMES` entries had also gone STALE (their source observations were discharged-by-deletion after promotion into tasks), which reddened the "provenance file missing" non-vacuous assertion.

## Why it matters (the structural drift)

The gate polices the human-readable trees INCLUDING all of active `work/**`, but the advance loop authors cutover-subject provenance INTO `work/**` faster than the exemption list is maintained. So a correct, working gate + a correct, working loop combine to red `main` on a recurring basis, blocking every unrelated PR that rebases onto the tip. The exemption mechanism (`PROVENANCE_FILE_BASENAMES`, a hand-maintained basename list) is inherently reactive: it needs a human/agent to append each new cutover-subject filename, and it goes stale when a listed file is discharged.

## What was done now

Scoped the two scans (option 1, not disabling/deleting the gate): extended `prd-to-spec-leak-scan.test.ts`'s `isExemptMarkdownDataToken` to cover the `work/`-prefixed legacy migration-map folder names (`work/prd/`, `work/pre-prd/`, `work/prd-tasked/`, the ADR preserve-list class (c) literals); added the flagged cutover-subject `work/**` bodies to `PROVENANCE_FILE_BASENAMES`; removed the two stale (discharged) basenames. Green gate restored.

## Candidate durable fixes (out of scope here; for a human to weigh)

- **Exempt cutover-subject `work/**` bodies by a STABLE marker rather than a hand-listed basename set.** E.g. a frontmatter opt-in (`cutoverSubject: true`) or a directory convention, so the loop's own provenance is exempt-by-construction and the list cannot go stale. The current basename list is the thing that keeps rotting.
- **Narrow the WORD gate's `work/**` scope.** It already excludes `work/questions/` (derived sidecars) and there is a landed task doing exactly that carve-out. Consider whether ACTIVE `work/tasks/*` and `work/notes/*` bodies (as opposed to living guidance docs + code) should be in scope at all, given they are provenance/working-material, not the current-guidance surface the cutover is protecting.
- **The `provenance-file-basenames-widened-criterion-and-expiry-guard` task already exists** and adds an expiry guard so the list self-deletes once `prd` is fully purged. Landing it would at least make the rot direction safe, but does not stop the reactive-append churn.

## Update (same session): the intermittent red was ALSO a real flake, now fixed

Separately from the scope issue above, the leak scans were INTERMITTENTLY red under the full parallel suite (a different assertion each run). Root cause: `packages/dorfl/test/install-ci.test.ts`'s capability-pickup test wrote a transient `zzz-fixture-cap.ts` into the REAL `packages/dorfl/src/install-ci-capabilities/` tree and deleted it in a `finally`. The leak scans `readdirSync`-snapshot `src/**` then `readFileSync` each file; if the fixture was unlinked between snapshot and read, the scan threw ENOENT and reddened whichever assertion was mid-walk. Fixed by (a) pointing that test at a TEMP dir via `loadCapabilityRegistry(dir)` with the core imported by absolute `file://` URL (no writes into the live source tree), and (b) making all three leak scans' walk-time reads ENOENT-tolerant (`readIfPresent`) as defense-in-depth. Five consecutive full-suite runs are clean.

## Pointers

- Scans: `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`, `packages/dorfl/test/prd-to-spec-leak-scan.test.ts`.
- Related landed/ready tasks: `provenance-file-basenames-widened-criterion-and-expiry-guard`, `exempt-work-questions-sidecars-from-prd-word-leak-scan`.
- Preserve-list ADR: `docs/adr/vocabulary-cutover-word-vs-identity-boundary-and-preserve-list.md`.

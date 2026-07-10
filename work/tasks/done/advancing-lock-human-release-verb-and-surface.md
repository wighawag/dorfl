---
title: a stuck advancing lock must be REAPABLE — add a human-invoked release-advancing <slug> verb (no auto-sweep) plus a gc --ledger/status REPORT that surfaces orphaned work/advancing/ markers (introduce listAdvancingMarkers())
slug: advancing-lock-human-release-verb-and-surface
spec: recover-autodetect-and-advancing-lock-crash-safety
blockedBy: [advancing-lock-release-crash-safe]
covers: [5, 6]
---

## What to build

Give a human a SUPPORTED way to clear a stuck advancing lock, and make a stuck lock DISCOVERABLE — so nobody ever has to hand-craft a tree-less git commit to recover (the only option today: `releaseAdvancingLock` is internal to `advance` with no CLI surface, and nothing enumerates `work/advancing/`).

Two parts, NO automatic sweep (the advancing lock has no liveness heartbeat, so "provably orphaned" cannot be inferred safely — an old marker may belong to a slow-but-live run):

1. **A human-invoked named release verb** — `dorfl release-advancing <slug>` (or `gc --advancing <slug>`; pick one and record the choice). It clears the NAMED `work/advancing/<entry>.md` marker tree-lessly + CAS-published through the SAME `ledgerWrite`/release path every other transition uses, NEVER `--force`, reusing the existing internal `releaseAdvancingLock` (made crash-safe by the blocker slice) and the `advancingMarkerPath(entry)` seam it introduced. The human asserts the lock is dead by NAMING it — the same trust model as `requeue` (a human putting a stuck item back); the tool never guesses liveness.

2. **A REPORT (never delete) that surfaces orphaned advancing markers** — `gc --ledger` (and/or `status`) lists any slug present in `work/advancing/` so a stuck lock is visible the same way a multi-folder slug already is. This needs a new enumeration helper **`listAdvancingMarkers()`** (nothing globs `work/advancing/` today); centralize it so the folder-taxonomy reorg can later repoint it to the co-located `<slug>.lock.md` scheme. The report is advisory: it shows the stuck lock + suggests `release-advancing <slug>`; it does NOT auto-delete.

## Acceptance criteria

- [ ] `dorfl release-advancing <slug>` (or the chosen `gc --advancing <slug>`) clears a named `work/advancing/<entry>.md` marker via the tree-less CAS release (never `--force`), reusing the existing `releaseAdvancingLock` + the `advancingMarkerPath(entry)` seam. A throwaway-git fixture plants an orphaned marker and asserts the verb removes it — covers story 5.
- [ ] **Idempotent exit semantics pinned.** The existing `releaseAttempt` returns `lost` (exit 2) when the marker is ALREADY absent (its "lock must currently be held" guard: `catFileExists(<arbiter>/main:<marker>)`). The verb must map a re-run on an already-cleared lock to a CLEAR exit-0 "already released / nothing to clear" outcome — NOT a confusing exit-2 `lost` (that code means "someone else holds it" in the acquire path). A test asserts the second run is a clean exit-0 no-op with an honest message.
- [ ] **No dirty-tree dependency.** The human runs this from a CLEAN checkout, so the verb does NOT need the blocker slice's crash-path rebase-abort logic — it depends on the blocker ONLY for the shared module + the `advancingMarkerPath(entry)` helper (the `blockedBy` is same-module serialisation, not a runtime dependency). A test runs the verb from a clean tree.
- [ ] There is NO automatic advancing-lock sweep — the verb is human-invoked + named only. A test/comment documents that no age-based or automatic reaping exists (no heartbeat).
- [ ] `gc --ledger` (and/or `status`) REPORTS any slug present in `work/advancing/` (never deletes it), surfaced alongside the existing multi-folder-slug report, with a pointer to `release-advancing <slug>`. A test plants an orphaned marker and asserts it appears in the report — covers story 6.
- [ ] `listAdvancingMarkers()` is the SINGLE enumeration seam for `work/advancing/` markers; both the report and any future relocation key off it. A test asserts it lists planted markers (and ignores non-marker files).
- [ ] Tests use throwaway `--bare` `file://` arbiters + real clones; point any workspace at a temp dir; no network. No shared/global location touched outside temp fixtures.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `advancing-lock-release-crash-safe` — SAME-MODULE serialisation + reuse: this slice reuses the crash-safe `releaseAdvancingLock` and the `advancingMarkerPath(entry)` seam that slice introduces, and both edit `src/advancing-lock.ts`. Build on the POST-blocker reality (re-read `advancing-lock.ts` as your drift-check).

## Prompt

> FIRST, drift-check against current `origin/main` AND the blocker slice's landed change: re-read `src/advancing-lock.ts` (`releaseAdvancingLock` ~L421 — now crash-safe per the blocker; the `advancingMarkerPath(entry)` seam the blocker introduced; the `<type>-<slug>` entry resolution); `src/cli.ts` (the `gc` command ~L2561 with its `--ledger` REPORT-only mode ~L2580, and the command-registration pattern for adding a verb / sub-flag); `src/gc.ts` / the ledger lint that powers `gc --ledger`'s multi-folder report; `src/status` surfacing. Confirm nothing already enumerates `work/advancing/` (it does not today) and that `releaseAdvancingLock` is internal-only (no CLI). If a reaper/surface already exists, route to needs-attention noting that.
>
> GOAL: (1) add a HUMAN-invoked `dorfl release-advancing <slug>` (or `gc --advancing <slug>` — pick + record) that clears a NAMED stuck `work/advancing/<entry>.md` marker via the crash-safe tree-less `releaseAdvancingLock` + `advancingMarkerPath(entry)`, never `--force`, idempotent; (2) make `gc --ledger`/`status` REPORT (never delete) any slug present in `work/advancing/`, via a new `listAdvancingMarkers()` enumeration seam, with a pointer to the release verb. NO automatic sweep, NO heartbeat — the human names the dead lock (same trust model as `requeue`).
>
> WHY: a live `advance` crash left an orphaned `work/advancing/` marker with NO supported way to clear it — the human had to hand-craft a git commit. See `work/observations/recover-already-committed-discards-continue-agent-new-work.md` and the SPEC `recover-autodetect-and-advancing-lock-crash-safety` (Defect C).
>
> FENCE: NO automatic advancing-lock sweep, NO age-based reaping, NO liveness heartbeat (deliberately out of scope per the SPEC — the lock has no heartbeat so auto-detecting "orphaned" is unsafe). Do NOT touch `complete.ts`'s auto-recover (slice `recover-autodetect-gated-on-nothing-to-commit`) and do NOT re-do the crash-safe release (the blocker slice owns it — reuse it).
>
> SEAM TO TEST AT: the new verb + the `gc --ledger`/`status` report with throwaway `--bare` `file://` arbiters + real clones — (a) plant an orphaned marker ⇒ `release-advancing <slug>` removes it + idempotent; (b) plant a marker ⇒ it appears in the report (never deleted by the report); (c) `listAdvancingMarkers()` lists markers, ignores non-markers. No network; temp dirs only.
>
> DONE: a stuck advancing lock is clearable by a named human verb and discoverable via the report, there is no automatic sweep, `listAdvancingMarkers()` is the single enumeration seam (reusable by the folder-taxonomy relocation), `## Decisions` records the verb-name choice (`release-advancing` vs `gc --advancing`) + the no-auto-sweep rationale + the centralized-helper coordination with the folder-taxonomy SPEC, and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform git transitions — the runner/human owns those.

## Decisions (to record while building)

- The verb surface chosen: standalone `dorfl release-advancing <slug>` vs `gc --advancing <slug>` (and why).
- The no-automatic-sweep / no-heartbeat decision (DECIDED in the SPEC): the human names the dead lock; the tool never guesses liveness.
- Centralized-helper coordination (cross-session, DECIDED 2026-06-16): `listAdvancingMarkers()` is the single enumeration seam the folder-taxonomy SPEC (`work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) reuses when it relocates the marker to a co-located `<slug>.lock.md` (a slice that `sliceAfter`s this SPEC).

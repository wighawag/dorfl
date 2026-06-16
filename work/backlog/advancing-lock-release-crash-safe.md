---
title: the advancing-lock release must be CRASH-SAFE across a throwing recover/integrate — a failed advance run must NEVER leave an orphaned work/advancing/<entry>.md marker (introduce advancingMarkerPath(entry) as the single path seam)
slug: advancing-lock-release-crash-safe
prd: recover-autodetect-and-advancing-lock-crash-safety
blockedBy: []
covers: [4]
---

## What to build

Make the `advancing` lock release land even when the post-lock dispatch (recover / integrate / gate) THREW mid-operation, so a failed `advance` run never leaves an orphaned advancing marker and a one-slug-two-folder ledger.

`advance` takes the `advancing` CAS borrow (`work/advancing/<entry>.md`, `<entry>` = `<type>-<slug>`) and releases it in a `finally`. But the release has a guard that THROWS when the working tree/index is dirty ("commit/stash them before releasing"), and the release CAS micro-commit must run from a clean ref state. When the recover/integrate path threw mid-rebase, the tree was dirty / mid-operation, so the `finally` release did NOT land — leaving the slug in BOTH `work/advancing/<entry>.md` (orphaned lock) AND its lifecycle folder. (Live evidence: the incident's `origin/main` trail shows `advancing: lock` then `claim` then NO `advancing: release` commit.)

Fix: make the release robust to a dirty / mid-operation state so it ALWAYS clears the borrow after any `advance` run (success OR failure). Run it from a known-clean ref state (e.g. abort/cleanup any in-progress rebase and reset the worktree to a clean ref BEFORE the release CAS, since the borrow is a tree-less marker move and does not need the dirty work), and/or retry against freshly-fetched `main`. The invariant to restore: **after any `advance` run, the slug is in exactly ONE lifecycle folder and holds NO orphaned advancing borrow.**

While here, introduce the single path-construction seam **`advancingMarkerPath(entry)`** and route BOTH the acquire and release marker-path construction through it (replacing the inline `work/advancing/${entry}.md` at the two sites). This is the centralized helper the folder-taxonomy reorg will later repoint to relocate the marker (see `## Decisions`). KEEP `<type>-<slug>` in the lock BRANCH name (`advancing/<entry>` / `advancing-release/<entry>`) — it is load-bearing for cross-type/cross-repo branch-collision avoidance even when the marker filename later co-locates.

## Acceptance criteria

- [ ] After an `advance` run whose post-lock dispatch THROWS (e.g. a rebase conflict in the recover/integrate path), the `advancing` borrow is CLEARED on the arbiter (no orphaned `work/advancing/<entry>.md`) and the slug is in exactly ONE lifecycle folder. A throwaway-git fixture induces a throwing integrate under a held advancing lock and asserts the marker is gone + one-folder afterward — covers story 4.
- [ ] The release no longer fails merely because the worktree/index is dirty / a rebase is in progress: it reaches a clean ref state first (abort/cleanup), then publishes the tree-less marker-removal CAS against fresh `main`, NEVER `--force`. A test pins the dirty/mid-rebase case releases cleanly.
- [ ] The happy-path release is UNCHANGED (a successful `advance` still releases exactly as before) — no regression to the existing acquire/release tests.
- [ ] `advancingMarkerPath(entry)` is the SINGLE place the `work/advancing/<entry>.md` path is constructed; both acquire and release call it. `<type>-<slug>` remains in the lock/release BRANCH names. A test asserts the path is computed via the helper (and the branch name still carries the type-encoded entry).
- [ ] Tests use throwaway `--bare` `file://` arbiters + real clones (the existing advancing-lock test style); point any workspace at a temp dir; no network.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately. (The reaper/surfacing slice `advancing-lock-human-release-verb-and-surface` is `blockedBy` THIS one: it reuses `advancingMarkerPath(entry)` + the crash-safe release and edits the same `advancing-lock.ts` module, so it serialises after.)

## Prompt

> FIRST, drift-check against current `origin/main`: re-read `src/advancing-lock.ts` — `acquireAdvancingLock` (~L131; the inline marker `work/advancing/${entry}.md` ~L187, the lock branch `advancing/${entry}` ~L191) and `releaseAdvancingLock` (~L421; `runRelease` resolves the same `entry`/`marker`, the DIRTY-WORKTREE guard that throws ~L464-471, the `releaseBranch` `advancing-release/${entry}` ~L479); and `src/advance.ts` (the post-lock dispatch wrapped in `try { … } finally { await release(item) }` ~L871-905). Confirm the failure mechanism still holds: a throw in dispatch leaves the tree dirty / mid-rebase, so the `finally` release's dirty-guard throws / its CAS cannot land, orphaning the marker. If the release is already crash-safe, route to needs-attention noting that.
>
> GOAL: make the advancing-lock release ALWAYS clear the borrow after any `advance` run (success OR failure). The borrow is a tree-less marker move, so the release does not need the dirty work in the tree: reach a clean ref state first (abort an in-progress rebase / reset to a clean ref), then publish the marker-removal CAS against fresh `main`, NEVER `--force`. Restore the invariant: after any `advance`, the slug is in exactly ONE lifecycle folder with NO orphaned advancing marker. Introduce `advancingMarkerPath(entry)` as the single path seam and route acquire + release through it; KEEP `<type>-<slug>` in the lock/release branch names.
>
> WHY: a live `advance` whose recover path hit a rebase conflict left the slug in BOTH `work/advancing/` and `work/in-progress/` because the `finally` release never landed. See `work/observations/recover-already-committed-discards-continue-agent-new-work.md` and the PRD `recover-autodetect-and-advancing-lock-crash-safety` (Defect B).
>
> FENCE: do NOT change the lock SEMANTICS (acquire CAS, contention/lost handling) beyond making release crash-safe. Do NOT add a liveness heartbeat or an automatic sweep (the human-invoked reaper is the SIBLING slice `advancing-lock-human-release-verb-and-surface`). Do NOT touch `complete.ts`'s auto-recover (that is slice `recover-autodetect-gated-on-nothing-to-commit`).
>
> SEAM TO TEST AT: `advance` + `releaseAdvancingLock` with throwaway `--bare` `file://` arbiters + real clones — (a) a throwing integrate under a held lock ⇒ marker cleared + one-folder; (b) a dirty/mid-rebase release ⇒ releases cleanly; (c) happy-path release ⇒ unchanged. No network; temp dirs only.
>
> DONE: a failed `advance` run never leaves an orphaned advancing marker, the release survives a dirty/mid-rebase state, `advancingMarkerPath(entry)` is the single path seam (branch names keep `<type>-<slug>`), the happy path is unchanged, the incident is covered by a regression test, `## Decisions` records the centralized-helper coordination with the folder-taxonomy PRD (flat-path-for-now; that PRD relocates the marker later, `sliceAfter`, reusing this seam + `listAdvancingMarkers()` from the sibling slice), and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform git transitions — the runner/human owns those.

## Decisions (to record while building)

- **Centralized-helper coordination with the folder-taxonomy reorg (cross-session, DECIDED 2026-06-16).** This slice keeps the marker on the FLAT `work/advancing/<entry>.md` path and introduces `advancingMarkerPath(entry)` as the single path-construction seam. The folder-taxonomy PRD (`work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) will later relocate the marker to a co-located `<slug>.lock.md` in a slice that `sliceAfter`s this PRD and repoints `advancingMarkerPath` + reuses `listAdvancingMarkers()` (introduced by the sibling slice). `<type>-<slug>` stays in the lock branch name regardless. Record the chosen clean-ref-state mechanism for the release (rebase-abort + reset vs a dedicated clean worktree/ref).

---
title: 'autoslice-lock — concurrency lock for slicing via the seam''s CAS (work/slicing/)'
slug: autoslice-lock
spec: auto-slice
blockedBy: [ledger-write-seam]
covers: [4, 5]
---

## What to build

The concurrency lock that serialises _concurrent_ slicers (two CI runs, or human + CI) so a SPEC is never double-sliced — reusing the proven claim compare-and-swap, NOT a new lock mechanism.

- **Mechanism:** atomically race a `git mv work/spec/<slug>.md → work/slicing/<slug>.md` micro-commit to the arbiter — the same CAS the build-claim uses — on a **distinct branch name** so it never collides with the `work/<slug>` build claims. The winner holds the lock (the SPEC now sits in `work/slicing/`); a loser gets the CAS's exit-2 and backs off.
- **Through the seam, NOT raw:** the claim CAS now lives behind the **ledger-transition write seam** (`docs/adr/claim-ledger-vs-protected-main.md`). Acquire/release the lock THROUGH that seam's transition machinery — a `slicing` transition kind, or the claim primitive the seam exposes — do NOT call raw `claim-cas` or push `main` directly (that reintroduces the direct-`main` coupling the seam removed).
- **`work/slicing/`** is the in-progress folder for the slicing operation (status = folder, consistent with the contract). It is a **transient HELD LOCK**, NOT a resting/post-slice state: releasing the lock = moving the SPEC back to `work/spec/<slug>.md` (the command does this on success/failure; this slice provides the lock + release primitives). After a successful slice the SPEC is back in `work/spec/` and `slicing/` is empty — sliced-ness is recorded by the SPEC's `sliced:` frontmatter marker, never by residence in `slicing/`.
  > **DRIFT to reconcile (spotted 2026-06-06; UPDATED 2026-06-07):** this was originally a larger reconciliation — `src/ledger-read.ts` read `work/slicing/` as a resting post-slice state. Re-checked on current `main`: it is now **~90% already reconciled** (the `PrdExistence` docstring, the `slicingFile` field, and `findPrdFileBySlug` all already say "transient held lock … in flight, not 'sliced'"). **One leftover stale phrase remains** at `ledger-read.ts` ~line 185 (the `resolvePrdExistence` method docstring): `work/slicing/` (its **post-slice record**)`— fix that ONE phrase to match the lock-only wording above. So this criterion is now a one-line mop-up, not the larger fix. (See`work/observations/ledger-read-slicing-post-slice-record-stale-comment.md`.) Note: `LedgerTransitionKind`is currently`'claim' | 'complete' | 'needs-attention'`— there is NO`'slicing'` kind yet, so adding one (vs reusing the claim primitive) is the open choice this slice resolves, NOT drift.
- **Read-stability / concurrent SPEC EDITS (the real gap, not just double-slicing):** the lock serialises two _slicers_, but a human (or another agent) can EDIT the SPEC body while a slice is in flight, producing backlog slices derived from stale content — a SILENT drift. Two defences, both via the existing CAS/seam (no new mechanism), per `work/observations/slicing-lock-does-not-stabilise-spec-content.md`:
  - **(A) `slicing/`-absence-from-`spec/` is the hands-off signal.** While locked the SPEC lives at `work/slicing/<slug>.md`, not `work/spec/`; document that a SPEC in `slicing/` is held — edit it after it returns to `spec/` (same folder-as- signal as a claimed slice leaving `backlog/`).
  - **(B) Release must REBASE against current arbiter `main`, not force-restore.** If a concurrent edit landed, the `slicing → spec` release conflicts → the slicing is stale → fail loud (re-slice or route the SPEC to `needs-attention/`). NEVER silently overwrite the edit or emit stale slices.
  - The `needsAnswers`-flip is the human's edit-handshake (the gate is `needsAnswers !== true`); a thin command for it is a separate idea (`work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) — out of scope here.
- **Human path needs no lock:** a human slicing locally with no agent running has no contention and may slice on `main` directly — the lock is mandatory for the agent, optional for the human (parallel to "the runner never skips verify; the human may"). This slice provides the lock; the command slice wires the human-vs-agent choice.

This slice delivers the lock + release primitives (acquire via the seam CAS, release back to `work/spec/`); the orchestrating command is a later slice.

## Acceptance criteria

- [ ] Acquiring the lock races a `spec → work/slicing/` micro-commit via the seam's CAS on a branch name distinct from `work/<slug>` build claims.
- [ ] Two simultaneous slicers ⇒ exactly ONE winner; the loser gets exit-2 and does not slice. (Tested against throwaway repos + a local `--bare` arbiter, the established claim-CAS race pattern.)
- [ ] The lock goes THROUGH the ledger-transition write seam (no raw `claim-cas` / direct `main` push).
- [ ] Release moves the SPEC back `work/slicing/ → work/spec/` by REBASING against current arbiter `main` (NOT a force-restore): a concurrent SPEC edit makes the release CONFLICT → the slicing is treated as stale and FAILS LOUD (re-slice or route to `needs-attention/`); it never silently overwrites the edit or emits stale slices. (Tested: a slicer holds the lock, a second writer pushes a SPEC-body edit, the release detects it and does not produce stale slices.)
- [ ] `slicing/` is documented + treated as a transient HELD LOCK, not a resting state: after success the SPEC is back in `spec/`, `slicing/` is empty, and the `ledger-read` "slicing record" drift (above) is reconciled.
- [ ] Race/concurrency tests live in the NON-PARALLEL vitest project (no file-parallelism flakiness; no retry-masking).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `ledger-write-seam` — the lock is acquired/released THROUGH the write seam's transition machinery (the seam that defined `applyLedgerTransition` + the claim primitive). It must exist first. (In `done/`.)

## Prompt

> Build the slicing concurrency LOCK (the `do prd:<slug>` slicing path is a LATER slice — provide the lock + release primitives only).
>
> READ FIRST: `work/spec/auto-slice.md` (the lock design + `work/slicing/` folder), `work/observations/slicing-lock-does-not-stabilise-spec-content.md` (the read-stability gap this slice must close: lock serialises slicing, NOT SPEC editing — release-by-rebase + fail-loud + `slicing/`-as-hands-off, and the `ledger-read` "slicing record" drift to reconcile), the done file for `ledger-write-seam` + the write-seam module it added (you acquire/release the lock THROUGH the seam's transition machinery — a `slicing` transition kind or the claim primitive it exposes; do NOT call raw `claim-cas` or push `main` directly), and `src/claim-cas.ts` / `skills/to-slices/scripts/claim.sh` (NOT `scripts/claim.sh` — the script lives under the vendored skill) to understand the CAS semantics + exit codes you are reusing.
>
> Implement: acquire = race a `git mv work/spec/<slug>.md → work/slicing/<slug>.md` micro-commit via the seam CAS, on a branch name that cannot collide with `work/<slug>` build claims; winner holds the lock, loser gets exit-2 + backs off. release = move the SPEC back `work/slicing/ → work/spec/` by REBASING against current `main` (NOT force-restore) so a concurrent SPEC edit makes release CONFLICT → fail loud (stale slicing → re-slice / `needs-attention/`), never silent stale slices. `slicing/` is a transient HELD lock, not a resting state (SPEC returns to `spec/`; sliced-ness = the `sliced:` marker) — reconcile the `ledger-read` "slicing record" comment accordingly. The human path may slice on `main` without the lock (the command wires that choice; here just don't make the lock mandatory for a no-contention human).
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter (the claim race pattern): (1) a simultaneous two-slicer race shows exactly one winner, the loser gets exit-2; (2) a slicer holds the lock, a second writer pushes a SPEC-body edit, and release detects the conflict → fails loud, emits no stale slices. Race tests in the NON-PARALLEL project. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim autoslice-lock --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/autoslice-lock <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/autoslice-lock.md work/done/autoslice-lock.md
```

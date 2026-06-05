---
title: autoslice-lock — concurrency lock for slicing via the seam's CAS (work/slicing/)
slug: autoslice-lock
prd: auto-slice
blockedBy: [ledger-write-seam]
covers: [4, 5]
---

## What to build

The concurrency lock that serialises *concurrent* slicers (two CI runs, or human +
CI) so a PRD is never double-sliced — reusing the proven claim compare-and-swap,
NOT a new lock mechanism.

- **Mechanism:** atomically race a `git mv work/prd/<slug>.md →
  work/slicing/<slug>.md` micro-commit to the arbiter — the same CAS the
  build-claim uses — on a **distinct branch name** so it never collides with the
  `work/<slug>` build claims. The winner holds the lock (the PRD now sits in
  `work/slicing/`); a loser gets the CAS's exit-2 and backs off.
- **Through the seam, NOT raw:** the claim CAS now lives behind the
  **ledger-transition write seam** (`docs/adr/claim-ledger-vs-protected-main.md`).
  Acquire/release the lock THROUGH that seam's transition machinery — a `slicing`
  transition kind, or the claim primitive the seam exposes — do NOT call raw
  `claim-cas` or push `main` directly (that reintroduces the direct-`main`
  coupling the seam removed).
- **`work/slicing/`** is the in-progress folder for the slicing operation
  (status = folder, consistent with the contract). Releasing the lock = moving the
  PRD back to `work/prd/<slug>.md` (the command does this on success/failure; this
  slice provides the lock + release primitives).
- **Human path needs no lock:** a human slicing locally with no agent running has
  no contention and may slice on `main` directly — the lock is mandatory for the
  agent, optional for the human (parallel to "the runner never skips verify; the
  human may"). This slice provides the lock; the command slice wires the
  human-vs-agent choice.

This slice delivers the lock + release primitives (acquire via the seam CAS,
release back to `work/prd/`); the orchestrating command is a later slice.

## Acceptance criteria

- [ ] Acquiring the lock races a `prd → work/slicing/` micro-commit via the seam's
      CAS on a branch name distinct from `work/<slug>` build claims.
- [ ] Two simultaneous slicers ⇒ exactly ONE winner; the loser gets exit-2 and
      does not slice. (Tested against throwaway repos + a local `--bare` arbiter,
      the established claim-CAS race pattern.)
- [ ] The lock goes THROUGH the ledger-transition write seam (no raw `claim-cas` /
      direct `main` push).
- [ ] Release moves the PRD back `work/slicing/ → work/prd/`.
- [ ] Race/concurrency tests live in the NON-PARALLEL vitest project (no
      file-parallelism flakiness; no retry-masking).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `ledger-write-seam` — the lock is acquired/released THROUGH the write seam's
  transition machinery (the seam that defined `applyLedgerTransition` + the claim
  primitive). It must exist first. (In `done/`.)

## Prompt

> Build the slicing concurrency LOCK (the `do prd:<slug>` slicing path is a LATER
> slice — provide the lock + release primitives only).
>
> READ FIRST: `work/prd/auto-slice.md` (the lock design + `work/slicing/` folder),
> the done file for `ledger-write-seam` + the write-seam module it added (you
> acquire/release the lock THROUGH the seam's transition machinery — a `slicing`
> transition kind or the claim primitive it exposes; do NOT call raw `claim-cas`
> or push `main` directly), and `src/claim-cas.ts` / `skills/to-slices/scripts/claim.sh` (NOT `scripts/claim.sh` — the script lives under the vendored skill) to
> understand the CAS semantics + exit codes you are reusing.
>
> Implement: acquire = race a `git mv work/prd/<slug>.md → work/slicing/<slug>.md`
> micro-commit via the seam CAS, on a branch name that cannot collide with
> `work/<slug>` build claims; winner holds the lock, loser gets exit-2 + backs off.
> release = move the PRD back `work/slicing/ → work/prd/`. The human path may slice
> on `main` without the lock (the command wires that choice; here just don't make
> the lock mandatory for a no-contention human).
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter (the claim
> race pattern): a simultaneous two-slicer race shows exactly one winner; the loser
> gets exit-2. Race tests in the NON-PARALLEL project. "Done" = acceptance criteria
> met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim autoslice-lock --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/autoslice-lock <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/autoslice-lock.md work/done/autoslice-lock.md
```

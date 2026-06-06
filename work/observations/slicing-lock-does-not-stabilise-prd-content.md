# slicing lock serialises SLICING but not PRD EDITING — release must rebase + fail loud

2026-06-06 (noticed while discussing a folder-taxonomy reorg; the reorg surfaced
this as a side effect, but the gap is real and independent of any reorg)

The auto-slice concurrency lock (`work/backlog/autoslice-lock.md`,
`work/prd/auto-slice.md`) is a **write-lock on the *act of slicing*** — it
races a `git mv work/prd/<slug>.md → work/slicing/<slug>.md` micro-commit via the
ledger-transition write seam's CAS so two *slicers* never double-slice one PRD.
It does NOT make the PRD *content* read-stable for the duration of the slice.

## The unprotected race

1. Agent acquires the lock (`prd → slicing/`), reads PRD content snapshot *S*,
   starts generating slices from *S* (a long, model-driven step).
2. A human (locally, or another agent) edits the PRD body — working from their own
   checkout, they never observe the lock — and pushes the edit.
3. Agent finishes, emits `work/backlog/` slices derived from **stale *S***,
   releases the lock.
4. Result: **backlog slices that don't match the current PRD.** Silent drift — no
   conflict, no error, plausible-looking output. This is *worse* than the
   double-slice the lock prevents, because double-slicing fails loudly (CAS
   exit-2) while this fails silently.

The root cause is conceptual: **a PRD is a mutable, long-lived *document* with
concurrent editors, not a flowing work *token*.** The lock treats it like a token
(serialise the operation) but the document keeps mutating underneath.

`autoslice-lock.md`'s release criterion today is just *"Release moves the PRD back
`work/slicing/ → work/prd/`"* — a restore with **no rebase and no stale-detection**.
That is the defect.

## The fix (no new mechanism — all CAS / the existing seam)

- **(A) `slicing/`-absence-from-`prd/` IS the hands-off signal.** While locked the
  PRD physically lives at `work/slicing/<slug>.md`, not `work/prd/<slug>.md` — the
  same folder-as-signal the whole contract relies on (a claimed slice leaves
  `backlog/`). Document the rule: *a PRD in `slicing/` is held; edit it after it
  returns to `prd/`.* (Soft spot: a human on a stale local checkout won't see the
  `git mv` until they fetch — accepted; the protocol guarantees no *silent
  corruption*, not no *human surprise*.)
- **(B) Release must REBASE, not overwrite, and slice-from-stale must FAIL LOUD.**
  Release the `slicing → prd` transition by rebasing/merging against current
  arbiter `main`. If a human pushed an edit, the release conflicts → the slicing
  is stale → re-slice or route the PRD to `needs-attention/`. Git gives this for
  free *iff* release is a real merge/rebase, not a force-restore.
- **The `needsAnswers` flip is the human's edit-handshake.** `autoslice-gate.md`
  already gates slicing on `needsAnswers !== true`. A human who wants to edit can
  first flip `needsAnswers: true` via the seam CAS; if that micro-commit lands,
  no slicer will start (and an in-flight one fails B's rebase). So the existing
  two-axis gate already IS the human-facing edit lock — we just need a command to
  flip it and report win/lose (captured separately as an idea:
  `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`).

A+B together are sufficient (maintainer agreed): the move = hands-off signal, the
rebase = loud backstop, `needsAnswers`/`humanOnly` = the gate for *who* may slice.
No heavier "PRD edit lock" is warranted.

## The slice-edit parallel (same governing principle, narrower)

Editing an already-in-`backlog/` slice while an agent is about to `claim` it is the
identical shape — and is already better-protected by accident: `claim` does
`backlog → in-progress` via the same CAS, so a concurrent edit hits the same
missing-from-`backlog/` / rebase signal. The general rule worth stating: **any
status-folder item being mutated concurrently is protected by the CAS on its next
transition; edits to settled items should be rare-by-gate.** The PRD case is just
the most visible instance because PRDs are the longest-lived, most-edited docs.

## Disposition

Drives an amendment to `work/backlog/autoslice-lock.md` (add: release-by-rebase +
stale-detection acceptance criteria; document the `slicing/`-as-hands-off rule).
Not yet built — verify the rebase-on-release behaviour against throwaway repos +
a local `--bare` arbiter (the established claim-race test pattern) before treating
this as closed.

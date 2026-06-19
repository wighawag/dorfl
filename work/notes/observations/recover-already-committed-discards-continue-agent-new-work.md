---
title: recoverAlreadyCommitted (slice-1 auto-detect) DISCARDS a continue-agent's NEW uncommitted work and rebases the STALE kept commit — and conflicts on a baked-in advancing/ lock
type: observation
status: spotted
spotted: 2026-06-16
---

## What was seen

Live `agent-runner advance "slice:autonomous-integration-refusal-surfaces-not-strands-in-progress" --propose --watch --arbiter origin` on 2026-06-16. The slice had been requeued (keep+continue) after a Gate-2 block; the work branch `work/slice-autonomous-integration-refusal-surfaces-not-strands-in-progress` was kept with the prior attempt's commit `36ceca5` (slice already `git mv`'d to `work/done/` on the branch).

This run:

1. Re-claimed the slug (fresh claim commit `5c2a3e1` on `origin/main` → slice in `work/in-progress/`).
2. Onboarded onto the kept branch; the agent RAN and (per its own summary) made the exact in-place `performDo` mapping the Gate-2 block demanded, then reported `pnpm -r build && pnpm -r test && pnpm format:check` GREEN in its working tree.
3. The runner then printed: `>> recovered a stranded already-complete branch for '<slug>' — integrating the kept commit (no rebuild). This signals an earlier un-merged PR.` — i.e. slice-1's NEW `recoverAlreadyCommitted` auto-detection (PRD `ledger-integrity`) fired.
4. The recover path rebased the KEPT commit `36ceca5` onto `origin/main`, which CONFLICTED; it aborted (never auto-resolved) and exited 1.

## Why it matters (two distinct defects)

**Defect A — the continue-agent's new work was DISCARDED.** Verified against the branch tip: `36ceca5` is dated 16:38 (this run) but `git show 36ceca5:packages/agent-runner/src/do.ts` at the in-place dispatch (~L1073-1090) STILL lists only `prepare-failed | gate-failed | review-blocked | rebase-conflict` — there is NO `strand-surfaced` mapping there (the only two `strand-surfaced` hits are the pre-existing REMOTE tail at ~L2145). So the agent's just-made in-place fix was NEVER committed: the `recoverAlreadyCommitted` path skips the build/done-move/COMMIT steps (it integrates the ALREADY-committed kept tip) and therefore ignored the agent's uncommitted working-tree changes. The recover auto-detect fired on a branch that was being CONTINUED with new work, treated it as a finished strand, and threw the new work away. This is precisely the "a `done/` slice genuinely being CONTINUED vs a finished STRAND is folder-indistinguishable" hazard the `finish-already-committed-branch` slice flagged — slice-1's auto-detection on the autonomous path appears to mis-fire when an agent legitimately produced new commits/edits on the kept branch.

**Defect B — the rebase conflict + a broken ledger.** `5c2a3e1..origin/main` is EMPTY (main did not advance past the merge-base), yet the rebase conflicted — a LEDGER conflict, not code. The branch tree carries BOTH `work/advancing/slice-<slug>.md` AND `work/done/<slug>.md` (the stale advancing-lock file was baked into the branch from the broken main state it was cut from, plus the `→done` move). After the abort, `origin/main` is left in a one-slug-TWO-folder state: the slug is in BOTH `work/advancing/` (a STUCK advancing lock whose release never ran because the recover path threw) AND `work/in-progress/`. This is the on-branch-`→done`-move self-conflict class the `humanOnly` PRD `branch-carries-code-not-ledger-status-main-owns-status` exists to eliminate, surfacing through slice-1's NEW recover path.

## Refs

- Run: `advance "slice:autonomous-integration-refusal-surfaces-not-strands-in-progress" --propose --watch` (2026-06-16 ~16:38 UTC).
- Branch tip: `36ceca5` (kept commit, in-place fix NOT present at do.ts ~L1073).
- Stuck ledger on `origin/main`: `work/advancing/slice-<slug>.md` (stale lock) + `work/in-progress/<slug>.md`.
- Slice-1 code: `recoverAlreadyCommitted` (`packages/agent-runner/src/integration-core.ts` ~L1352); the auto-detect routing added in `complete.ts` source-resolution (the `autonomous-path-auto-recovers-already-committed-stranded-branch` slice, `work/done/`).
- Related warning: `work/done/finish-already-committed-branch.md` (the continue-vs-strand folder-ambiguity hazard).

## Candidate dispositions (for triage — not decided here)

- The recover auto-detect on the AUTONOMOUS continue path must NOT fire (or must defer) when the onboarded agent produced NEW work this run — distinguish "finished strand" from "being continued" by more than the `done/` folder + tip-ahead (e.g. the agent made edits/commits this run, or the kept tip predates this run's claim). Likely a fix slice against slice-1.
- The advancing-lock RELEASE must be crash-safe: a throw in the recover/integrate path must still clear `work/advancing/` (or a sweep must reap a stale advancing lock), so a failed run never leaves a one-slug-two-folder ledger. Possibly folds into the `branch-carries-code-not-ledger-status` PRD (the `→done`-on-branch self-conflict) and/or the `ledger-one-slug-one-folder-lint-and-sweep` capability.
- Immediate operational unblock for THIS item: clear the stale `work/advancing/` lock + reconcile the slug to ONE folder, then `requeue --reset` (discard the mis-built kept branch) and rebuild fresh, since the kept branch never actually contains the Gate-2 fix.

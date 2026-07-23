---
title: 'A tasking (spec:) review-block correctly surfaces to needs-attention (needsAnswers + question sidecar on main, lock released) but exits non-zero, so the CI advance-propose job goes RED on a SUCCESSFUL surfacing'
type: observation
status: spotted
spotted: 2026-07-21
needsAnswers: true
---

## What was seen

On rocketh, `advance-lifecycle` leg `advance-propose (spec:unknown-signer-core)` FAILED (red annotation, 8m) — https://github.com/wighawag/rocketh/actions/runs/29788508038/job/88505132193. This is a DIFFERENT spec + a DIFFERENT failure mode than the force-push loop just fixed (that one was `tag-tracking-selective-reset`).

The maintainer's read (correct): "the review can fail too, and it seems to NOT write the review — instead it seems to do a lock." That is exactly what happens: when the tasking (task-SET acceptance) review returns `block` (or is unparseable), `performTask` does NOT open a PR / write a review. It routes the held spec to needs-attention and the CI job reddens.

## Mechanism (traced in `packages/dorfl/src`)

1. `tasking.ts` `performTask`, on `core.outcome === 'review-blocked'` (also `sidecar-violation` / `review-unparseable`): calls `lock.release({..., routeToNeedsAttention: {reason}})` → `surfaceStuckToNeedsAttention` (`needs-attention.ts`), which in ONE tree-less commit on `<arbiter>/main`:
   - writes/append a `kind: 'stuck'` question sidecar `work/questions/spec-<slug>.md` (carrying the block REASON + any surfaced questions), AND
   - sets `needsAnswers: true` on the spec body,
   then RELEASES the `spec:<slug>` lock (surface-first / release-second).
2. `performTask` returns `{exitCode: 1, outcome: 'needs-attention'}`.
3. The `dorfl advance spec:<slug> --propose` leg propagates that non-zero exit → the GitHub Actions job is marked **failed** (red).

Two consequences the maintainer flagged:

- **"Not a review."** Because propose was blocked BEFORE integrate, there is NO PR, so the block reason is NOT posted as a GitHub PR review — it lives only in `work/questions/spec-<slug>.md` + `needsAnswers:true` on `main`. A human must read the work/ tree, not a PR review thread. (This is by design for the tasking path — the tasking review has no PR to comment on until it integrates — but it is surprising vs. the build path, where Gate-2 rides an open PR.)
- **Red on a SUCCESSFUL surfacing.** The item was correctly parked for a human; nothing crashed. Yet the job is red. This trains operators to ignore red advance-propose legs ("just the stuck ones again") — the exact anti-signal the sibling task `in-place-scan-subtracts-held-locked-slugs-from-propose-matrix` fought for stuck items in the matrix.

Note the NON-loop (good): the surfaced spec now carries `needsAnswers: true`, and `scoreSpecs`/`taskableSpecs` gate on `needsAnswers !== true`, so it is NOT re-enumerated next tick. So unlike the force-push bug, this does NOT retrigger every tick — it reds ONCE (the tick that surfaced it) and then the spec drops out of the pool until a human answers. (Verify on the live repo: is the leg red only once, or does something re-enumerate it? If it re-reds every tick, there is a SECOND bug — the needsAnswers gate not taking — that must be chased separately.)

## Why it is like this (deliberate, deferred)

The exit-code shape is a KNOWN, deliberately-deferred design decision, not an accidental bug:

- `work/tasks/done/bounce-surfaces-stuck-sidecar-and-releases-lock.md` (PR-1) explicitly lists "Flipping the `agent-stopped` / `agent-failed` / `gate-failed` / `needs-attention`(rebase-conflict) / **tasking-lock-failure** exit codes to `0`" as OUT OF SCOPE, owned by PR-2 `bounce-atomic-cutover-retire-stuck-lock`.
- `work/tasks/done/disable-rename-detection-on-continue-rebase.md` notes an advance-lifecycle leg where "the second failure was NOT a red gate" — i.e. the red-vs-not distinction for surfaced/bounced items has been live-observed before.

So the open question the deferral left unresolved is squarely: **should a needs-attention SURFACE (a successful, expected park-for-human) exit 0 (job green, item surfaced) or exit non-zero (job red)?**

## The design question to decide (needs a human ruling / ADR)

A surface/bounce to needs-attention is a NORMAL terminal of the loop ("I could not proceed autonomously; I have cleanly surfaced a question for the human"). Candidate rulings:

- **(A) Surface is GREEN (exit 0).** A clean needs-attention surface is a SUCCESS of the loop's contract (drain toward done OR surface+idle), so the leg should be green; red is reserved for genuine faults (crash, infra error, unhandled). The human learns of the pending question via the `work/questions/**` surface / a digest, not via a red CI leg. This is the strongest fit for "the human is the clock" — the loop is calm at rest, not perpetually alarming. Risk: a surfaced item becomes invisible in CI (mitigate with a non-failing annotation / job summary line: "surfaced N items to needs-attention").
- **(B) Keep RED, but make it DISTINGUISHABLE.** Preserve non-zero but tag the annotation so "surfaced to needs-attention" is visually distinct from "crashed/gate-red", so operators aren't trained to ignore. Weaker — still noisy.
- **(C) Split exit codes by CAUSE.** A genuine `block` (the reviewer judged the decomposition unclear — a real "human needed") vs. a transient `review-unparseable` / agent-infra error (should re-run, arguably red). Map only the transient/fault class to non-zero; a clean judged-block surface exits 0. This aligns with the existing `failure-cause-classification-model-vs-git-vs-agent` work (model-vs-git-vs-agent cause taxonomy already exists — reuse it rather than fork).

Whichever is chosen, it is a decision about the CI CONTRACT of `advance`, so it belongs in an ADR + likely the `advance-loop` / `runner-in-ci` spec, and should reconcile with the deferred PR-2 `bounce-atomic-cutover-retire-stuck-lock`. The related "no PR ⇒ no review-thread for a tasking block" point is secondary (inherent to blocking before integrate) but worth noting in the same ruling so the human knows WHERE to read the reason (the question sidecar), and whether a tasking block should instead OPEN the PR and post the block as a review (a bigger change — propose-then-review-on-PR, matching the build path).

## Refs

- `tasking.ts` — `review-blocked` / `sidecar-violation` / `review-unparseable` branches (~L743-825), each `routeToNeedsAttention` + return `exitCode: 1, outcome: 'needs-attention'`.
- `needs-attention.ts` — `surfaceStuckToNeedsAttention` (~L1970): needsAnswers+sidecar commit on main, then `releaseItemLock`.
- `item-lock.ts` — `stuck` lock STATE is retired (mark-stuck is a no-op shim ~L672-718); a parked item is a `needsAnswers:true` body + `kind:'stuck'` sidecar on `main`, NOT a `state:stuck` ref.
- Deferral provenance: `work/tasks/done/bounce-surfaces-stuck-sidecar-and-releases-lock.md` (exit-code flip explicitly OUT of scope), sibling PR-2 `bounce-atomic-cutover-retire-stuck-lock`, and `failure-cause-classification-model-vs-git-vs-agent` (the cause taxonomy to reuse for option C).
- Live evidence: rocketh advance-lifecycle #10, leg `advance-propose (spec:unknown-signer-core)` failed.

## Update 2026-07-21 — RESOLVED (option A + close-the-stale-PR)

Maintainer ruling: **(A)** a clean needs-attention SURFACE is GREEN (exit 0), and the surface wording must not sound like it involves a lock. PLUS a coupled feature: because the multi-run bug could already have opened a PR, a DISAPPROVE should CLOSE that PR (keep the branch) with the review as the closing comment, and a later approving re-task should REOPEN it. Implemented:

- `tasking.ts`: all four not-landed tasking terminals (`review-blocked`, `sidecar-violation`, `review-unparseable`, decomposition-unclear loop exhaustion) now go through a shared `surfaceTaskingBlock` helper that returns **exit 0** on a clean surface (only a surface that FAILED to publish stays non-zero). This matches the BUILD path, which `review-gate-pr.test.ts` shows already exits 0 on a clean-surface bounce (PR-2b D3) — so this closes the tasking-vs-build inconsistency the observation flagged. Messaging reworded from "marked the per-item lock stuck" → "parked it for your attention" (the stuck lock state is retired; the lock is RELEASED).
- `integrator.ts` / `github.ts`: new advisory `ReviewProvider.closeRequestOnBranch` (GitHub `gh pr close <branch> --comment <review>`, NO `--delete-branch`) — only-if-a-PR-exists, propose-only. `openRequest` now REOPENS a previously-CLOSED PR (`gh pr reopen`) instead of opening a duplicate, so an approving re-task returns to the same PR. `NoneProvider` + the legacy bridge degrade (close nothing, keep branch).
- Tests: `github.test.ts` (close-if-open / no-op-if-none / keep-branch / reopen-on-closed / no-reopen-on-open), `task-acceptance-gate.test.ts` (block ⇒ exit 0; propose-block closes the PR with the review as comment + never opens-to-close; merge-block never consults the close seam), `tasking.test.ts` (decomposition-unclear ⇒ exit 0). Full suite green (3206 tests) + `pnpm format:check`.

NOTE (deliberately NOT done): the BUILD path's block already exits 0 (PR-2b D3), so no change there. The broader "should EVERY needs-attention exit code be 0" reconciliation (the deferred PR-2 `bounce-atomic-cutover-retire-stuck-lock`) is still open for the non-tasking terminals (`gate-failed`/`rebase-conflict`/`agent-*`) — this fix scopes to the tasking review-block surface the observation was about.

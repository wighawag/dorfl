---
title: 'Ratifying three unrecorded decisions from the needs-attention folder cutover (complete.ts default branch, vestigial `recovering` field, changed CompleteRefusal wording)'
status: accepted
created: 2026-07-12
supersedes:
superseded_by:
---

# ADR: three residual decisions from the `needs-attention/`-folder cutover

## Context

The task `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` completed the cutover started by `cutover-needs-attention-becomes-lock-stuck-recovery-surface`: the `work/needs-attention/` folder is retired, a stuck item is now the per-item lock `state: stuck` with the body resting in `work/tasks/ready/`, and every dead folder-recovery reader was deleted. **Update 2026-07-14:** the `state: stuck` snapshot above is HISTORICAL; the `stuck` lock state has since been retired by spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (task `retire-stuck-lock-state`) — a bounced item is now `needsAnswers:true` + a `stuck`-kind sidecar on `main` and the lock is released; `LockState` is `'active'` only. See the 2026-07-14 addendum to ADR `ledger-status-on-per-item-lock-refs`. This ADR's own three decisions (a/b/c below) are unaffected. Gate 2 (code review) approved that task but flagged three in-scope decisions it made yet did not record on its done-record `## Decisions` block. This ADR is the single durable anchor for those three, and is cheaper than amending the already-landed done-record. (It is opened as a deliverable of the follow-up task `followup-nits-from-finish-needs-attention-folder-cutover`.)

## Decision

### (a) `complete.ts`'s post-cutover default source branch falls through to `'tasks-ready'` so the `existsSync(sourcePath)` refusal fires

**Context.** `performComplete` (`packages/dorfl/src/complete.ts`, roughly L745-805) resolves which `work/` folder a build integrates FROM into a `source` value, then constructs `sourcePath` and refuses with `CompleteRefusal` when that file is absent. Pre-cutover a missing source could dispatch to a `work/needs-attention/` folder-probe; that residence no longer exists.

**Decision.** When none of the recognised source folders (`in-progress`, `tasks-backlog`, `done`/continue-build) holds the slug, `source` defaults to `'tasks-ready'`, so `sourcePath` resolves to the canonical pool path the refusal message names, and the existing `existsSync(sourcePath)` check fires the explicit "nothing to complete" `CompleteRefusal`.

**Why.** Post-cutover there is no legitimate `needs-attention` residence to probe, so the default branch treats a missing source as the canonical "nothing to complete" shape rather than dispatching to a folder-probe. The refusal is the correct terminal for a slug that lives nowhere the build can source from. (The task's final acceptance criterion explicitly asked for this to be recorded.)

### (b) The `recovering: boolean` field on `IntegrationCoreInput` is kept as VESTIGIAL

**Context.** `IntegrationCoreInput.recovering` (`packages/dorfl/src/integration-core.ts`, around L307-326, read at L639, `void recovering;` at L1109-1111) was `true` when completing FROM `work/needs-attention/` under the legacy folder model. The cutover deleted every internal reader (the `if (recovering)` re-gate paths) and made every internal caller hard-code `false`.

**Decision.** The field is PRESERVED on the input type even though it is now inert: every branch that read it is gone, and it is only retained so callers compile unchanged. `void recovering;` marks it deliberately unused.

**Why.** A cross-caller API-stability decision: removing the field is a coordinated breaking change across every caller of the integration core, and the benefit (deleting one inert boolean) does not outweigh that cost while the field is harmless. A future coordinated task can remove it once external callers can be migrated; that removal is explicitly out of scope here.

### (c) The `CompleteRefusal` user-visible message changed

**Context.** The genuine-strand refusal in `complete.ts` used to read `work/tasks/ready/${slug}.md (nor work/needs-attention/${slug}.md) found`, naming the two folders it had probed.

**Decision.** The message is now `work/tasks/ready/${slug}.md not found — nothing to complete (already done, or wrong slug?)`.

**Why.** Post-cutover the parenthetical about `work/needs-attention/${slug}.md` is misleading: that residence is impossible, so naming it as a probed-and-absent location would send the reader looking at a folder that can never hold the slug. The new wording drops the dead reference and gives an actionable hint (the slug is already done, or it was mistyped), which is the real cause when this refusal fires.

## Consequences

- All three decisions were already implemented by the finished cutover task; this ADR records the WHY so future readers of `complete.ts` / `integration-core.ts` do not re-litigate them.
- The vestigial `recovering` field remains a known, deliberate loose end (b) with a clear removal path; it is not an oversight.
- The refusal wording (c) is user-visible, so a future change to it should preserve the "already done, or wrong slug?" hint that replaced the misleading `needs-attention/` reference.

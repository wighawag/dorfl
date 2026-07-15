---
title: A spec is tasked ATOMICALLY at its own scope (every story becomes a task, or none does); a spec that can only be partially tasked is MIS-SCOPED and must be SPLIT — the folder taxonomy stays BINARY, partial tasking is FORBIDDEN
status: accepted
created: 2026-07-14
supersedes:
superseded_by:
---

# ADR: tasking is atomic-or-split — no "partially tasked" state

## Context

The `work/` contract makes tasked-ness a BINARY folder state: a spec rests in `work/specs/ready/` (the to-task pool) and, when tasked, moves durably to `work/specs/tasked/` on `main`. The folder is the sole signal for tasked-ness, exactly as `work/tasks/done/` is for tasks (WORK-CONTRACT.md, "The spec lifecycle").

The word "atomic" already appears throughout the contract, but only for the tasking TRANSITION (the runner-owned `ready/ → tasked/` move committed in the SAME commit that emits the `tasks/` items) and for the CLAIM. The tasking COMPLETENESS was never required to be atomic. Nothing in TASKING-PROTOCOL.md, `to-task`, or WORK-CONTRACT.md required that EVERY user story in a spec become a task before that transition fired. So a spec bundling a confident subset of stories plus a gated remainder could have JUST its confident subset tasked and built, land in `specs/tasked/` as if whole, and paper the un-tasked remainder over in prose.

`needsAnswers: true` is a WHOLE-spec gate that only mechanically stops the AUTO-tasker. A human on the `to-task` path was not mechanically stopped from tasking only the answered stories and moving the spec to `tasked/` anyway. That is the gap: the human path could sneak past the whole-spec gate by tasking a subset.

The concrete harm (worked example: `wighawag/wezig`'s `browser.md`, a 12-story spec carrying both `humanOnly` and `needsAnswers` with six deliberately-deferred strategic forks): stories 1-6 were tasked and built while stories 7-12 were left as a prose note. The spec sat in `specs/tasked/` looking whole; `tasks/ready/` was empty so the board read "nothing to do" while half the spec was un-tasked. Tasking the confident subset FELT like progress, but it silently committed the project to a SEQUENCING decision (render-subset first) that should have been made deliberately, not by default. Had `browser.md` been forced to be tasked whole-or-not-at-all, its six open questions would have BLOCKED it, forcing the split-into-smaller-specs decision UP FRONT — exactly where a better sequencing framing would have been chosen before any tasks were written and built.

## Decision

**A spec is tasked ATOMICALLY at its own scope: every user story in it becomes a task now, or NONE does.** A spec that can only be partially tasked is MIS-SCOPED and must be SPLIT into (a) a fully-taskable spec and (b) a separate spec for the gated/deferred remainder, grouped logically. Partial tasking is FORBIDDEN; there is NO "partially tasked" folder state.

Both tasking paths enforce this:

- **The auto-tasker** already refuses the whole spec on `needsAnswers`/`humanOnly` (its gate is whole-spec by construction — `resolveTaskingEligibility`). No behaviour change is needed there; the doc simply makes explicit that the whole-spec refusal IS the atomicity guarantee on that path.
- **The human `to-task` path** gains the symmetric completeness rule: before tasking, confirm EVERY story is taskable now; if ANY story is gated/deferred/unanswered, STOP and split the spec rather than tasking a subset.

Authoring is nudged to catch the mis-scoping earlier: `to-spec` gains a right-sizing check — a spec whose stories span multiple confidence tiers (committed direction vs gated "direction not commitment") should be authored as SEPARATE specs, or explicitly flagged as a split candidate, so the split happens at authoring, not at tasking.

## Consequences

- **`specs/tasked/` residence becomes HONEST again.** A spec is there iff ALL of it was tasked, matching the "folder is the sole signal" contract intent (which the partial state silently violated). No prose note is needed to explain a half-state the folder cannot represent, because the half-state cannot exist.
- **`needsAnswers` reads cleanly as an un-sneak-past-able whole-spec gate.** Partial-answerability IS the split signal: if part of a spec is answerable and part is not, you split, task the answerable spec, and leave the gated spec in `ready/` with its questions.
- **Atomicity is WITHIN a spec, never across the tree.** Cross-spec ordering stays expressed by `taskedAfter:` (unchanged). Splitting a spec naturally produces `taskedAfter:` edges between the pieces (the gated spec is `taskedAfter:` the committed one where it depends on it).
- **The taxonomy stays BINARY.** We deliberately did NOT add a `specs/partially-tasked/` state or a per-story "which stories are tasked" marker. The whole point is that partial tasking should not be a supported state; the fix is to forbid it and force a split, keeping `ready/` / `tasked/` the only two states.
- **`browser.md`'s shape is the canonical anti-pattern:** one spec mixing a committed v0 slice with a gated "beyond v0" direction behind open questions. The doc-consistency guard treats "task a confident subset, defer the rest in prose" as the failure mode this ADR exists to stop.

## Considered alternatives

- **Add a real "partially tasked" state** (a `specs/partially-tasked/` folder, or a per-story `covers`-tasked marker on the spec). Rejected: it legitimises exactly the accidental-sequencing trap this ADR closes, and it breaks the "folder is the sole signal" invariant by requiring an in-file record of which stories are tasked. The binary taxonomy is the feature.
- **Do nothing / rely on reviewer judgement.** Rejected: the gap is mechanical (the human path can move a spec to `tasked/` after tasking a subset with no check), so it needs a mechanical rule in the discipline, not a hope that every human tasker notices.

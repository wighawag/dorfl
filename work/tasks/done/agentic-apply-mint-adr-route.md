---
title: Agentic apply — add the mint-adr route
slug: agentic-apply-mint-adr-route
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [agentic-apply-retire-disposition-vocabulary]
covers: [2]
---

## What to build

Add the `mint-adr` outcome to the agentic apply path, completing US #2's "mint an
ADR" capability that the keystone deliberately DEFERRED (there was no ADR-mint path
to reuse at launch). A thin vertical path through logic + tests:

- **Allow `adr` in advance-apply.** The shared decision engine already carries
  `adr` in its superset verdict union; this task widens advance-apply's ALLOWED
  set from `{mint-task | mint-spec | delete-source | ask-follow-up}` to additionally
  permit `mint-adr`. The engine stays outcome-agnostic (SPEC decision 14); only the
  caller's allowed subset changes.
- **The ADR-mint route.** When the verdict is `mint-adr`, create a new ADR in
  `docs/adr/` (NOT in `work/` — ADRs live outside the work board) using the
  `work/protocol/ADR-FORMAT.md` shape (`NNNN-slug.md` or the repo's existing ADR
  naming, one decision per file, the context/decision/why sections), built FROM the
  answered question(s) + the source item (self-contained — the decision's why is
  carried in). The source observation + its sidecar are deleted in the SAME atomic
  commit as the ADR create (delete-on-promote, mirroring the task/spec mint route).
- **Self-containment + atomicity preserved.** Same guarantees as the task/spec mint
  route: the ADR is buildable/readable alone; source deletion rides the create
  commit; a CAS-loser backs off without deleting the source.

Intake does NOT gain `adr` (SPEC decision 14 — out of scope; unchanged here).

## Acceptance criteria

- [ ] advance-apply's allowed-outcome set includes `mint-adr` (the shared engine's
      superset already had it; only the caller subset widens).
- [ ] A `mint-adr` verdict creates a self-contained ADR in `docs/adr/` per
      `work/protocol/ADR-FORMAT.md`, built from the answer(s) + source item.
- [ ] The source observation + its sidecar are deleted in the SAME atomic commit as
      the ADR create; a CAS-loser backs off leaving the source intact.
- [ ] No regression to the `mint-task`/`mint-spec`/`delete-source`/`ask-follow-up`
      routes the keystone shipped.
- [ ] Tests cover the `mint-adr` route with a STUBBED verdict (no model): ADR
      written to `docs/adr/`, source + sidecar deleted in the same commit. Mirror
      the existing apply-persist test style.
- [ ] Tests that mutate git ISOLATE their work in throwaway repos; no shared/global
      location is written.

## Blocked by

- `agentic-apply-retire-disposition-vocabulary` — the keystone ships the
  agent-driven apply path with the launch allowed-set (no adr) and the mint-task/
  mint-spec route this extends. This task widens the allowed-set and adds the adr
  route on top, editing the same apply seam (so it is serialized after the
  keystone, not parallel).

## Prompt

> Add the `mint-adr` outcome to dorfl's agentic apply path. The keystone task
> `agentic-apply-retire-disposition-vocabulary` shipped the agent-driven apply rung
> with the LAUNCH allowed-outcome set `{mint-task | mint-spec | delete-source |
> ask-follow-up}` and deliberately DEFERRED `mint-adr` because no ADR-mint path
> existed to reuse. This task completes US #2's "mint an ADR" capability.
>
> Domain vocabulary + where to look:
> - The shared decision engine (task `decision-engine-shared-decide-seam`) already
>   carries `adr` in its SUPERSET verdict union; the engine is outcome-AGNOSTIC (SPEC
>   decision 14). So this task does NOT touch the engine's union — it widens the
>   advance-apply CALLER's allowed SUBSET to additionally permit `mint-adr`.
> - The apply rung (the module exporting `applyAnsweredQuestions`) routes verdicts.
>   The `mint-task`/`mint-spec` routes reuse `promoteObservation` /
>   `createItemThroughCas`, which mint into `work/` (tasks-ready / specs-proposed)
>   with a task/spec body shape and delete the source in the same atomic commit. An
>   ADR is DIFFERENT: it lives in `docs/adr/` (OUTSIDE the work board), with the
>   `work/protocol/ADR-FORMAT.md` shape (`NNNN-slug.md` or the repo's existing ADR
>   naming — inspect `docs/adr/` for the convention; one decision per file; the
>   context/decision/why sections). There is NO existing ADR-mint helper — you are
>   adding the route. Build the ADR body FROM the answered question(s) + the source
>   item so the decision's why is self-contained.
> - Preserve the keystone's guarantees on this route: the source observation + its
>   sidecar are `git rm`-ed in the SAME atomic commit as the ADR create
>   (delete-on-promote); a CAS-loser backs off WITHOUT deleting the source. Decide
>   whether to extend `promoteObservation` with an `adr` artifact type or to add a
>   sibling mint helper for the `docs/adr/` target — judge which is cleaner given
>   that ADRs land outside `work/` (a `work/`-folder-shaped helper may not fit; a
>   sibling may be clearer). RECORD that choice.
> - Intake does NOT gain `adr` (SPEC decision 14) — do not touch intake.
>
> "Done": a `mint-adr` verdict writes a self-contained ADR to `docs/adr/` per
> ADR-FORMAT, source + sidecar deleted in the same commit, advance-apply's allowed
> set widened to include it, no regression to the other routes, with a stubbed-
> verdict test over a throwaway repo. Acceptance:
> `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the keystone landed with the no-adr launch allowed-set and
> the mint-task/mint-spec route this extends, that the shared engine's union still
> includes `adr`, and that `docs/adr/` + `work/protocol/ADR-FORMAT.md` are still the
> ADR home/shape. If the keystone landed differently than assumed, do NOT build on
> the stale premise — route the task to needs-attention with the discrepancy as the
> reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building (extend
> `promoteObservation` vs a sibling ADR-mint helper, the ADR slug/numbering scheme,
> how the answer+source map into the context/decision/why). If a choice meets the
> ADR gate (hard to reverse + surprising without context + a real trade-off), write
> the WHY as an ADR in `docs/adr/`; otherwise note it briefly in the done record /
> PR description. An un-recorded in-scope decision is a review FINDING, not a silent
> default.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```

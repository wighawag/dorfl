---
title: 'An answered observation sidecar must route to the apply pool (not sit in gated-off triage)'
slug: route-answered-observation-sidecar-to-apply-pool
covers: []
blockedBy: []
---

## What to build

`buildLifecyclePools` (the lifecycle classifier that feeds the autonomous triage / surface / apply rungs) never routes an ANSWERED observation into the `apply` sub-pool. Observations are classified ONLY by their `triaged:` frontmatter marker into the `triage` sub-pool, and the observation candidate the classifier receives carries NO answered-sidecar signal at all. So an observation whose question sidecar (`work/questions/observation-<slug>.md`) is fully answered, but which has no `triaged:` marker (the normal case, since the answer discharges the note by deletion rather than stamping a marker), lands in `triage`, which is gated OFF by default (`observationTriage` create-gate). It therefore never reaches the `apply` rung's agentic decision seam, so the human's committed answer is never actioned: no task/spec/adr is minted, no delete happens. The apply rung's consumer for an answered observation (`promoteObservation` / the agentic apply-decide seam in `advance.ts`) already EXISTS and is wired; the gap is purely that the CLASSIFIER does not feed an answered observation to it.

This is the sharp, code-level sibling of the already-recorded `answered-observation-body-block-is-invisible-to-promote-path` observation. That one is about an answer written in the WRONG channel (an in-body block instead of a sidecar). THIS task is the case where the answer is in the RIGHT channel (a correct, all-answered sidecar) and is STILL invisible, because the routing classifier only looks at `triaged:` for observations and has no path from "observation + all-answered sidecar" to `apply`.

The end-to-end fix: thread each observation's resolved sidecar answered-state through the read/gather layer to the classifier, and in the classifier route an observation with an all-answered sidecar to `apply` (CONSUME, always-on, ungated, exactly as an answered task/spec sidecar is), leaving an untriaged observation with no/ pending sidecar in `triage` as today. The apply rung then runs its existing agentic decision on the observation and actions the human's answer (mint task/spec/adr, or delete the source), discharging the sidecar in the same atomic commit as it already does for the task/spec apply path.

Concretely (verified against current code, re-confirm at build time — reference by module/concept, not line numbers, they drift):

- `LedgerObservationItem` (the read-seam observation shape) carries only `file` / `slug` / `triaged` — no sidecar or answered-state. It needs the observation's resolved active sidecar (or at least its all-answered boolean), read via the SAME sidecar resolver the `needsAnswers` task/spec candidates already use (do NOT add a second reader). The mirror-side gather (`gatherLifecycleMirror`, reading the committed `<ref>:work/questions/...` via `git show`) must resolve it symmetrically to the in-place gather, since CI's propose matrix runs against the bare mirror.
- `buildLifecyclePools` must, for an observation whose resolved sidecar is all-answered, push it to `apply` with `namespace: 'observation'`; an observation with no sidecar or a pending sidecar stays a `triage` candidate (gated) as now. Preserve the create-vs-consume invariant (ADR `ci-config-policy-and-gate-family` §4): apply is always-on even with both create-gates off.
- Confirm the apply rung / driver dispatch (`advance.ts` apply seam + `advance-drivers.ts`) already handles the `observation` namespace end-to-end (the agentic apply-decide seam is documented as running on a fully-answered OBSERVATION). If a dispatch arm is missing for `observation` in apply, wire it to the existing `promoteObservation` / apply-decide path; do not invent a new one.

## Acceptance criteria

- [ ] `buildLifecyclePools` routes an observation with an ALL-ANSWERED sidecar to the `apply` pool (namespace `observation`), even with the triage/surface create-gates OFF (consume is always-on).
- [ ] An observation with NO sidecar, or a PENDING (not all-answered) sidecar, still routes to `triage` (gated) exactly as today — no regression to the untriaged-observation path.
- [ ] The observation's answered-sidecar state is resolved through the EXISTING sidecar read seam (no second/divergent reader), in BOTH the in-place gather and the mirror gather, so CI's bare-mirror propose matrix sees the same routing a local `scan --here` does.
- [ ] The apply rung actions a fully-answered observation end-to-end via the existing agentic apply-decide / `promoteObservation` path (mints the human-chosen task/spec/adr or deletes the source), discharging the observation + its sidecar atomically — no new consumer invented.
- [ ] Tests cover: (a) classifier routes answered-observation → apply and untriaged/pending → triage; (b) the mirror gather resolves the same answered-state as the in-place gather; (c) an end-to-end apply of a fully-answered observation produces the decided artifact and removes the source+sidecar. Mirror the repo's existing lifecycle-pools / gather / triage-persist test style.
- [ ] Full acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately. (Related, not blocking: the participation-gate fix `fix(scan): a repo participates on ANY lifecycle pool` is what makes CI enumerate the observations at all; this task is what lets CI ACTION the answered ones.)

## Prompt

> Self-contained. Goal: make the autonomous lifecycle ACTION an answered observation sidecar. Today `dorfl scan`'s lifecycle classifier (`buildLifecyclePools` in `lifecycle-pools.ts`) splits work into three sub-pools: `triage` (untriaged observations, a CREATE act, gated off by default), `surface` (needsAnswers tasks/specs with no answered sidecar, CREATE, gated), and `apply` (needsAnswers items WITH an all-answered sidecar, CONSUME, always-on). The bug: observations are routed to `triage` PURELY by their `triaged:` frontmatter marker; the observation candidate carries no answered-sidecar signal, so an observation with a correct, fully-answered `work/questions/observation-<slug>.md` sidecar and no `triaged:` marker (the normal case) sits in the gated-off `triage` pool forever and the human's answer is never actioned. The apply consumer already exists (`promoteObservation` in `triage-persist.ts` and the agentic apply-decide seam described in `advance.ts`); only the CLASSIFIER fails to feed an answered observation to it.
>
> Fix: (1) thread each observation's resolved active sidecar (or its all-answered boolean) into the observation shape the classifier receives (`LedgerObservationItem` via the read seam), resolved with the SAME sidecar resolver the task/spec `needsAnswers` candidates use — in BOTH `gatherLifecycleInPlace` and `gatherLifecycleMirror` (the mirror path reads the committed `<ref>:work/questions/...` via `git show`; CI's propose matrix runs against the bare mirror, so the two MUST agree). (2) In `buildLifecyclePools`, route an observation whose sidecar is all-answered to `apply` (namespace `observation`, always-on, ungated), leaving no-sidecar / pending-sidecar observations in `triage` as today. (3) Verify the apply rung + driver dispatch handle the `observation` namespace end-to-end; if an arm is missing, wire it to the existing `promoteObservation` / apply-decide path (do NOT invent a new consumer). Preserve the create-vs-consume invariant (ADR `ci-config-policy-and-gate-family` §4): apply fires even with both create-gates off.
>
> FIRST, check this task against current reality (launch snapshot, may have drifted): re-read `lifecycle-pools.ts`, `lifecycle-gather.ts`, `ledger-read.ts` (`LedgerObservationItem`), `sidecar.ts` (the resolver + `allAnswered`), `triage-persist.ts` (`promoteObservation`), and `advance.ts` (the apply-decide seam). If the routing or the apply consumer already handles answered observations differently than described, adjust; do not build on a stale premise (route to needs-attention if a dependency landed differently). Motivating evidence: this repo currently has ~66 answered observation sidecars in `work/questions/` that `scan --here` reports in `lifecycle.triage` (not `apply`), so none are actioned autonomously.
>
> Test at the seams the repo already tests: the pure classifier (`buildLifecyclePools`), the two gathers (in-place vs mirror answered-state parity), and the triage-persist apply (throwaway-git-repo pattern). RECORD any non-obvious in-scope decision (e.g. whether a `triaged:`-marked observation that ALSO has an answered sidecar prefers apply or stays settled) per the task template's decision-recording rule. Done = the classifier routes answered observations to apply, CI can action them, and the full acceptance gate is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim route-answered-observation-sidecar-to-apply-pool --arbiter origin   # default --arbiter origin
# then start work on the updated main:
git fetch origin && git switch -c work/route-answered-observation-sidecar-to-apply-pool origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/route-answered-observation-sidecar-to-apply-pool.md work/tasks/done/route-answered-observation-sidecar-to-apply-pool.md
```

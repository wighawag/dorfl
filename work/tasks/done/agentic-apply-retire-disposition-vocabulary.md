---
title: Agentic apply rung + retire the disposition vocabulary (keystone)
slug: agentic-apply-retire-disposition-vocabulary
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [decision-engine-shared-decide-seam]
covers: [1, 2, 3, 4, 6, 7, 8]
---

## What to build

The KEYSTONE: flip the apply rung from DETERMINISTIC disposition-routing to an
AGENT-DRIVEN decision, AND remove the now-dead disposition vocabulary in the same
task (the removal is tightly coupled to the shift — keeping both would leave a
window where deterministic routing and agent routing coexist in the same hot
files). The agentic apply decision SUBSUMES the triage rung's disposition
machinery: there is ONE decision engine, not a disposition field the triage rung
stamps and the apply rung later executes. A thin vertical path through logic +
tests:

- **Agentic apply (the core shift).** When a sidecar is FULLY answered, the apply
  rung calls the shared `decide(input, allowedOutcomes)` engine over the input
  `(the answered question(s) + the SOURCE item, its type, and surrounding signal)`,
  allowing `{mint-task | mint-spec | delete-source | ask-follow-up}` at LAUNCH. The
  decision is grounded in the source item's FULL context (body, type, signal), not
  just the latest answer text. Route the verdict:
  - `ask-follow-up` → the EXISTING append/re-pause loop (`appendQuestions` mints
    `qN+1…`, prior answers preserved, `needsAnswers:true` stays, re-pause in one
    commit). Follow-ups are ONE BATCH (never a drip): one round of answers yields
    one decision (act, or one batch of follow-ups).
  - `mint-task` / `mint-spec` → the mint-and-delete-source path (reuse
    `promoteObservation` / `createItemThroughCas`, whose artifact types ARE exactly
    `task`/`spec`); the source is deleted in the SAME atomic commit as the create
    (delete-on-promote, preserved).
  - `delete-source` → the discharge-by-deletion path (`git rm` source + sidecar in
    a revertible commit, reason in the commit message). Fires DIRECT, no
    confirm/preview step (decision 12); the human's answer is the source of truth.

  **`mint-adr` is DEFERRED (deliberate non-delivery).** The SPEC's Solution / US #2
  list "mint an ADR" as an agentic outcome, but there is NO ADR-mint path in the
  codebase today (`promoteObservation` mints only `task`/`spec` into `work/`; ADRs
  are hand-authored in `docs/adr/` with the `ADR-FORMAT.md` shape). Per SPEC decision
  14 the engine is outcome-AGNOSTIC, so `adr` is added LATER by a separate decision.
  This keystone's advance-apply allowed set therefore OMITS `adr` at launch; the
  shared decision engine (task `decision-engine-shared-decide-seam`) KEEPS `adr` in
  its superset verdict union (advance-apply simply does not permit it yet). Adding
  the `mint-adr` route is the follow-on task `agentic-apply-mint-adr-route` (blocked
  by this one).
- **Apply fires ONLY on a fully-answered sidecar.** Keep the existing `allAnswered`
  gate (a subset-answered sidecar stays a classifier NO-OP; never invent an answer).
- **Retire the disposition vocabulary.** REMOVE the `disposition=` field, the
  `DISPOSITIONS` set, the `SidecarDisposition` type, the per-entry `disposition`
  parse/serialise, the most-decisive-disposition PICKER (`pickTerminal` +
  `TERMINAL_PRECEDENCE`), and the `keep` disposition with its `triaged:keep`
  resting-state machinery. A sidecar entry becomes BINARY: no-answer | answered.
  `allAnswered`/`pendingEntries` stay (binary answered-ness).

**Subsume the triage rung onto the agentic decision (the expanded scope).** Today
the observation TRIAGE rung surfaces a promote/keep/delete question that carries a
`disposition` token, the surface/triage gates EMIT that token, and the apply rung
later EXECUTES it via `answeredPromoteArtifact` + the `applyRung` promote branch.
With subsume:

- The triage rung still surfaces the "what becomes of this signal?" question, but
  it is a PLAIN question — NO `disposition` token. Remove the disposition field
  from the surfaced-question shape and the surface/triage GATE code
  (`surface-gate.ts`, `triage-gate.ts`'s emitted-question disposition plumbing).
- When the human answers, the AGENTIC apply decision (not a stamped field) reads
  the answer + source and decides `mint-task | mint-spec | delete-source |
  ask-follow-up` (no `adr` at launch — see the deferral above). The artifact-type
  SELECTION (task vs spec) now comes from the AGENT'S VERDICT, NOT a human
  `promote-*` field. REMOVE `answeredPromoteArtifact` and re-point the `applyRung`
  promote branch at the agentic decision path. (The former `promote-adr`
  disposition, which `answeredPromoteArtifact` mapped onto a TASK, has no
  successor verdict at launch — it folded into `mint-task`/`mint-spec` already, so no
  capability is lost by deferring the distinct `mint-adr`.)
- The CONSERVATIVE `observationTriage: 'auto'` exception STAYS (it is a separate,
  narrow no-question path, not the disposition vocabulary): `duplicate` → discharge
  by deletion (unchanged). Its `map` case currently stamps `triaged:keep` — since
  `keep`/`triaged:keep` is being removed, `map` must instead DISCHARGE the redundant
  note BY DELETION (the note is settled onto its existing home; record the mapping
  in the commit message, then `git rm`, mirroring `duplicate`). There is no resting
  `triaged:keep` note any more (the SPEC's "still-open, acted-on, or deleted").

CRITICAL boundary — do NOT regress the LIFECYCLE state: the `needs-attention/`
LIFECYCLE folder (bounced build / stuck lock) and the dropped/needs-attention
work-item terminal MOVES are a SEPARATE concern and must keep working. Only the
triage-ANSWER `needs-attention` disposition is removed, NOT the lifecycle routing,
`requeue` recovery, or status surfacing.

Self-containment on promote (decision 10) MUST be preserved by the agentic path: a
`mint-task`/`mint-spec` verdict carries the answer(s) + remaining open-question
scoping into the spawned artifact, source deleted in the same atomic commit. A
regression test for this belongs in THIS task.

**Extract `resolveItemPathByIdentity` into a neutral module (shared-helper
hygiene).** Today `resolveItemPathByIdentity` (the by-identity "where is the source
item?" resolver) lives in `apply-persist.ts` and is NOT re-exported from the
package index. The sibling task `direct-delete-question-cli-helper` needs the SAME
resolver, and importing it from `apply-persist.ts` (this hot file, which this task
rewrites) creates a stale-read coupling. As part of this task, MOVE
`resolveItemPathByIdentity` (and the `APPLY_LIFECYCLE_FOLDERS` map it scans) into a
NEUTRAL module (e.g. `item-path.ts` / `work-layout.ts` — builder's choice) and have
`apply-persist.ts` import it from there. Export it from the package index so the CLI
verb (#4) AND the orphan-sidecar gc sweep (the sibling `orphan-sidecar-gc-sweep`)
can reuse it. This makes the resolver a stable, owned seam imported from a non-hot
file.

**Orphan-sidecar reap is NOT in this task** (corrected scope). An orphan — a
sidecar whose SOURCE item was deleted out-of-band — can NOT be reaped by the apply
rung: the advance driver enumerates ITEMS in the lifecycle pools, and a deleted
source is in no pool, so no per-item tick ever runs on it (neither `apply` nor
`no-op` is reached — the classifier never sees it). The orphan's only on-disk trace
is the sidecar under `work/questions/`, so reaping it MUST be a SWEEP over that
directory — owned by the sibling task `orphan-sidecar-gc-sweep` (folded into
`dorfl gc`, which runs on the scheduled CI tick). This task does NOT touch orphan
reaping; it only provides the shared `resolveItemPathByIdentity` seam that sweep
imports.

## Acceptance criteria

- [ ] On a fully-answered sidecar, the apply rung calls the shared decision engine
      over `(answered questions + source item + type/context)` with the LAUNCH
      allowed set `{mint-task | mint-spec | delete-source | ask-follow-up}` (NO
      `adr` — deferred to `agentic-apply-mint-adr-route`).
- [ ] The shared decision engine's superset union still INCLUDES `adr`; only
      advance-apply's allowed SUBSET omits it (verifiable: a stubbed `adr` verdict
      to advance-apply is rejected by the allowed-outcome guard, not dispatched).
- [ ] `ask-follow-up` routes into the existing append/re-pause loop (one batch of
      `qN+1…`, prior answers preserved, `needsAnswers:true` stays, one commit).
- [ ] `mint-task`/`mint-spec` mint a SELF-CONTAINED artifact and delete the source
      in the SAME atomic commit; `delete-source` `git rm`s source + sidecar in one
      revertible commit with the reason in the commit message, DIRECT (no confirm
      step).
- [ ] The `disposition=` field, `DISPOSITIONS`, `SidecarDisposition`, the
      most-decisive picker, and `keep`/`triaged:keep` are GONE; a sidecar entry is
      binary (no-answer | answered).
- [ ] The triage rung is SUBSUMED: the surfaced triage question carries NO
      disposition token; the surface/triage GATE disposition plumbing
      (`surface-gate.ts`, `triage-gate.ts`) is removed; `answeredPromoteArtifact`
      is gone and the `applyRung` promote branch routes through the agentic
      decision; the artifact-type selection comes from the agent verdict, not a
      human `promote-*` field.
- [ ] The `observationTriage: 'auto'` exception still works: `duplicate` discharges
      by deletion (unchanged); `map` now discharges by deletion too (no more
      `triaged:keep`), with the mapping recorded in the commit message.
- [ ] No dangling `disposition` references remain in the advance/triage/surface
      seam (`advance.ts`, `advance-classify.ts`, `triage-persist.ts`,
      `triage-gate.ts`, `surface-gate.ts`, `apply-persist.ts`, `sidecar.ts`) —
      the build is clean (`pnpm -r build` green).
- [ ] The `needs-attention/` LIFECYCLE state and the work-item terminal moves are
      UNTOUCHED (no regression to bounced-build / stuck-lock routing, `requeue`, or
      status surfacing).
- [ ] A regression test proves self-containment on promote is preserved (answer(s)
      + open-question scoping carried into the spawned artifact, source deleted in
      the same commit).
- [ ] `resolveItemPathByIdentity` (+ its lifecycle-folder map) is MOVED to a
      neutral module and re-exported from the package index; `apply-persist.ts`
      imports it from there. (So the CLI verb in `direct-delete-question-cli-helper`
      reuses it without importing from this hot file.)
- [ ] Orphan-sidecar reaping is NOT in this task (it cannot ride the per-item apply
      path — a deleted source is never enumerated). The shared
      `resolveItemPathByIdentity` seam this task extracts is what the sibling
      `orphan-sidecar-gc-sweep` reuses.
- [ ] The apply rung still NEVER invents an answer (subset-answered ⇒ classifier
      NO-OP, asserted), and fires only on `allAnswered`.
- [ ] Tests cover each LAUNCH verdict outcome with a STUBBED verdict (no model):
      ask→append+re-pause; task/spec→mint self-contained + source deleted in the
      same commit; delete→source+sidecar removed, reason in commit message; AND a
      disallowed `adr` verdict is rejected (not dispatched). Mirror the existing
      apply-persist / sidecar test style.
- [ ] Tests that mutate git ISOLATE their work in throwaway repos (the existing
      apply-persist test pattern); no shared/global location is written.

## Blocked by

- `decision-engine-shared-decide-seam` — this rung consumes the shared
  `decide(input, allowedOutcomes)` engine that task introduces. (Also serialized
  against any sibling that edits `sidecar.ts` / `apply-persist.ts`.)

## Prompt

> This is the KEYSTONE of dorfl's agentic question-resolution feature. Flip the
> apply rung from DETERMINISTIC disposition-routing to an AGENT-DRIVEN decision,
> and in the SAME task remove the now-dead disposition vocabulary (the two are
> tightly coupled — a split would leave both routing paths alive at once in the
> two hot files). Build it as a thin vertical path through logic + tests.
>
> Domain vocabulary + where to look:
> - The APPLY rung lives in the engine-owned apply persist (the module exporting
>   `applyAnsweredQuestions`). Today its branch 2 is deterministic
>   disposition-routing via a most-decisive picker; replace that branch with a call
>   to the shared `decide(input, allowedOutcomes)` engine (from the dependency task
>   `decision-engine-shared-decide-seam`) over `(the answered question(s) + the
>   SOURCE item, its type and surrounding signal)`, allowing the LAUNCH set
>   `{mint-task | mint-spec | delete-source | ask-follow-up}`. NOTE: `mint-adr` is
>   DEFERRED — the shared engine's verdict union INCLUDES `adr`, but advance-apply
>   does NOT allow it yet (there is no ADR-mint path; `promoteObservation` mints
>   only task/spec, ADRs are hand-authored in `docs/adr/`). Pass advance-apply's
>   allowed SUBSET so a stubbed `adr` verdict is rejected by the allowed-outcome
>   guard, not dispatched. Adding `mint-adr` is the follow-on task
>   `agentic-apply-mint-adr-route`.
> - The SIDECAR contract (the module with `SidecarEntry`/`SidecarModel`,
>   `allAnswered`, `pendingEntries`, `appendQuestions`, parse/serialise) is the
>   binary answered-ness model. Keep `allAnswered`/`pendingEntries`/`appendQuestions`;
>   REMOVE the `disposition=` field, the `DISPOSITIONS` set, the
>   `SidecarDisposition` type, and the per-entry disposition parse/serialise. A
>   sidecar entry becomes BINARY: no-answer | answered.
> - In the apply persist, REMOVE the most-decisive picker (`pickTerminal` +
>   `TERMINAL_PRECEDENCE`) and the `keep` disposition with its `triaged:keep`
>   resting-state machinery (the `resolveWithKeepMarker` / `isTriagedKeep` / keep
>   marker constant). There is no "retain as resolved" state any more (a signal is
>   still-open, acted-on, or deleted).
> - REUSE the existing wiring, don't re-invent it: `ask-follow-up` routes into the
>   already-built append/re-pause branch (`appendQuestions` + the re-pause commit,
>   driven through `applyFollowups` in the advance tick); `mint-*` reuses
>   `promoteObservation` / `createItemThroughCas` (delete-on-promote in one atomic
>   commit); `delete-source` reuses the discharge-by-deletion path (`git rm` source
>   + sidecar in one revertible commit, reason in the commit message).
>
> SUBSUME the triage rung onto the agentic decision (this is the EXPANDED scope —
> read it carefully; a naive removal of just the sidecar field will NOT compile,
> because the advance/triage/surface seam produces and consumes the field):
> - Today the observation TRIAGE rung (`triageRung` in `advance.ts`) surfaces a
>   promote/keep/delete question that carries a `disposition` token. The surface and
>   triage GATES (`surface-gate.ts`, `triage-gate.ts`) EMIT that token onto the
>   surfaced question. The apply rung later EXECUTES it: `answeredPromoteArtifact`
>   (`advance.ts` ~:799) reads `entry.disposition === 'promote-spec'|'promote-task'|
>   'promote-adr'` and the `applyRung` promote branch (~:672) routes to
>   `promoteObservation`.
> - With subsume: the triage question becomes a PLAIN question (NO disposition
>   token). REMOVE the disposition field from the surfaced-question shape and from
>   the `surface-gate.ts` / `triage-gate.ts` emit plumbing. REMOVE
>   `answeredPromoteArtifact` and re-point the `applyRung` promote branch so an
>   answered observation flows through the SAME agentic apply decision as everything
>   else — the agent's VERDICT (`mint-task | mint-spec`) chooses the artifact type,
>   NOT a human `promote-*` field. Do NOT preserve the old `promote-spec`-wins
>   human-sizing precedence — it is dead. (The old `promote-adr` disposition mapped
>   onto a TASK in `answeredPromoteArtifact`; it folds into `mint-task`/`mint-spec`
>   — the DISTINCT `mint-adr` outcome is deferred, so nothing is lost.)
> - KEEP the conservative `observationTriage: 'auto'` exception — it is a SEPARATE,
>   narrow no-question path (`triage-gate.ts`'s `auto: true` for `duplicate`/`map`
>   → `autoDispositionObservation` in `triage-persist.ts`), NOT the disposition
>   vocabulary. `duplicate` → discharge by deletion stays as-is. But `map` currently
>   stamps `triaged:keep`, which is being removed: change `map` to DISCHARGE the
>   redundant note BY DELETION (record the mapping onto the existing item in the
>   commit message, then `git rm` the note, mirroring `duplicate`). There is no
>   resting `triaged:keep` note any more.
> - When you are done, `grep -rn disposition packages/dorfl/src` must show NO
>   remaining references to the disposition VOCABULARY in the question-resolution
>   seam (`sidecar.ts`, `apply-persist.ts`, `advance.ts`, `advance-classify.ts`,
>   `triage-persist.ts`, `triage-gate.ts`, `surface-gate.ts`). Incidental matches in
>   UNRELATED files (e.g. a comment in `item-lock.ts`/`integration-core.ts` that
>   does not refer to the sidecar disposition tokens) are fine — judge each; the
>   `auto`-triage `kind` (`duplicate`/`map`) is NOT a disposition token and stays.
>   The operator-facing PROSE (SURFACE-PROTOCOL.md + skills) is owned by the sibling
>   task `surface-skill-prose-drop-disposition-vocabulary` — do NOT edit those docs
>   here (that task is blocked on this one so the prose matches the shipped engine).
>
> Hard boundaries:
> - Apply fires ONLY on a FULLY-answered sidecar (keep the `allAnswered` gate; a
>   subset-answered sidecar is a classifier NO-OP). NEVER invent an answer — apply
>   only the human's recorded answer text. Keep the assertion that a subset apply
>   is a loud error.
> - Do NOT touch the `needs-attention/` LIFECYCLE state (bounced build / stuck
>   lock), the work-item terminal MOVES (`tasks/cancelled`, `specs/dropped`),
>   `requeue` recovery, or status surfacing. Only the triage-ANSWER `needs-attention`
>   disposition is removed, NOT the lifecycle routing. Removing the picker must not
>   regress the work-item terminal-move path that survives as a lifecycle concern.
> - Self-containment on promote (decision 10 of the source SPEC, established by the
>   landed discharge SPEC `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`):
>   a `mint-task`/`mint-spec` verdict MUST carry the answer(s) + remaining
>   open-question scoping into the spawned artifact, source deleted in the same
>   atomic commit. The agentic path must NOT regress this — add a regression test.
> - EXTRACT `resolveItemPathByIdentity` (+ `APPLY_LIFECYCLE_FOLDERS`) into a NEUTRAL
>   module (e.g. `item-path.ts`) and re-export it from the package index, then have
>   `apply-persist.ts` import it from there. The sibling CLI task
>   `direct-delete-question-cli-helper` reuses this resolver; keeping it in this
>   hot file would force that task to import from a file you are rewriting (a
>   stale-read coupling). This is the file-orthogonality fix — the resolver becomes
>   a stable owned seam.
> - ORPHAN-SIDECAR REAP is NOT in this task. An orphan (sidecar whose source was
>   deleted out-of-band) is never enumerated by the advance driver — it is in no
>   lifecycle pool, so no per-item tick (`apply`/`no-op`) ever runs on it. Reaping
>   it must be a SWEEP over `work/questions/`, owned by the sibling task
>   `orphan-sidecar-gc-sweep` (folded into `dorfl gc`). Your only obligation to that
>   task is the shared `resolveItemPathByIdentity` extraction above. Do NOT add an
>   orphan reap to the apply `vanished` branch (it would be dead code for the real
>   orphan case).
> - `delete-source` fires DIRECT (decision 12): no preview/confirm. The safety net
>   is the single revertible commit with the reason in the commit message (git
>   history is the archive); the human's answer is the source of truth the agent
>   must not invent against.
>
> "Done": the apply rung is agent-driven over the shared engine; the disposition
> vocabulary + picker + keep machinery are gone; the lifecycle state is untouched;
> self-containment is regression-tested; stubbed-verdict tests cover every LAUNCH
> outcome (ask→re-pause; task/spec→mint+delete-in-same-commit; delete→rm+reason)
> PLUS a disallowed-`adr`-verdict-rejected test. git tests run in throwaway repos.
> Acceptance: `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> The subsume scope above and the `map`→discharge-by-deletion change were RATIFIED
> by the human who drove this tasking (they are not your invention); build to them.
> If, while building, you discover the seam is shaped differently than described,
> treat it as drift (below), do not silently re-decide.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the disposition vocabulary, the `pickTerminal` picker, the
> `keep`/`triaged:keep` machinery, the `allAnswered` gate, the append/re-pause
> branch, the `promoteObservation`/discharge-deletion paths, AND the triage seam
> (`triageRung`, `answeredPromoteArtifact`, the `applyRung` promote branch, the
> `surface-gate.ts`/`triage-gate.ts` disposition emit, the `autoDispositionObservation`
> `duplicate`/`map` cases) are still as described, and that the
> `decision-engine-shared-decide-seam` dependency landed the engine shape this task
> consumes. If a dependency landed differently or an ADR
> superseded an assumption here, do NOT build on the stale premise — route the task
> to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is
> a needs-attention signal"). Building on a stale task produces wrong-but-compiling
> work.
>
> RECORD non-obvious in-scope decisions you make while building (e.g. how the
> source-item context is adapted into the decision input, what happens to a now-
> redundant terminal-move code path, the exact verdict→route mapping). If a choice
> meets the ADR gate (hard to reverse + surprising without context + a real
> trade-off), write the WHY as an ADR in `docs/adr/`; otherwise note it briefly in
> the done record / PR description. An un-recorded in-scope decision is a review
> FINDING, not a silent default.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```

## Requeue handoff (Gate-2 block — 2026-06-25, FIXABLE, continue from kept branch)

A prior build of this task reached Gate-1 green (2647 tests) but Gate-2 BLOCKED it
for ONE additive gap, and the kept work branch (`work/task-agentic-apply-retire-disposition-vocabulary`)
holds all the good work. CONTINUE from that branch; do NOT restart. The block:

> The agentic apply engine + the `applyDecide`/`applyModel` plumbing through
> `AdvanceContext` are DONE on the kept branch. But `cli.ts` NEVER wires a real
> harness-backed apply decider at the three advance entry points, so production
> falls back to `harnessApplyDecider()` with a `NullHarness` + empty agentCmd,
> which THROWS — the apply rung errors and an answered observation can never
> mint/delete/ask. US #2 is unreachable in production. Unit tests pass only
> because they inject a stubbed `ApplyDecider`, masking the missing wiring.

FIX (additive only — keep everything else from the kept branch):
- At the SAME three `cli.ts` sites where `surfaceGate`/`triageGate` are wired
  (treeless advance entry ~L416-425, isolated ~L2644-2656, in-place ~L2769-2779),
  ALSO set `applyDecide: harnessApplyDecider({harness, agentCmd: config.agentCmd})`
  and `applyModel: config.model`.
- Add a test/guard asserting the production `AdvanceContext` has a non-null apply
  decider (mirror how the surface/triage gate wiring is verified), so this can't
  regress.

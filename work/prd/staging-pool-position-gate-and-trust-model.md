---
title: Staging/pool position gate + runner-deterministic placement (three-axis autonomy; de-overload humanOnly; review without a PR)
slug: staging-pool-position-gate-and-trust-model
humanOnly: true
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. Originating design trail: `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` (the Kanban split, the position-vs-nature resolution, the determinism/trust principle, the migration + policy surface). Governing decision: `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md`. SIBLING PRD: `work/prd/ledger-status-per-item-lock-refs.md` (the lock substrate, orthogonal; this PRD's pool is that PRD's eligibility target).

## Problem Statement

Two related gaps in the autonomy/trust model:

1. **`humanOnly` is OVERLOADED.** It is one flag carrying two different meanings: "a human should REVIEW this before an agent acts" (a POSITION / gating concern) AND "an agent must NEVER build/slice this by nature" (a NATURE concern). One flag for two jobs makes the model muddy and forces every gating need through a single boolean.
2. **There is no human-controlled, deterministic gate on what enters the AGENT POOL.** `backlog/` today means BOTH "exists" AND "eligible to be claimed/sliced," so the moment an agent (slicing) or an untrusted source (intake) writes an item, it is immediately actionable. There is no staging step a human (or a runner trust-policy) controls, and review-before-acting REQUIRES a PR system (which a bare/no-host/protected-`main` repo may not have). The existing `untrusted-origin-forces-build-propose` rule partially covers untrusted CODE output, but there is no equivalent positional gate for LEDGER-FILE output (emitted slices, intake-authored PRDs).

The cost: `humanOnly` is a catch-all that conflates judgement and trust; there is no PR-free review path; and untrusted/agent output can enter the agent pool without a runner-enforced checkpoint.

## Solution

Introduce a STAGING vs POOL position split, and make placement a RUNNER-deterministic decision, yielding a clean THREE-AXIS autonomy model (governing ADR `placement-is-runner-deterministic-humanonly-is-agent-judgement`):

- **POSITION (a folder, RUNNER-deterministic, STRUCTURAL):** staging vs pool. Slices: `backlog/` (staging, not agent-eligible) vs `todo/` (the agent pool). PRDs: `prd/` (staging) vs `prd-ready/` (the auto-slice pool). WHICH folder an item's output lands in is COMPUTED by the RUNNER from unforgeable inputs (the `originTrust` stamp, the per-repo placement policy, explicit operator flags) via a fixed precedence chain. The agent CREATES only in the staging folder; the runner OWNS every move + promotion into the pool.
- **NATURE (`humanOnly`, AGENT/human judgement, ADVISORY):** "an agent must NEVER auto-take this by nature." De-overloaded: the folder takes the review/position job; `humanOnly` keeps ONLY the never-by-nature job. Slice `humanOnly` NARROWED to the rare hard case (secrets/release/security, survives even in `todo/`); PRD `humanOnly` UNCHANGED (gates auto-slicing; no folder substitute).
- **DISCOVERED (`needsAnswers`, AGENT judgement, ADVISORY):** unchanged.

The two gates sit on OPPOSITE sides of the determinism/trust line, `humanOnly` is a non-deterministic agent JUDGEMENT (about the nature of the work), placement is a deterministic runner COMPUTATION (from trust + policy), so neither can replace the other, and the placement gate is STRUCTURAL (tamper-proof: the agent cannot self-promote) precisely because the runner owns it.

From the user's perspective: a human curates the agent pool by promoting `backlog → todo` (and `prd → prd-ready`); untrusted/agent output lands STAGED, not actionable, until promoted; `--merge` slicing becomes safe with no PR system (slices land in `backlog/`, a human promotes the approved ones, review = a ledger position); and `humanOnly` becomes rare and meaningful instead of a catch-all.

## User Stories

1. As a human, I want a STAGING area (`backlog/`) separate from the agent POOL (`todo/`), so I control what enters the pool by promoting `backlog → todo`, even when working-tree visibility of in-flight status is dropped (this is human CONTROL, not visibility).
2. As a human, I want the same for PRDs (`prd/` staging vs `prd-ready/` auto-slice pool), so an `intake`-authored or untrusted-origin PRD is not auto-sliceable until I promote it.
3. As the runner, I want WHICH folder an item's output lands in to be MY deterministic decision, computed from the `originTrust` stamp + the per-repo placement policy + explicit operator flags, so an agent can never place its own output in the pool to make itself eligible.
4. As the runner, I want the agent to CREATE ledger files ONLY in the staging folder (`backlog/` for slices, `prd/` for PRDs), a write outside it is skipped (the slicer already does no git and is path-validated), and I OWN every move + promotion, so the "agent does not move files" rule is extended to cover CREATION.
5. As a maintainer, I want a configurable DEFAULT landing per lifecycle (e.g. `slicesLandIn: todo|backlog`, `prdsLandIn: prd-ready|prd`), resolved like `autoBuild`/`integration` (CLI flag > env > per-repo > global > built-in), so a repo can choose "slices always end in `todo`" or "always staged for review."
6. As a maintainer, I want PER-SOURCE EXCEPTIONS that override the default via a fixed precedence (explicit operator flag > untrusted-origin forces STAGING > configured default > built-in), mirroring the existing `untrusted-origin-forces-build-propose` precedence, so untrusted intake output is forced to staging even in a "land in pool" repo.
7. As a maintainer on a bare/no-host/protected-`main` repo, I want REVIEW WITHOUT A PR SYSTEM for ledger-file output: `--merge` slicing lands the slices in `backlog/` (durable, readable, NOT eligible) and I promote the approved ones `backlog → todo`, review becomes a ledger POSITION a human moves, not an out-of-band PR.
8. As a maintainer, I want the three honest modes to be explicit: `--propose` = the PR path (where a host exists); `--merge` + land-in-`backlog/` = the PR-free review path; `--merge` + land-in-`todo/` = the trusted no-review fast path.
9. As a maintainer, I want CODE/implementation review to STILL use a branch/PR (a diff cannot be folder-gated), so the position gate is scoped to LEDGER-FILE output (slicing) and the existing branch-based build review is unchanged, the right tool per artifact.
10. As a maintainer, I want `humanOnly` DE-OVERLOADED: slice `humanOnly` narrowed to the rare "never-for-agents by nature" guard (survives even in `todo/`); PRD `humanOnly` unchanged (gates auto-slicing); `needsAnswers` unchanged, three orthogonal axes, each meaning one thing.
11. As a maintainer, I want the slicer heuristic to shift from "stamp `humanOnly` for review" (overloaded) to "birth in `backlog/` for review; flag `humanOnly` ONLY for genuinely never-agent-buildable."
12. As the runner, I want untrusted-origin OUTPUT (slices AND intake PRDs) to land STAGED by the trust-precedence rule, so the existing untrusted-origin trust signal gates pool entry, not just build mode.
13. As a maintainer migrating an existing repo, I want a LOW-RISK sequence: STEP A introduces a `pre-backlog/` staging folder while `backlog/` KEEPS meaning "the pool" (every reader unchanged; only new behaviour is "staged output → `pre-backlog/`" + the promote transition); STEP B later renames `backlog → todo` and `pre-backlog → backlog` as a pure constants flip behind the path module + `git mv` (no behaviour change). So the risky part lands while the pool keeps its name; the rename is separate and reversible.
14. As a maintainer, I want `blockedBy`/`sliceAfter` to keep resolving against `done/`/`prd-sliced/` (unchanged), the staging/pool split changes only WHICH folder is the eligible pool, not dependency resolution.
15. As a maintainer, I want every NEW transition (staging-vs-pool placement, the `backlog → todo` / `prd → prd-ready` promotion) to be RUNNER/human-owned, never agent, a test proves an agent's emitted output lands where the runner's policy/trust dictates (not where the agent wrote it), and that an agent cannot perform the promotion.

## Implementation Decisions

- **Position folders:** slices `backlog/`(staging) → `todo/`(pool); PRDs `prd/`(staging) → `prd-ready/`(pool) → `slicing`(lock, on the lock ref per the sibling PRD) → `prd-sliced/`(done analogue). The build pool reads `todo/`; the auto-slice pool reads `prd-ready/`. (Names are placeholders for the slicing session; the SHAPE is fixed.)
- **Placement policy = default + exceptions, RUNNER-resolved, mirroring `originTrust` precedence** (VERIFIED `integration-core.ts` stamps `originTrust: untrusted` at intake + resolves `explicit --merge > untrusted-origin ⇒ propose > config > default`): a `slicesLandIn`/`prdsLandIn` default per lifecycle + a precedence chain `explicit operator flag > untrusted-origin forces staging > configured default > built-in`. The agent never sets placement.
- **Creation enforcement:** the slicer/intake agent writes ONLY into the staging folder (already path-validated, a write outside `work/backlog/` is skipped); the runner's stage+commit (`stageSlicingLifecycle` / `performIntegration`) is the transition and decides staging-vs-pool. Restate the `AGENTS.md`/WORK-CONTRACT "agent does not move files" rule to cover CREATION: "the agent may CREATE ledger files ONLY in the staging folder; the runner owns every MOVE and every PROMOTION into a pool."
- **`humanOnly` de-overloading:** slice `humanOnly` becomes the rare never-for-agents guard (the predicate still excludes a `humanOnly` slice even when it is in `todo/`); the COMMON review-first case moves to `backlog/` birth. PRD `humanOnly` UNCHANGED. Decide the migration of existing slice-`humanOnly` uses (re-home review-first ones to `backlog/` birth; leave genuinely-never ones flagged) at slice time.
- **Low-risk migration (STEP A then B)** as in US #13, the taxonomy PRD's Phase-0/Phase-1 + the `prd-sliced` STEP-A/B precedent: introduce `pre-backlog/`, keep `backlog/` as the pool, rename later behind the `work-layout` path module.
- **Promotion verb:** `backlog → todo` and `prd → prd-ready` are runner/human-owned ledger moves (a `git mv` on `main`, since these are durable resting/pool records on `main` per the sibling ADR). An agent cannot perform them.

## Testing Decisions

- Placement is runner-deterministic: a test asserts an agent's emitted slices ALL land in `backlog/` regardless of where the agent tried to write; the runner promotes per policy/trust; an untrusted-origin's output stays in `backlog/` (not promoted); the `backlog → todo` promotion is a runner/human-only move an agent cannot perform.
- Policy resolution: the default landing resolves like `integration`/`autoBuild` (flag > env > per-repo > global > built-in); the precedence `explicit > untrusted-forces-staging > default` holds; "slices always end in `todo`" and "always staged" both verified.
- Review-without-PR: `--merge` slicing into `backlog/` lands the slices durable-but-not-eligible on a `--bare file://` arbiter with no host; agents do NOT pull them until promoted; the three modes (`--propose`, `--merge`+staging, `--merge`+pool) behave as specified.
- De-overloaded `humanOnly`: a `humanOnly` slice is NOT agent-eligible even in `todo/`; PRD `humanOnly` still blocks auto-slicing; `needsAnswers` unchanged.
- Migration STEP A: `backlog/` still means the pool (all existing readers unchanged), staged output lands in `pre-backlog/`, the promote works; STEP B rename is a no-op behaviour change behind the path module (gate-verified).
- House pattern (throwaway repos + `--bare file://` arbiter; no network). Acceptance gate: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Out of Scope

- The lock substrate (per-item lock refs, the lock-entry state machine, the C8 unification), owned by the SIBLING PRD `ledger-status-per-item-lock-refs.md`. This PRD composes with it (its pool IS that PRD's eligibility target) but does not change the lock mechanism.
- Code/implementation review via folder-gating, explicitly OUT: a diff cannot be parked in a `work/` subfolder; implementation review stays branch/PR-based (the existing path, unaffected).
- Fully retiring `humanOnly`, rejected (the never-by-nature case needs a durable flag that survives even in the pool).
- Changing `blockedBy`/`sliceAfter` resolution (still against `done/`/`prd-sliced/`).
- The final folder/config NAMES (`todo`/`ready`/`queued`; `slicesLandIn` spelling), a slicing-level decision; the SHAPE is fixed here.

## Further Notes

- This can land under EITHER ledger substrate (it is orthogonal to the lock mechanism), so it does not hard-depend on the sibling PRD; sequence by which lands first against the `todo/`-as-pool retarget. The low-risk migration (STEP A) is independently valuable and reversible.
- `humanOnly: true` is set on THIS PRD because the slicing is judgement-heavy: the migration cut-lines (STEP A/B), the `humanOnly` de-overloading migration, the policy key/precedence spelling, and the folder names are decisions a human should drive. (Funnily, this PRD wanting to sit in a holding state pending human admission is exactly the "true backlog" this design proposes, for now `humanOnly` expresses it.) Per the contract this does NOT propagate to the produced slices' gates.
- An ADR records the durable why (`placement-is-runner-deterministic-humanonly-is-agent-judgement`); slices reference it rather than re-argue it.

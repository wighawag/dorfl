---
title: 'Author-trust drives PLACEMENT + the build STAMP only, never the file-emit MODE — untrusted carries via the stamp, it is not force-staged'
status: proposed
created: 2026-07-22
supersedes:
superseded_by:
---

# ADR: untrusted-origin safety is the carried STAMP (a build-time PR), not a forced document PR nor a forced staging folder

> **STATUS: proposed.** Amends two accepted decisions — `placement-is-runner-deterministic-humanonly-is-agent-judgement` (the "untrusted-origin forces staging" rung) and `untrusted-origin-build-checkpoint` (the becomes-code checkpoint) — by MOVING where author-trust bites. Full design + user stories + config in `work/specs/proposed/untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution.md`.

## Context

Two defects surfaced from a real repo (`rocketh`, running `integration: merge` with `autoBuild: true`/`autoTask: true` in `dorfl.json`) whose owner filed an issue from an untrusted author and got a **task document PR** they did not want:

1. **The intake TASK/SPEC symmetry gap.** The intake **spec** emit already routes through the shared placement resolver (`resolvePlacement`) and lands the spec document on `main` (staging or pool) carrying the `originTrust` stamp. The intake **task** emit does NOT: it hardcodes `tasks-ready` as the path and instead lets author-trust force the file-emit MODE to `--propose-task`, i.e. a PR for the task **document**. So untrusted specs merge-to-main-staged while untrusted tasks open a document PR — an inconsistent, surprising asymmetry.

2. **The CI gate-resolution gap.** The generated `intake.yml` hardcodes `DORFL_AUTO_BUILD: 'false'` / `DORFL_AUTO_TASK: 'false'` in its `env:` block. Because `env` outranks per-repo config in the resolution chain (flag > env > per-repo > global > default), this SHADOWS the repo's committed `dorfl.json` gates — the exact opposite of the documented "the same dorfl.json the laptop uses applies here." The `advance` workflow already solved this (it emits NO gate env and reads resolved config via `dorfl config --json`, with a validator forbidding the env lines); intake was never brought into line.

Underlying both is a conflation: author-trust was allowed to force a PR for the **document** (a ledger file landing), when the risk that trust exists to gate is the **becomes-code** step (an untrusted author's content reaching `main` as merged CODE). A document landing on `main` is inert; only its BUILD is dangerous.

## Decision

**Author-trust affects exactly two things, and never the file-emit mode:**

1. **PLACEMENT** — which folder the emitted ledger file lands in, via trust-selected placement knobs (below).
2. **The build STAMP** — `originTrust: untrusted` carried on the frontmatter, which forces the **implementation/build** transition to `propose` (a code PR). This rule is already live (`untrusted-origin-build-checkpoint`) and is the SOLE reserved human checkpoint for untrusted work.

**The file-emit MODE (merge vs propose for the DOCUMENT) becomes trust-independent.** It is resolved purely from the operator/config per-transition knobs (`integration` for build, `taskingIntegration` for tasking, and the intake emit mode), never from `author_association`. A document therefore MERGES to `main` regardless of author-trust; whether that document is later reviewed-as-a-PR is a host/review-culture config choice, not a trust consequence.

**The untrusted-forces-staging RUNG is removed from `resolvePlacement`.** The resolver reduces to `explicit > configuredDefault > built-in (staging)` — a pure precedence with NO trust rung. The CALLER selects which configured default applies by reading the stamp BEFORE calling:

```
const landing = originTrust === 'untrusted' ? untrustedLandIn : trustedLandIn;
resolvePlacement({ explicit, configuredDefault: sideOf(landing) });
```

Two new per-lifecycle placement knobs carry the untrusted destination, resolved like every gate-family key (flag > env > per-repo > global > default):

- **`untrustedTasksLandIn: backlog | ready`** — governs EVERY untrusted-stamped task, whether emitted directly by intake from an issue OR by the tasker from an untrusted-origin spec (one policy, both call sites; no third knob).
- **`untrustedSpecsLandIn: proposed | ready`** — governs untrusted intake specs.

Both DEFAULT to **staging** (`backlog`/`proposed`) — the conservative, human-admission landing, preserving today's effective behavior for a repo that configures nothing. A repo that trusts its stamp-based pipeline opts an untrusted item into the pool (`ready`) explicitly; safety is then the carried stamp (the build PR), not the folder.

**Placement is the manual-gate control.** Setting an untrusted (or trusted) destination to staging is exactly how an operator asks for a human to manually promote the DOCUMENT before it becomes claimable — orthogonal to, and independent of, the PR question.

**The intake TASK emit is brought to parity with the intake SPEC emit:** it routes through `resolvePlacement` (with the task lifecycle slots + the `untrustedTasksLandIn`/`tasksLandIn` inputs) and stamps `originTrust`. Author-trust no longer derives a task file-emit mode.

**The intake CI workflow stops hardcoding the gate env** and reads resolved gates via `dorfl config --json` (mirroring `advance`), with an anti-regression structural validator forbidding a `DORFL_AUTO_BUILD:` / `DORFL_AUTO_TASK:` env assignment. Because author-trust no longer derives a file-emit mode, the workflow's runtime derivation shrinks to (placement default × the operator/config emit mode) + the `--origin-trust` stamp.

## Why

1. **The stamp is the load-bearing boundary; position was redundant.** The build-propose rule (verified live in `integration-core.ts`) forces any `originTrust: untrusted` task's BUILD to a PR that a human must approve. An untrusted document in the POOL therefore still cannot become merged code without human review. Position (forced staging) was a coarser second guard; removing it does not remove the safety, it relocates the decision to an explicit operator knob whose default keeps the guard on.

2. **It kills the surprising document PR.** "Reserve the PR for the implementation" is the operator's natural mental model. Untrusted no longer opens a PR for a task/spec DOCUMENT; the only PR it forces is the code PR at build time. This directly fixes the reported confusion.

3. **It makes the three operator intents expressible as pure config, no new mode enum.** "Only implementation is a PR" = `integration: propose` + `taskingIntegration: merge` + intake emit merge (already the documented maintainer target). "Everything is a PR" = propose everywhere. "Nothing except untrusted" = merge everywhere; untrusted forces placement + a build PR via the stamp. Each is a point in the EXISTING per-transition mode axes plus the untrusted placement knobs.

4. **Symmetry and one resolver.** Task and spec intake emits now share the same placement path; the resolver stays a single pure function; a precedence change touches one place. The CI gate-resolution fix aligns intake with the already-correct `advance` pattern, so the "same dorfl.json applies in CI" claim becomes true by construction.

## Considered and rejected

- **A new `proposePolicy` enum (`implementation` / `all` / `none`).** Rejected: the three intents are already configurations of the existing per-transition mode knobs (`integration`, `taskingIntegration`, intake emit) plus placement. A new enum would duplicate and eventually contradict the existing axes.
- **Keep author-trust able to force a DOCUMENT PR (retain the file-emit-mode coupling).** Rejected: it is the source of the reported confusion and duplicates the safety the build stamp already provides. The document is inert on `main`; gating it as a PR buys nothing over placement + the stamp.
- **Keep the untrusted-forces-staging rung INSIDE `resolvePlacement` behind a boolean.** Rejected: it puts policy back inside the pure precedence function and blocks the "untrusted lands in `ready`, carries the stamp" (B) intent. Selecting the trusted-vs-untrusted configured default in the caller keeps the resolver pure and makes B expressible.
- **A third knob `untrustedSpecTasksLandIn` for a spec's downstream tasks.** Rejected (decision X): an untrusted-stamped task is the same risk regardless of birth path; `untrustedTasksLandIn` governs it at both the intake and tasker call sites. Avoids an 8-way config matrix for a distinction with no semantic weight.
- **Default the untrusted knobs to mirror the trusted `*LandIn`.** Rejected: `ready` is SAFE (via the stamp) but not what a cautious operator wants BY DEFAULT from a public front door. Default staging preserves the human-admission gate; `ready` is an explicit opt-in.

## Consequences

- `resolvePlacement` no longer reads `originTrust`; the caller resolves the trusted-vs-untrusted configured default and passes it in. The `PlacementResult.reason` `'untrusted-origin'` value is retired (or re-expressed as `'configured-default'`), a breaking change to that internal contract only.
- The intake author-trust → per-outcome derivation (`deriveIntakeFlags`) is rewritten: author-trust feeds PLACEMENT + the `originTrust` stamp, not the task/spec file-emit MODE. The file-emit mode becomes gate/config-derived (like the spec mode is today).
- For a repo that configures nothing new, the ONLY behavior change is that the intake TASK path stops opening a document PR and instead MERGES the task file into `backlog` (matching what the spec path already does) — strictly more consistent, not riskier.
- `intake.yml` no longer carries `DORFL_AUTO_BUILD` / `DORFL_AUTO_TASK` env; it reads resolved config. A validator forbids the env lines regressing, mirroring `advance-lifecycle-template.ts`'s `no-gate-env-auto-build` / `no-gate-env-auto-task`.
- Amends `placement-is-runner-deterministic-humanonly-is-agent-judgement` (the "untrusted-origin forces staging" Consequence) and refines `untrusted-origin-build-checkpoint` (the build PR is now the SOLE trust-forced checkpoint; the document always merges). Neither is fully superseded; both keep their other rulings.

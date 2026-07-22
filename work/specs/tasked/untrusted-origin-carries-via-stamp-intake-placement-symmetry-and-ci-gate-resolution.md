---
title: Untrusted-origin carries via the STAMP — intake task/spec placement symmetry, trust-selected placement knobs, and CI gate-resolution alignment
slug: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

An operator running `dorfl` in `integration: merge` mode with `autoBuild`/`autoTask` on in `dorfl.json` filed an issue from an untrusted author and received a **task DOCUMENT PR** they did not want. They expected untrusted content to still land as a ledger file on `main` (so tasks/specs are created without an out-of-band PR), with the human checkpoint reserved for the IMPLEMENTATION (the becomes-code step). Instead, author-trust forced the task's file-emit mode to `--propose-task`.

Two defects underlie this:

1. **Intake task/spec asymmetry.** The intake **spec** emit routes through the shared placement resolver and merges the spec document to `main` (staging or pool) carrying the `originTrust` stamp. The intake **task** emit hardcodes its path (`tasks-ready`) and instead lets author-trust force the file-emit MODE to a document PR. Untrusted specs merge-staged; untrusted tasks open a PR. Inconsistent and surprising.

2. **CI gate-resolution shadowing.** The generated `intake.yml` hardcodes `DORFL_AUTO_BUILD: 'false'` / `DORFL_AUTO_TASK: 'false'` in its `env:` block. Since `env` outranks per-repo config (flag > env > per-repo > global > default), this SHADOWS the committed `dorfl.json` gates, contradicting the documented "the same dorfl.json applies in CI." The `advance` workflow already avoids this (emits no gate env, reads `dorfl config --json`, validator-forbidden regression); intake was never aligned.

The root conflation: author-trust was allowed to force a PR for the **document** when the risk trust exists to gate is the **becomes-code** step. A document on `main` is inert; only its BUILD is dangerous.

## Solution

Author-trust drives exactly two things and never the file-emit mode:

1. **Placement** (which folder the document lands in), via trust-selected placement knobs.
2. **The build stamp** (`originTrust: untrusted`), which forces the IMPLEMENTATION transition to a code PR (already live). This is the sole reserved untrusted checkpoint.

The file-emit MODE (merge vs propose for the DOCUMENT) becomes trust-independent, resolved purely from the operator/config per-transition knobs (`integration`, `taskingIntegration`, the intake emit mode). Documents merge to `main` regardless of author-trust; PR-reviewing a document is a host/review-culture choice, not a trust consequence.

The untrusted-forces-staging rung is removed from `resolvePlacement` (it reduces to `explicit > configuredDefault > built-in (staging)`); the CALLER selects the trusted-vs-untrusted configured default by reading the stamp first. Two new knobs (`untrustedTasksLandIn`, `untrustedSpecsLandIn`) carry the untrusted destination, defaulting to staging (conservative), opt-in to `ready` (safety then via the stamp).

Placement is the manual-gate control: staging = "a human must promote the document first"; `ready` = "immediately claimable, safety by stamp". The intake TASK emit reaches parity with the intake SPEC emit (routes through the resolver, stamps origin-trust). The intake CI workflow stops hardcoding gate env and reads resolved config, aligned with `advance`.

The three operator intents become pure config, no new mode enum:
- **Only implementation is a PR:** `integration: propose` + `taskingIntegration: merge` + intake emit merge.
- **Everything is a PR:** propose on every transition.
- **Nothing except untrusted:** merge everywhere; untrusted forces placement + a build PR via the stamp.

## User Stories

1. As a maintainer of a `merge`-mode repo, I want an untrusted-author issue to create a task DOCUMENT that merges to `main` (not a document PR), so that my ledger is populated without out-of-band PRs and the only PR I review is the implementation.
2. As a maintainer, I want the intake TASK emit to route through the same placement resolver the intake SPEC emit uses, so that untrusted tasks and specs behave symmetrically (both merge-to-`main`, both carry the `originTrust` stamp, both honor a placement knob).
3. As a maintainer, I want author-trust to STOP deriving the task/spec file-emit MODE, so that whether a document is a PR is my per-transition `integration`/`taskingIntegration`/intake-emit config, never a function of who filed the issue.
4. As a maintainer, I want `resolvePlacement` to drop its internal untrusted-forces-staging rung and instead consume a configured default the caller selected by reading the `originTrust` stamp, so that "untrusted lands in `ready` while carrying the stamp" (B) becomes expressible and the resolver stays a pure precedence function.
5. As a maintainer, I want a per-repo `untrustedTasksLandIn: backlog | ready` knob (resolved flag > env `DORFL_UNTRUSTED_TASKS_LAND_IN` > per-repo > global > default `backlog`), so that I choose whether untrusted tasks land in staging (manual promotion) or the pool (claimable, safety by stamp).
6. As a maintainer, I want that SAME `untrustedTasksLandIn` knob to govern tasks the TASKER emits from an untrusted-origin spec (not just tasks intake emits directly from an issue), so that an untrusted task's destination is one policy regardless of birth path (decision X — no separate `untrustedSpecTasksLandIn`).
7. As a maintainer, I want a per-repo `untrustedSpecsLandIn: proposed | ready` knob (resolved like `untrustedTasksLandIn`, default `proposed`), so that I choose whether untrusted intake specs land in staging or the auto-tasking pool.
8. As a maintainer, I want both untrusted knobs to DEFAULT to staging, so that a repo configuring nothing new keeps the conservative human-admission gate on the public front door, and the only behavior change is that the intake TASK path now merges the task file to `backlog` instead of opening a document PR.
9. As a maintainer, I want an untrusted item that lands in `ready` to STILL force its build to a PR via the carried `originTrust: untrusted` stamp, so that "safe in the pool" is real: untrusted content can never become merged CODE without human review.
10. As a maintainer of a repo whose spec is untrusted-origin and lands in `ready` (B), I want the tasker to PROPAGATE `originTrust: untrusted` onto every emitted task AND place those tasks per `untrustedTasksLandIn`, so that the stamp and the placement policy both flow one level down unbroken.
11. As a maintainer, I want the generated `intake.yml` to emit NO `DORFL_AUTO_BUILD` / `DORFL_AUTO_TASK` env assignment and instead read resolved gates via `dorfl config --json`, so that my committed `dorfl.json` gates actually apply in CI (the shadowing bug is fixed at the root).
12. As a maintainer, I want a structural validator forbidding a `DORFL_AUTO_BUILD:` / `DORFL_AUTO_TASK:` env assignment in the intake workflow (mirroring `advance-lifecycle-template.ts`'s `no-gate-env-auto-build` / `no-gate-env-auto-task`), so that the shadowing bug cannot regress.
13. As a maintainer, I want the intake CI runtime derivation rewritten so author-trust feeds PLACEMENT (`--*-land-in` selection) + the `--origin-trust` stamp, NOT a `--merge/--propose` file-emit mode for the task/spec, so that the workflow encodes the new rule and the `deriveIntakeFlags` unit test asserts the shell matches the function.
14. As a maintainer, I want the intake spec emit to keep working exactly as today for the trusted/normal path (zero behavior change when nothing new is configured and the author is trusted), so that this is a safe, additive change for existing repos.
15. As a contributor reading the docs, I want the amended invariant recorded in an ADR (author-trust → placement + stamp, never file-emit mode) and the two prior ADRs cross-referenced, so that a future reader does not "restore" the untrusted-document-PR behavior.

> Tasked — the implementation and testing detail moved into the five tasks (`config-untrusted-landin-keys`, `placement-drop-untrusted-rung`, `intake-task-placement-symmetry`, `derive-intake-flags-trust-drives-placement-not-mode`, `intake-ci-gate-resolution`) and the durable rationale lives in `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.

## Out of Scope

- Any new `proposePolicy` mode enum (rejected in the ADR — the intents are existing per-transition config).
- A separate `untrustedSpecTasksLandIn` knob (rejected — decision X, `untrustedTasksLandIn` governs both call sites).
- Changing the `advance` workflow (it is already correct; this spec brings intake INTO LINE with it).
- The build-time `untrusted-origin-forces-build-propose` rule itself (unchanged and relied upon; only its status as the SOLE trust-forced checkpoint is clarified).
- Retro-migrating existing repos' `intake.yml` (they re-run `install-ci` to upgrade the shell, per the one-time-install ADR); no automatic rewrite.

## Further Notes

- Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`. Amends `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md` (the untrusted-forces-staging Consequence) and refines `docs/adr/untrusted-origin-build-checkpoint.md` (the build PR is now the sole trust-forced checkpoint).
- Prior art to mirror for the CI fix: `advance-lifecycle-template.ts` (no gate env + `dorfl config --json` + `no-gate-env-auto-build`/`no-gate-env-auto-task` validators).
- Discovered from a real `rocketh` intake run (PR opened for an untrusted-author task under `integration: merge`).

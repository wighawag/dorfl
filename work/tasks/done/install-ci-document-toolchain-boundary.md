---
title: 'install-ci documents the project-toolchain boundary (no knob, no detection)'
slug: install-ci-document-toolchain-boundary
spec: install-ci-project-provisioning
blockedBy: []
covers: [5, 6]
---

## What to build

State the project-toolchain boundary explicitly in `install-ci`'s generated output, WITHOUT adding any knob or detection logic. End to end:

- dorfl's own `setup-node` step in the generated composite action keeps emitting (dorfl declares `node >=18`, so it runs on any modern Node and needs NO pinned version). NO `nodeVersion` knob is added — it was considered and dropped as over-engineering (SPEC Out of Scope).
- The generated README / `install-ci` completion message carries a clear boundary line: a custom or conflicting project toolchain (a different Node/pnpm version, rust, etc.) is supported ONLY via the project-setup hook (task `install-ci-project-setup-hook`); without that hook the conflicting case is unsupported. This is documentation, a deliberate honest line — NOT silently enforced.
- install-ci does NOT sniff `.nvmrc` / `packageManager` / `rust-toolchain.toml` to detect a likely conflict and warn. NO detection path is built (SPEC Out of Scope).

A tiny, self-contained docs/output task: it touches the README/completion-message emitter and a snapshot/output assertion, NOT the project-setup config field, so it is file-orthogonal to the hook task and can land independently.

## Acceptance criteria

- [ ] The generated composite action still emits a `setup-node` step for dorfl's own runtime (a Node is always present for `node >=18`).
- [ ] No `nodeVersion` (or equivalent dorfl-Node-version) config field is added.
- [ ] The generated README / completion output states the boundary: conflicting/custom project toolchains are supported only via the project-setup hook; otherwise unsupported.
- [ ] No conflict-detection / file-sniffing path is added.
- [ ] Tests cover the boundary text + the still-emitted `setup-node` step (snapshot/output assertion, no live Actions run); no knob exists to test and no detection path exists to test.
- [ ] **Shared-write isolation:** any test that generates into a real-ish location writes only to a scratch/temp dir and asserts the real one is untouched (the existing install-ci discipline). Omit only if the test writes nothing outside its own temp fixtures.

## Blocked by

- None — can start immediately. (Independent of the project-setup hook task: the boundary text stands alone and touches a different surface — the README/output emitter, not the config field.)

## Prompt

> Make `install-ci` STATE the project-toolchain boundary in its generated output, and confirm dorfl's own Node step still emits — WITHOUT adding any knob or any detection. This is the (A) axis of the `install-ci-project-provisioning` SPEC: dorfl needs only `node >=18`, so there is no dorfl-Node-version knob to add; the project's toolchain is the project's concern (the project-setup hook, a sibling task). The only deliverable here is an honest documented boundary.
>
> FIRST, drift-check (launch snapshot): re-read `work/specs/tasked/install-ci-project-provisioning.md` (the (A) decisions + Out of Scope). Confirm the install-ci core still emits a `setup-node` step in the composite action and still produces a README / completion message you can extend. If a sibling task already added the project-setup hook with different vocabulary, align the boundary text to the real hook name; if the composite-action generator changed shape, do not build on the stale premise — route to needs-attention.
>
> DOMAIN VOCABULARY: the COMPOSITE setup action (`dorfl-setup`) provisions dorfl + the harness; `install-ci` is a one-time human-run scaffolder that prints a completion message and (per the existing seed) ships a README documenting the generated CI. dorfl's `engines.node` is `>=18`. The project-setup hook (sibling task `install-ci-project-setup-hook`) is the supported way to provision a custom/conflicting project toolchain.
>
> WHERE TO LOOK (by concept): the install-ci core's composite-setup-action generator (the `setup-node` step) and the README / completion-message emitter the scaffolder prints/writes. The existing snapshot tests for the composite action + the generated README for the assertion style.
>
> SCOPE FENCE (do NOT cross): no `nodeVersion`/dorfl-Node knob; no `.nvmrc`/`packageManager`/`rust-toolchain.toml` detection or warning; no change to the project-setup hook itself (that is the sibling task). This task is documentation + a snapshot, nothing more.
>
> RECORD non-obvious in-scope decisions (a `## Decisions` line; an ADR only if it meets the gate).
>
> DONE means: the `setup-node` step still emits; the generated output states the conflicting-toolchain boundary (hook-only support); no knob and no detection exist; tested. Finish with `pnpm format`, then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim install-ci-document-toolchain-boundary --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-document-toolchain-boundary <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/install-ci-document-toolchain-boundary.md work/tasks/done/install-ci-document-toolchain-boundary.md
```

## Requeue 2026-06-26

active claim never surfaced (killed/interrupted run at 20:04Z); no work branch produced; reset+requeued by recovery

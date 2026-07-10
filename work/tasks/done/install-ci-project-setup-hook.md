---
title: install-ci project-setup hook (provider-namespaced, opaque, native-syntax pass-through)
slug: install-ci-project-setup-hook
spec: install-ci-project-provisioning
blockedBy: []
covers: [1, 2, 3, 4, 9, 10, 11, 12]
---

## What to build

A project-setup escape hatch in `install-ci` so the generated CI can provision the USER's own project toolchain (corepack/pnpm@pinned, `rustup`, a project Node, `pnpm install`, system packages) before the agent runs the project's build. End to end:

- A new OPTIONAL, PROVIDER-NAMESPACED, OPAQUE config field carrying the user's project-setup snippet keyed by provider (recommended shape: a `projectSetup: { <provider>: <payload> }` map — confirm/choose the exact key shape in a `## Decisions` block; a single-blob-the-active-adapter-interprets is the alternative). It lives on the serializable CI config (the `--config` input / `--export-config` output) AND the resolved config the generators consume.
- The GitHub provider adapter splices its snippet — NATIVE GitHub Actions step YAML, verbatim — into the generated COMPOSITE setup action (`dorfl-setup`), as the FIRST steps, BEFORE the dorfl-install and AI-auth steps. The core never parses or normalizes the snippet (opaque pass-through); only the active provider's adapter knows where/how to inject it.
- A LIGHT structural sanity check only (for GitHub: the snippet is a list of mapping-shaped steps). NO semantic validation / parsing — that would re-introduce the mini-format this hook exists to avoid.
- Round-trips through `--config` / `--export-config` byte-for-byte like every existing knob.
- Deterministic: the same config produces byte-identical output, snapshot-tested under `--fake`.

This is the keystone of the `install-ci-project-provisioning` PRD. It reuses the existing "interpolate an opaque YAML fragment into the composite action" pattern the auth-step / install-step / provider-`with:` block already use. NO presets ship here (raw escape hatch only — presets are explicitly deferred by the PRD). NO dorfl-Node-version knob and NO conflict detection (those are out of scope / other tasks).

## Acceptance criteria

- [ ] A new optional provider-namespaced project-setup field exists on the serializable CI config and the resolved config; absent/empty ⇒ the generated composite action is byte-identical to today.
- [ ] In GitHub mode, a supplied native step-YAML snippet appears VERBATIM and FIRST in the generated composite action (before dorfl-install and AI-auth).
- [ ] The core does not transform the snippet (bytes-in == bytes-out, modulo indentation) — proving opaque pass-through with no hidden mini-format.
- [ ] Only a light structural sanity check is performed (GitHub: list-of-mapping-shaped-steps); no semantic parse.
- [ ] The field round-trips through `--export-config` → `--config` byte-for-byte.
- [ ] Tests cover the new behaviour under `--fake` (presence/shape assertions over generated YAML, no live Actions run), mirroring the existing `install-ci` / composite-action snapshot style.
- [ ] **Shared-write isolation:** the `--fake` tests write only into a scratch/temp dir and assert the real `~`, real secrets store, and system git config are UNTOUCHED after the run (the existing install-ci isolation discipline).

## Blocked by

- None — can start immediately.

## Prompt

> Build the project-setup escape hatch for `install-ci`: a provider-namespaced, opaque, native-syntax pass-through that splices the user's own project-toolchain steps into the generated composite setup action, so the generated CI can build an ARBITRARY project (rust, pnpm@pinned, a custom Node, system packages), not just dorfl itself.
>
> FIRST, drift-check (this is a launch snapshot): re-read `work/specs/tasked/install-ci-project-provisioning.md` (Solution + Out of Scope) and the ADR `docs/adr/install-ci-project-provisioning-native-passthrough.md` (the durable rationale). Confirm the install-ci core still exposes the composite-setup-action generator and the serializable/resolved CI config types, and that the GitHub provider adapter + the capability-emitter / `--fake` snapshot machinery still exist as the PRD describes. If a sibling task or ADR has changed the config shape or the composite-action generator since this was written, do NOT build on the stale premise — route to needs-attention with the discrepancy.
>
> DOMAIN VOCABULARY: the COMPOSITE setup action (`dorfl-setup`, `uses: ./.github/actions/dorfl-setup`) is the shared per-capability provisioning action; every capability workflow is `checkout → dorfl-setup → dorfl <verb>`. `install-ci` is a human-run, one-time SCAFFOLDER; the running CI job NEVER edits `.github/workflows/**` (US #9) — your hook lands in the composite action via the EMITTER, never by hand-editing a workflow. `--fake` = generate into a scratch dir and snapshot, no network / no real `gh` / no real GitHub. The provider SEAM (`CIProviderContext` and the capability-emitter registry) is the provider-agnostic-core / thin-adapter split you extend: the core stays dumb (opaque pass-through), the GitHub adapter owns the native injection point.
>
> WHERE TO LOOK (by concept, not brittle paths): the install-ci CORE module that generates the composite setup action and holds the `CIConfigFile` / `ResolvedCIConfig` shapes + the `--config` load / `--export-config` round-trip (today the composite action is assembled by interpolating opaque YAML fragments — the auth step, the install step, the provider `with:` block — so add project-setup as ONE MORE such fragment, emitted FIRST). The install-ci WIZARD / options module for the `--config` / `--export-config` path. The GitHub ADAPTER + its existing validator style to mirror. The existing composite-action snapshot tests for the `--fake` discipline + the shared-write-isolation assertions.
>
> KEY DECISIONS (record in a `## Decisions` block in the done record / PR): the exact config-key shape (a `projectSetup: { <provider>: <payload> }` map — recommended — vs. a single blob the active adapter interprets); the precise injection ordering relative to the existing first step (project-setup must come before dorfl-install AND before AI-auth); whether the light structural check lives in the core or the adapter. Do NOT add presets, a dorfl-Node-version knob, or conflict-detection — all explicitly out of scope (PRD Out of Scope).
>
> RECORD non-obvious in-scope decisions you make while building (a `## Decisions` line, or an ADR if it meets the ADR gate — hard to reverse + surprising + a real trade-off).
>
> DONE means: the provider-namespaced opaque project-setup field exists + round-trips; a native GitHub snippet is spliced verbatim and first into the composite action; absent ⇒ byte-identical to today; opacity + structural-check-only are tested; all under `--fake` with the shared-write isolation assertions. Finish with `pnpm format`, then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim install-ci-project-setup-hook --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-project-setup-hook <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/install-ci-project-setup-hook.md work/tasks/done/install-ci-project-setup-hook.md
```

## Requeue 2026-06-26

active claim never surfaced (killed/interrupted run at 20:04Z); no work branch produced; reset+requeued by recovery

---
title: Add untrustedTasksLandIn / untrustedSpecsLandIn config keys (default staging)
slug: config-untrusted-landin-keys
spec: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
blockedBy: []
covers: [5, 7]
---

## What to build

Two new per-repo placement config keys that name where an UNTRUSTED-origin item lands, resolved through the standard gate-family chain (flag > env > per-repo > global > built-in default):

- `untrustedTasksLandIn: 'backlog' | 'ready'` — default `backlog` (staging).
- `untrustedSpecsLandIn` — the spec twin, using the existing `specsLandIn` value vocabulary (staging vs `ready`), default staging.

End-to-end: extend the `Config` type + defaults (`config.ts`), the env-var validation/coercion layer (`env-config.ts`, envs `DORFL_UNTRUSTED_TASKS_LAND_IN` / `DORFL_UNTRUSTED_SPECS_LAND_IN`, fail-loud on bad values like the sibling keys), the per-repo config passthrough (`repo-config.ts`), and surface both in `dorfl config --json` output so CI can read the resolved values. Mirror `tasksLandIn` / `specsLandIn` exactly — these are their untrusted-side twins.

This task ONLY adds the keys + resolution + `config --json` surfacing; no call site consumes them yet (the placement resolver + intake/tasker wiring are later tasks).

## Acceptance criteria

- [ ] `untrustedTasksLandIn` (default `backlog`) and `untrustedSpecsLandIn` (default staging) exist on `Config` with the documented resolution chain.
- [ ] Env vars `DORFL_UNTRUSTED_TASKS_LAND_IN` / `DORFL_UNTRUSTED_SPECS_LAND_IN` are validated/coerced identically to the trusted-side keys and fail loudly on an invalid value.
- [ ] `dorfl config --json` emits both resolved keys.
- [ ] Unset ⇒ both resolve to staging (zero behaviour change for a repo that configures nothing).
- [ ] Tests cover the resolution precedence (env > per-repo > default) and the fail-loud path, mirroring the existing `tasksLandIn`/`specsLandIn` tests.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: add the two untrusted-side placement config keys so later tasks can select an untrusted item's destination independently of the trusted `tasksLandIn`/`specsLandIn`.
>
> Domain: dorfl's gate-family config resolves flag > env (`DORFL_*`) > per-repo `dorfl.json` > global config > built-in default. `tasksLandIn` (values `backlog`|`ready`) and `specsLandIn` (staging vs pool, existing vocabulary) are the trusted-side placement defaults. You are adding `untrustedTasksLandIn` / `untrustedSpecsLandIn` as their exact twins, defaulting to STAGING (the conservative human-admission landing).
>
> Where to look (by concept, not brittle paths): the `Config` interface + `DEFAULT`/merge in `config.ts`; the env validation/coercion table in `env-config.ts` (find where `tasksLandIn` maps to its `DORFL_TASKS_LAND_IN` enum entry and add the two new ones); the per-repo allow-list in `repo-config.ts` (find the `tasksLandIn` entry); and the `dorfl config --json` emission path. Grep for `tasksLandIn` and `specsLandIn` — every place they appear is a place your new keys belong.
>
> Test at the config-resolution seam the existing `tasksLandIn`/`specsLandIn` tests use (precedence + fail-loud-on-bad-value). Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> Done: both keys resolve correctly through the full chain, default to staging, surface in `config --json`, are covered by tests, and the build/format/test gate is green. No call site consumes them yet — that is a later task; do not wire them into the resolver here.

---
title: 'Drop the untrusted-origin rung from resolvePlacement; caller selects trusted-vs-untrusted default'
slug: placement-drop-untrusted-rung
spec: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
blockedBy: [config-untrusted-landin-keys]
covers: [4, 6, 10]
---

## What to build

Reshape the shared placement resolver so author-trust no longer forces staging INSIDE it; the caller selects which configured default applies by reading the `originTrust` stamp first.

- `resolvePlacement` (`src/placement.ts`): remove the `originTrust` input field and the `input.originTrust === 'untrusted' ⇒ staging` rung. New precedence: `explicit > configuredDefault > built-in (staging)`. Retire the `'untrusted-origin'` `reason` value (re-express as `'configured-default'`).
- Every existing caller now resolves `configuredDefault` by reading the stamp: `originTrust === 'untrusted' ? untrusted*LandIn : *LandIn`, mapped to a `PlacementSide` via the existing side helpers. Update the intake SPEC call site (`intake.ts` `dispatchSpec`) and the tasker call site (`tasking.ts` `performTask`) to do this selection, threading the new `untrustedSpecsLandIn` / `untrustedTasksLandIn` config values in.
- For the tasker (`performTask`): the spec's propagated `originTrust: untrusted` stamp selects `untrustedTasksLandIn` for the emitted tasks; a trusted/unset spec selects `tasksLandIn`. This makes one knob govern untrusted tasks whether born from an issue directly or from an untrusted spec.

Net behaviour: an untrusted item lands in staging BY DEFAULT (default of the new keys), but a repo can now configure it into `ready` — a mode the old hard rung could not express. Safety for a `ready`-landed untrusted item is the carried stamp (enforced at build time, unchanged).

## Acceptance criteria

- [ ] `resolvePlacement` no longer reads `originTrust`; its chain is `explicit > configuredDefault > built-in (staging)` and the `'untrusted-origin'` reason is gone.
- [ ] The intake SPEC and tasker call sites select `untrusted*LandIn` vs `*LandIn` by reading the stamp before calling.
- [ ] Tasker-emitted tasks from an untrusted-origin spec are placed per `untrustedTasksLandIn` (default staging; `ready` when configured), and still carry the propagated `originTrust: untrusted` stamp.
- [ ] Default config ⇒ untrusted lands in staging (zero behaviour change vs today's forced-staging for the default).
- [ ] `untrustedTasksLandIn: ready` ⇒ an untrusted-origin spec's tasks land in `ready` carrying the stamp.
- [ ] Tests cover the reshaped resolver (pure precedence, no trust rung) and both updated call sites' stamp-driven default selection.

## Blocked by

- Blocked by `config-untrusted-landin-keys` (the new keys must exist to select between them).

## Prompt

> Goal: move the untrusted-forces-staging decision OUT of the pure `resolvePlacement` function and INTO its callers, so untrusted placement is governed by the new `untrusted*LandIn` knobs (default staging, opt-in `ready`).
>
> Domain: `resolvePlacement` (`src/placement.ts`) is a pure precedence function shared by two lifecycles (task placement + spec placement). Today it has a rung `untrusted-origin ⇒ staging` sitting above the configured default. That rung makes "untrusted lands in ready" impossible. The safety it provided is redundant with the build-time `untrusted-origin-forces-build-propose` rule (verified live in `integration-core.ts` ~L818), which forces an untrusted task's BUILD to a code PR regardless of where the task FILE sits. So removing the rung is safe: an untrusted item in `ready` still cannot become merged CODE without human review.
>
> Where to look: `src/placement.ts` (the resolver + `ResolvePlacementInput` + `PlacementResult.reason`); `intake.ts` `dispatchSpec` (already calls `resolvePlacement` with `originTrust` — change it to caller-side selection); `tasking.ts` `performTask` (the `resolvePlacement({ originTrust, configuredDefault: landingToSide(tasksLandIn) })` call ~L603 — change it to pick `untrustedTasksLandIn` vs `tasksLandIn` by the spec's stamp). Grep `resolvePlacement` for all call sites. The `originTrust` propagation onto emitted tasks (`propagateProvenance` in `frontmatter.ts`) already exists — do not re-implement it, just ensure the stamp is read for the default selection.
>
> Test at the resolver's unit seam (precedence with the rung gone) and at the two call sites (stamp ⇒ which default). Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> RECORD any in-scope decision (e.g. how you re-express the retired `'untrusted-origin'` reason) per the ADR gate. Done: resolver reshaped, both callers select by stamp, untrusted-in-`ready` works and carries the stamp, tests green, gate green.

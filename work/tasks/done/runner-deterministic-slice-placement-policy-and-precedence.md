---
title: Runner-deterministic slice placement — slicesLandIn default + fixed trust precedence
slug: runner-deterministic-slice-placement-policy-and-precedence
spec: staging-pool-position-gate-and-trust-model
blockedBy: [pre-backlog-staging-folder-and-promote-step-a]
covers: [3, 5, 6, 12]
---

## What to build

Make WHERE slicer output lands a RUNNER-deterministic computation (not the fixed
"always staged" the tracer slice hard-coded), resolved from unforgeable inputs via
a fixed precedence chain that MIRRORS the existing untrusted-origin precedence in
`integration-core.ts`:

```
explicit operator flag  >  untrusted-origin forces STAGING  >  configured default  >  built-in
```

- **A configurable DEFAULT landing per lifecycle:** `slicesLandIn: backlog |
  pre-backlog` (pool vs staging), resolved per-repo EXACTLY like the existing
  `slicingIntegration` / `integration` knobs (CLI flag > env > per-repo > global >
  built-in). A repo can choose "slices always end in the pool" or "always staged
  for review."
- **The untrusted-origin EXCEPTION:** an untrusted-origin slicer output (the
  `originTrust: untrusted` stamp, already stamped at intake and propagated to
  emitted slices) is FORCED to staging (`pre-backlog/`) even in a "land in pool"
  repo — the positional analogue of the existing `untrusted-origin-forces-build-
  propose` rule, reusing the same trust signal to gate POOL ENTRY rather than build
  mode.
- **The explicit operator flag wins** over the untrusted-origin force (the operator
  is present; CLI always wins, no special force-key), exactly as
  `--merge`/`explicitMerge` overrides the untrusted-origin propose force today.

The agent NEVER sets placement — it is computed runner-side from the `originTrust`
stamp + the resolved policy + the explicit flag. Build on the `pre-backlog/`
staging folder + the placement seam introduced by the tracer slice.

## Acceptance criteria

- [ ] `slicesLandIn` resolves like `integration`/`slicingIntegration` (flag > env >
      per-repo > global > built-in); both "slices always end in `backlog/`" and
      "always staged in `pre-backlog/`" are verified.
- [ ] The precedence holds: `explicit operator flag > untrusted-origin forces
      staging > configured default > built-in` — a test drives each rung.
- [ ] An untrusted-origin (`originTrust: untrusted`) slicer output lands STAGED
      (`pre-backlog/`) even when the repo default is "land in pool"; a trusted/unset
      origin follows the configured default (zero behaviour change for the normal
      path).
- [ ] The agent's emitted output lands where the runner's policy/trust dictates, not
      where the agent wrote it — proven by a test.
- [ ] Tests use the house pattern (`--bare file://` arbiter via
      `test/helpers/gitRepo.ts`); they ISOLATE git config
      (`GIT_CONFIG_GLOBAL=/dev/null` as the existing tests do) and touch no real
      environment.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `pre-backlog-staging-folder-and-promote-step-a` — needs the `pre-backlog/` staging
  folder + the runner placement seam (and edits the same slicing/config modules, so
  serialized to avoid a merge conflict).

## Prompt

> Generalise slicer-output placement from the tracer's fixed "always staged" to a
> RUNNER-deterministic decision from unforgeable inputs. Read
> `work/spec/staging-pool-position-gate-and-trust-model.md` (US #3, #5, #6, #12) and
> the governing ADR. First check for drift against the code (the tracer slice
> `pre-backlog-staging-folder-and-promote-step-a` must already be in `done/` — this
> builds on its placement seam); if it landed differently, route to
> `needs-attention/` (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> THE PRECEDENCE TO MIRROR is already in `src/integration-core.ts`: the
> untrusted-origin build-propose rule resolves `explicit --merge > untrusted-origin
> ⇒ propose > config > default` from the `originTrust:` frontmatter (stamped at
> intake in `src/intake.ts`, propagated by the slicer via `propagateOrigin` in
> `stageSlicingLifecycle`). Build the POSITIONAL twin: `explicit operator flag >
> untrusted-origin ⇒ staging > slicesLandIn default > built-in`, deciding
> `pre-backlog/` vs `backlog/` for the emitted slices.
>
> THE CONFIG KNOB: add `slicesLandIn` resolved per-repo like `slicingIntegration`
> in `src/config.ts` (flag > env (`DORFL_SLICES_LAND_IN`) > per-repo > global
> > built-in). Follow the `slicingIntegration` / `integration` resolution shape
> exactly. The slicer reads the resolved placement; it never sets it itself.
>
> PUT THE PRECEDENCE RESOLVER IN A SHARED MODULE (not inlined into the slicing
> path), exposing a single pure function from the inputs (`originTrust` stamp,
> resolved `slicesLandIn`/`prdsLandIn` default, explicit flag) to the staging-vs-pool
> destination. The SPEC-placement slice
> (`pre-prd-staging-pool-split-and-untrusted-prd-placement`) REUSES this exact
> resolver for `prdsLandIn`; if it is inlined here it would have to be extracted
> there. Keep the lifecycle-specific bit (which two folders, which default key) as a
> parameter so both the slice and SPEC callers share one implementation.
>
> SEAMS TO TEST AT: the `--bare file://` arbiter house pattern
> (`test/helpers/gitRepo.ts`); cover each precedence rung + both default landings +
> the untrusted-origin force + the explicit-flag override. Isolate git config as the
> existing tests do.
>
> "DONE" = the acceptance criteria hold and
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (`pnpm format` to
> fix formatting). Do NOT commit or move work/ files — the runner owns git. Record
> the config-key spelling + precedence as an ADR if it meets the gate (it likely
> does — it pins a trust precedence), else a `## Decisions` note.

## Resolution (Gate-2 block fixed)

The first build was BLOCKED by Gate 2 (PR/code review) and routed to
`needs-attention/` for a REAL defect, now fixed:

- **The block:** the placement resolver (`src/placement.ts`), the `slicesLandIn`
  config key, the `DORFL_SLICES_LAND_IN` env coercion, the per-repo
  allowlist, and the direct `performSlice` tests were all in — but
  `config.slicesLandIn` and the `--slices-land-in` flag were NEVER threaded from
  `cli.ts` into the `DoOptions` the `do prd:` path builds. So the configured-default
  and explicit-flag rungs were dead from the shipped binary (a user setting
  `slicesLandIn: 'backlog'` got the built-in `pre-backlog` floor). Acceptance
  criterion #1 / SPEC US #5 failed in practice; the tests passed only because they
  called `performSlice` directly, bypassing the unwired CLI seam.
- **The fix:** thread `slicesLandIn` (`config.slicesLandIn` / `remoteConfig.slicesLandIn`)
  at the 5 `DoOptions` sites that already carry `slicingIntegration`; register
  `--slices-land-in <pre-backlog|backlog>` on `do` + `advance`, contributing
  `explicitSlicesLandIn` ONLY when the operator typed it (mirroring
  `flagMode === 'merge'` ⇒ `explicitMerge`); a bad value fails loud. Added a
  binary-level test (`do prd:` through `buildProgram()` on a `--bare file://`
  arbiter with a stub slicer) proving the configured value + the flag actually
  reach `performSlice`. The in-scope decisions (the CLI wire, the silent
  `scrubPoolDrift` fence, the `emitted`-path rewrite) are ratified in
  `docs/adr/slices-land-in-runner-deterministic-precedence.md`.

The full acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) is
green; this record rests in `work/done/`.

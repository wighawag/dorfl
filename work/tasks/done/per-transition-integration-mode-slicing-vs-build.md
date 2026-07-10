---
title: standing PER-TRANSITION integration mode as repo config — a NEW optional `slicingIntegration` key overrides the mode for the SPEC-slicing transition ONLY (so slice FILES can land on main directly, no PR), while the existing flat `integration` keeps governing the slice BUILD (a reviewable PR). Additive + non-breaking (NOT a type change to `integration`). Distinct from intake's per-OUTCOME `{slice, spec}`. Explicit --merge/--propose always wins.
slug: per-transition-integration-mode-slicing-vs-build
blockedBy: [remove-automerge-merge-means-auto-on-gate-pass]
covers: []
---

## What to build

Today `integration` (`propose` | `merge`) is a SINGLE repo-wide value, so the SPEC→slices transition and the slice→code transition cannot have different modes. The maintainer wants: **slice a SPEC straight onto `main` (the slice FILES land, no PR), but build each slice as a reviewable PR.** Add a per-TRANSITION integration mode.

### The two transitions (get the semantics right — this is the crux)

There are TWO distinct lifecycle transitions that integrate, and they are the two axes:

- **`slicing`** — turning a SPEC into backlog slice FILES: the emitted `work/backlog/*.md` + the SPEC lifecycle move (`work/slicing/ → work/spec-sliced/`). `merge` here means the slice FILES appear on `main` directly (no PR). VERIFIED home: `slicing.ts` (~L552, `mode: options.integration ?? 'propose'`, `type: 'slicing'`).
- **`build`** — turning a slice into CODE: the agent implements it, `verify`/review gate, done-move. `propose` here means the IMPLEMENTATION is a PR. VERIFIED home: `do.ts` threads `options.integration` into the build integrate path (~L605/~L694/~L966/~L1579/~L2039/~L2257).

So the maintainer's need is exactly `{ slicing: "merge", build: "propose" }`: slice files land on main; code is a PR.

### Config shape — a SEPARATE additive key, NOT a type change to `integration` (verified against the consumers)

The naive design "make `integration` a string-or-`{slicing, build}` union" is REJECTED: `config.integration` is consumed as a FLAT `IntegrationMode` string in ~8 places in `cli.ts` (~L312, ~L1559, ~L1597, ~L1914, ~L2045, ~L2312, ~L2432) AND is passed as the intake default at `cli.ts` ~L2888 (`resolveIntakeIntegrationModes(flags, config.integration)`, whose 2nd param is typed `IntegrationMode`). A union type would break ALL of them and would reach intake (violating "leave intake's resolver alone"). So instead:

- **`integration`** (`'propose' | 'merge'`, unchanged, flat) KEEPS its current meaning and KEEPS governing the **build** transition (and stays the intake default — untouched). All 8 consumers are unchanged.
- **`slicingIntegration`** (NEW, optional, `'propose' | 'merge'`) overrides the mode for the **slicing** transition ONLY. UNSET ⇒ the slicing transition uses `integration` (exactly today's behaviour — zero change for repos that don't set it).

```jsonc
"integration": "propose"        // build transition = propose (also the slicing default + intake default)
"slicingIntegration": "merge"   // OVERRIDE: the SPEC→slices transition lands on main (no PR)
```

This is the maintainer's target (`integration: "propose"` + `slicingIntegration: "merge"`: slice files land on main, code is a PR) with a minimal, additive, non-breaking change. `IntegrationMode` (`config.ts` ~L17) is unchanged.

### The wiring (verified seam)

`slicing.ts` does NOT read `config.integration` directly — it reads `options.integration` (~L552, `mode: options.integration ?? 'propose'`), THREADED IN by the caller (`do.ts` / advance / `cli.ts`). The SAME `config.integration` currently flows to both the slicing thread and the build thread via that option. The fix: the caller resolves `slicingIntegration ?? integration` for the value it threads into the SLICING transition, while the build path keeps threading `integration`. So the split happens at the caller's option-threading, NOT inside `slicing.ts` (which keeps taking one resolved `options.integration`).

### Precedence (per transition, resolved independently)

For the **slicing** transition:
```
explicit --propose / --merge flag        ← ALWAYS wins (the operator typed it)
  > slicingIntegration (env / per-repo / global)   ← the NEW slicing override
  > integration        (env / per-repo / global)   ← falls back to the flat value
  > default 'propose'
```
For the **build** transition: unchanged from today (`flag > integration (env/per-repo/global) > default`).

The existing `--propose`/`--merge` flags are TRANSITION-AGNOSTIC: each command runs ONE transition, so a single flag is unambiguous (a flag on a `do` build overrides the build mode; a flag on a slicing run overrides the slicing mode). No new per-transition FLAG is required. A `--slicing-integration` flag / `DORFL_SLICING_INTEGRATION` env MAY be added for parity with `integration`'s resolution chain, but the per-repo config key is the slice's core deliverable.

### NOT intake's `{slice, spec}` — a DIFFERENT resolver (do not unify; lens 4)

`intake.ts` ALREADY has a per-type integration object (`~L237`, `~L716`: `{slice, spec}`), but it answers a DIFFERENT question with a DIFFERENT resolver, and MUST stay separate:

- intake's `{slice, spec}` = "the artifact intake EMITTED from an issue — is IT a PR or merged?" Keyed by **emitted-artifact TYPE**, resolved with an axis this slice's path does NOT have: **author-trust** (`author_association`). The front door is public; anybody can file an issue.
- this slice's `slicingIntegration` (+ the flat `integration` it falls back to) = "this lifecycle TRANSITION — PR or merge?" resolved by operator/config only (the work is already INSIDE the trust boundary — a committed SPEC, a committed slice; there is no untrusted author).

So "slice" (intake's emitted artifact) and "slicing" (the act of slicing a SPEC) are deliberately DISTINCT words for distinct referents. This slice MUST NOT reuse/rename intake's `{slice, spec}` — they are two resolvers because there are two resolution contexts (public front door vs inside-the-boundary lifecycle). CRUCIALLY: `config.integration` STAYS the intake default (`cli.ts` ~L2888) — this slice does NOT change its type or its value, it only ADDS `slicingIntegration` that the slicing-transition caller consults. intake never reads `slicingIntegration`. They only TOUCH via a future data handoff (intake stamps a SPEC's origin; the build path reads it — slice `untrusted-origin-forces-build-propose`), not via a shared concept.

### Sits on the autoMerge resolution

`blockedBy` `remove-automerge-merge-means-auto-on-gate-pass`: this slice builds on the SETTLED meaning (`merge` = auto-land on gate pass; `propose` = a human merges), not the muddled `autoMerge`-downgrade model. Build that first so there is no `autoMerge` knob to also vary per transition.

## Acceptance criteria

- [ ] A NEW optional `slicingIntegration` (`'propose' | 'merge'`) per-repo config key is added; `integration` is UNCHANGED (still flat `'propose' | 'merge'`, still the build default + the intake default). A test pins: `slicingIntegration` set ⇒ the slicing transition uses it; UNSET ⇒ the slicing transition uses `integration` (byte-for-byte today's behaviour).
- [ ] The SPEC-slicing transition uses `slicingIntegration ?? integration`; the slice-BUILD transition keeps using `integration`. A test asserts a repo with `integration:"propose"` + `slicingIntegration:"merge"` lands the slice FILES on main (no PR) when slicing a SPEC AND opens a PR when building a slice.
- [ ] The split happens at the option-threading caller (`do.ts`/advance/`cli.ts` resolve `slicingIntegration ?? integration` for the value threaded into the slicing transition); `slicing.ts` still takes ONE resolved `options.integration` (its signature need not change). A test pins the caller threads the slicing-resolved mode.
- [ ] An explicit `--merge`/`--propose` flag ALWAYS wins over the config for the transition that command performs. A test pins `--propose` on a `slicingIntegration:"merge"` repo opens a PR for the slicing transition, and `--merge` on an `integration:"propose"` repo lands code on main when building.
- [ ] `slicingIntegration` resolves `flag > env (DORFL_SLICING_INTEGRATION, if added) > per-repo > global > (fall back to) integration > default 'propose'`. A test pins the fall-back-to-`integration` step.
- [ ] Back-compat: a repo WITHOUT `slicingIntegration` behaves EXACTLY as today (slicing uses `integration`). The ~8 `config.integration` consumers in `cli.ts` and the intake default (`cli.ts` ~L2888) are UNCHANGED. A test/read confirms no consumer breaks.
- [ ] intake's `{slice, spec}` per-outcome integration is UNTOUCHED (it never reads `slicingIntegration`). A test/read confirms intake still resolves its own `{slice, spec}` from flags + `config.integration`, independent of the new key.
- [ ] `CONTEXT.md` glossary (the "integration mode" entry, ~L40, + "Claim & integration terms" ~L35) pins the new key: `slicingIntegration` (the per-TRANSITION slicing override, inside-boundary, operator/config-resolved) vs intake `{slice,spec}` (per-EMITTED-TYPE, front-door, author-trust-resolved) — distinct concepts, not to be re-forked.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `remove-automerge-merge-means-auto-on-gate-pass` — build on the settled `merge`/`propose` meaning (no `autoMerge` knob to also vary per transition). Also a likely FILE-ORTHOGONALITY touch (both edit `config.ts`/`do.ts`/`integration-core.ts` around the integration mode), so serialise.

## Prompt

> FIRST, drift-check: confirm (a) `slicing.ts` still reads `options.integration` THREADED FROM ITS CALLER (~L552, `mode: options.integration ?? 'propose'`), NOT `config.integration` directly; (b) the SAME `config.integration` currently flows to both the slicing thread and the build thread via the caller's option; (c) `config.integration` is consumed as a FLAT `IntegrationMode` string in ~8 `cli.ts` sites AND passed as the intake default at `cli.ts` ~L2888 (`resolveIntakeIntegrationModes(flags, config.integration)`); (d) `IntegrationMode = 'propose'|'merge'` (`config.ts` ~L17), flat `integration: 'propose'` default (~L472). If `remove-automerge-merge-means-auto-on-gate-pass` has NOT landed, STOP (this is `blockedBy` it).
>
> GOAL: add a NEW optional `slicingIntegration` per-repo key that overrides the mode for the SPEC-slicing transition ONLY; leave `integration` flat + unchanged (it keeps governing the build transition AND stays the intake default). The maintainer's target is `integration:"propose"` + `slicingIntegration:"merge"`: slice a SPEC straight onto main (the slice FILES land, no PR), but build each slice as a reviewable PR. Do NOT make `integration` a union type — that would break the ~8 flat consumers + the intake default. The split happens at the caller's option-threading (`slicingIntegration ?? integration` for the slicing thread); `slicing.ts`'s signature need not change.
>
> HARD INVARIANTS: (1) explicit `--merge`/`--propose` ALWAYS wins for the transition that command runs. (2) `slicingIntegration` UNSET ⇒ slicing uses `integration` ⇒ byte-for-byte today's behaviour (zero change for repos that don't set it). (3) `integration`'s type/value/consumers are UNCHANGED, including the intake default at `cli.ts` ~L2888 — intake never reads `slicingIntegration`. (4) DO NOT unify with intake's `{slice, spec}` (a different resolver: emitted-type + author-trust, public front door).
>
> SEAMS TO TEST AT: config resolution (`slicingIntegration` set ⇒ used for slicing; unset ⇒ falls back to `integration`); the option-threading caller (`do.ts`/advance/`cli.ts` thread `slicingIntegration ?? integration` into the slicing transition, plain `integration` into the build); a repo `integration:"propose"`+`slicingIntegration:"merge"` lands slice files on main when slicing AND opens a PR when building; `--propose`/`--merge` override the resolved mode; intake (`cli.ts` ~L2888) untouched. Use the existing slicing / do / integration-core / config test harnesses; no network.
>
> DONE: `slicingIntegration` overrides the slicing transition's mode (falling back to `integration`), the build transition + the ~8 `integration` consumers + intake's default are untouched, explicit flags win, `CONTEXT.md` pins the new key as distinct from intake's `{slice,spec}`, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions — the runner/human owns those.

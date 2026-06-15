---
title: standing PER-TRANSITION integration mode as repo config — `integration` accepts a string (sets both) OR `{slicing, build}`, so the PRD-slicing transition can land on main directly (no PR) while each slice's BUILD is a reviewable PR. Distinct from intake's per-OUTCOME `{slice, prd}` (a different resolver). Explicit --merge/--propose always wins.
slug: per-transition-integration-mode-slicing-vs-build
blockedBy: [remove-automerge-merge-means-auto-on-gate-pass]
covers: []
---

## What to build

Today `integration` (`propose` | `merge`) is a SINGLE repo-wide value, so the PRD→slices transition and the slice→code transition cannot have different modes. The maintainer wants: **slice a PRD straight onto `main` (the slice FILES land, no PR), but build each slice as a reviewable PR.** Add a per-TRANSITION integration mode.

### The two transitions (get the semantics right — this is the crux)

There are TWO distinct lifecycle transitions that integrate, and they are the two axes:

- **`slicing`** — turning a PRD into backlog slice FILES: the emitted `work/backlog/*.md` + the PRD lifecycle move (`work/slicing/ → work/prd-sliced/`). `merge` here means the slice FILES appear on `main` directly (no PR). VERIFIED home: `slicing.ts` (~L552, `mode: options.integration ?? 'propose'`, `type: 'slicing'`).
- **`build`** — turning a slice into CODE: the agent implements it, `verify`/review gate, done-move. `propose` here means the IMPLEMENTATION is a PR. VERIFIED home: `do.ts` threads `options.integration` into the build integrate path (~L605/~L694/~L966/~L1579/~L2039/~L2257).

So the maintainer's need is exactly `{ slicing: "merge", build: "propose" }`: slice files land on main; code is a PR.

### Config shape

`integration` becomes a STRING-OR-OBJECT union (back-compatible — the string form still works and sets BOTH):

```jsonc
"integration": "propose"                              // shorthand: both transitions = propose
"integration": { "slicing": "merge", "build": "propose" }  // per-transition
```

- A bare string `"propose"`/`"merge"` resolves to `{slicing: <s>, build: <s>}`.
- The object form may set either or both; an omitted key falls back through the precedence chain (NOT silently to the other key's value).
- `IntegrationMode` (`'propose' | 'merge'`, `config.ts` ~L17) is unchanged; what changes is that the repo `integration` config can carry TWO of them.

### Precedence (per transition, resolved independently)

```
explicit per-invocation flag (--propose / --merge)   ← ALWAYS wins (the operator typed it)
  > AGENT_RUNNER_INTEGRATION env (+ a per-transition env form if added)
  > per-repo  integration.<transition>
  > global    integration.<transition>
  > default   'propose'
```

The existing `--propose`/`--merge` flags are TRANSITION-AGNOSTIC: a flag on `do` overrides the `build` transition; a flag on a slicing run overrides the `slicing` transition (each command only runs one transition, so a single flag is unambiguous). No new per-transition FLAG is required by this slice (an explicit flag already targets the one transition that command performs).

### NOT intake's `{slice, prd}` — a DIFFERENT resolver (do not unify; lens 4)

`intake.ts` ALREADY has a per-type integration object (`~L237`, `~L716`: `{slice, prd}`), but it answers a DIFFERENT question with a DIFFERENT resolver, and MUST stay separate:

- intake's `{slice, prd}` = "the artifact intake EMITTED from an issue — is IT a PR or merged?" Keyed by **emitted-artifact TYPE**, resolved with an axis this slice's path does NOT have: **author-trust** (`author_association`). The front door is public; anybody can file an issue.
- this slice's `{slicing, build}` = "this lifecycle TRANSITION — PR or merge?" Keyed by **transition**, resolved by operator/config only (the work is already INSIDE the trust boundary — a committed PRD, a committed slice; there is no untrusted author).

So "slice" (intake's emitted artifact) and "slicing" (the act of slicing a PRD) are deliberately DISTINCT words for distinct referents. This slice MUST NOT reuse/rename intake's `{slice, prd}` into `{slicing, build}` or vice-versa — they are two resolvers because there are two resolution contexts (public front door vs inside-the-boundary lifecycle). They only TOUCH via a future data handoff (intake stamps a PRD's origin; the slicing/build path reads it — slice `untrusted-origin-forces-build-propose`), not via a shared concept.

### Sits on the autoMerge resolution

`blockedBy` `remove-automerge-merge-means-auto-on-gate-pass`: this slice builds on the SETTLED meaning (`merge` = auto-land on gate pass; `propose` = a human merges), not the muddled `autoMerge`-downgrade model. Build that first so there is no `autoMerge` knob to also vary per transition.

## Acceptance criteria

- [ ] `integration` in `.agent-runner.json` accepts EITHER a string (`"propose"`/`"merge"`, sets both transitions) OR an object `{slicing?, build?}`. A test pins: string `"merge"` ⇒ both transitions merge; `{slicing:"merge", build:"propose"}` ⇒ slicing merges, build proposes; an omitted object key falls through precedence (not to the sibling key).
- [ ] The PRD-slicing transition (`slicing.ts`) resolves its mode from `integration.slicing`; the slice-BUILD transition (`do.ts`/build integrate path) resolves from `integration.build`. A test asserts a repo with `{slicing:"merge", build:"propose"}` lands the slice FILES on main (no PR) when slicing a PRD, AND opens a PR when building a slice.
- [ ] An explicit `--merge`/`--propose` flag ALWAYS wins over the config for the transition that command performs (slicing run vs build run). A test pins `--propose` on a `slicing:"merge"` repo opens a PR for the slicing transition, and `--merge` on a `build:"propose"` repo lands code on main.
- [ ] Resolution precedence is `flag > env > per-repo > global > default` PER transition, resolved independently (the two transitions can differ). A test pins independent resolution.
- [ ] Back-compat: an existing `"integration": "propose"` (string) behaves EXACTLY as today (both transitions propose). A test pins no behaviour change for the string form.
- [ ] intake's `{slice, prd}` per-outcome integration is UNTOUCHED and remains a separate resolver (this slice does not unify them). A test/read confirms intake still resolves its own `{slice, prd}` with author-trust, independent of the new `{slicing, build}`.
- [ ] `CONTEXT.md` glossary pins the two distinct concepts so they cannot be re-forked: `integration.{slicing,build}` (per-TRANSITION, inside-boundary, operator/config-resolved) vs intake `{slice,prd}` (per-EMITTED-TYPE, front-door, author-trust-resolved).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `remove-automerge-merge-means-auto-on-gate-pass` — build on the settled `merge`/`propose` meaning (no `autoMerge` knob to also vary per transition). Also a likely FILE-ORTHOGONALITY touch (both edit `config.ts`/`do.ts`/`integration-core.ts` around the integration mode), so serialise.

## Prompt

> FIRST, drift-check: confirm the two transition homes still take `options.integration` independently — `slicing.ts` (~L552, `mode: options.integration ?? 'propose'`, `type:'slicing'`) for the PRD→slices transition, and `do.ts` (the build integrate path, multiple `integration: options.integration` threads) for the slice→code transition. Confirm `IntegrationMode = 'propose'|'merge'` (`config.ts` ~L17) and the flat `integration: 'propose'` default (~L472). Confirm intake's SEPARATE `{slice, prd}` object (`intake.ts` ~L237/~L716) — this slice must NOT touch or unify it. If `remove-automerge-merge-means-auto-on-gate-pass` has NOT landed yet, STOP (this is `blockedBy` it).
>
> GOAL: make `integration` a string-OR-`{slicing, build}` union so the PRD-slicing transition and the slice-build transition can have DIFFERENT modes. The maintainer's target is `{slicing:"merge", build:"propose"}`: slice a PRD straight onto main (the slice FILES land, no PR), but build each slice as a reviewable PR. String form (`"propose"`) sets both (back-compat).
>
> HARD INVARIANTS: (1) explicit `--merge`/`--propose` ALWAYS wins over config for the transition that command runs. (2) the string form is byte-for-byte back-compatible. (3) DO NOT unify with intake's `{slice, prd}` — it is a DIFFERENT resolver (emitted-type + author-trust, public front door) vs this (transition + operator/config, inside the trust boundary); reusing the words across them is a coherence defect. (4) an omitted object key falls through the precedence chain, not to its sibling.
>
> SEAMS TO TEST AT: config resolution (string ⇒ both; object ⇒ per-transition; omitted key ⇒ precedence fallthrough); `slicing.ts` (slicing transition reads `.slicing`; a `slicing:"merge"` repo lands slice files on main, `--propose` overrides to a PR); the build integrate path (`do.ts`; reads `.build`; a `build:"propose"` repo opens a PR, `--merge` overrides to main); intake untouched. Use the existing slicing / do / integration-core test harnesses; no network.
>
> DONE: `integration` is per-transition (string-or-object), the two transitions resolve independently with explicit flags winning, intake's resolver is untouched and documented as distinct, `CONTEXT.md` pins both concepts, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions — the runner/human owns those.

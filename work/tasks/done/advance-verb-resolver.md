---
title: advance — the `advance` sibling top-level verb + the `obs:` resolver extension (no `do` subcommand, no standalone `slice` verb)
slug: advance-verb-resolver
spec: advance-loop
blockedBy: [advance-tick-classifier, advancing-lock-borrow]
covers: [1, 5, 6, 18]
---

## What to build

The `advance` command surface: a NEW **sibling top-level verb** (NOT a `do` subcommand) reusing the existing `prefix:arg` slug-namespace resolver, with the classify → lock → execute skeleton wired to the tick classifier and the `advancing` lock. This slice delivers the verb + arg shapes + the classify→lock→(dispatch) skeleton + an `obs:` namespace extension to the resolver, WITHOUT the rung bodies (surface/apply/triage rung EXECUTION are their own slices) — it dispatches a classified rung to a stub/seam those slices fill, and reuses `do`/`do prd:` for the build/slice rungs (it ORCHESTRATES, never duplicates).

### The command shapes (from the PRD)

```
advance <slug>          # advance a slice one rung   (bare slug = slice, like do)
advance prd:<slug>      # advance a PRD (apply answers, then the slice rung)
advance obs:<slug>      # triage an observation       (NEW namespace)
advance                 # advance the eligible set    (like bare `do` autopicks)
```

### Precise scope

- Add `advance` as a sibling top-level verb in the CLI (NOT a `do` subcommand — `do` subcommands are REJECTED in the PRD; the "bare slug = slice" ergonomic is preserved). It reuses the SAME shared resolver `do` uses.
- **Extend the resolver with an `obs:` namespace** (`slug-namespace.ts` currently has `slice`/`prd`): `obs:<slug>` → observation. Keep the bare-slug = slice/PRD-cross-check behaviour for `advance` exactly as `do` has it. (This is the one resolver change; the `do`-only `resolveSliceOnlyArg` path stays rejecting `prd:`/`obs:` as today.)
- Wire the classify → lock → execute SKELETON: call the tick classifier (`advance-tick-classifier`, read-only, no model, no lock) to get the rung, THEN take the `advancing` CAS lock (`advancing-lock-borrow`) for the classified rung, THEN dispatch — winner-only — to a rung executor SEAM (the surface/apply/triage rung bodies are later slices; the build-slice/slice-prd rungs call the existing `do`/`do prd:` machinery). A CAS loser backs off having spent ~nothing (classification is free; the expensive phase is always post-lock).
- `advance` ORCHESTRATES `do`/`do prd:` for build/slice rungs — it is a driver layered ON TOP, never a peer that duplicates the build/slice path. (One build path, one slice path — US #6.)

The two DRIVERS (one-shot sequential / loop) and `-n`, plus the per-action gates, are a LATER slice (`advance-drivers-and-gates`) — this slice delivers the single named-item tick path + the resolver. `advance` (bare, eligible-set) needs the pool scan / driver, so wire it to dispatch a SINGLE named item here and leave the bare-form to the drivers slice (or stub it to error "needs the driver slice" clearly — record that seam in a `## Decisions` block).

## Acceptance criteria

- [ ] `advance <slug>` / `advance prd:<slug>` / `advance obs:<slug>` resolve via the SHARED resolver (NOT a `do` subcommand; bare slug = slice preserved); `obs:` is a new resolver namespace.
- [ ] The verb runs classify (read-only, no model, no lock) → take the `advancing` CAS lock for the classified rung → dispatch winner-only; a CAS loser backs off having done only the free classification.
- [ ] Build-slice / slice-prd rungs ORCHESTRATE the existing `do` / `do prd:` machinery (no duplication of the build/slice path).
- [ ] Surface / apply / triage rungs dispatch to a clearly-named executor SEAM that later slices fill (this slice does not implement the rung bodies).
- [ ] `advance` bare-form (eligible set) is either wired to a single named-item path or stubbed with a CLEAR "needs the driver slice" error, recorded in a `## Decisions` block.
- [ ] Tests: resolver `obs:`/`prd:`/bare cases; the classify→lock→dispatch order (a CAS loser does no model work); orchestration of `do`/`do prd:` is invoked (not re-implemented). House CAS-seam + throwaway-repo style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-tick-classifier` — the verb calls the classifier to pick the rung.
- `advancing-lock-borrow` — the verb takes the `advancing` lock post-classify.

## Prompt

> Add `advance` as a sibling top-level verb (NOT a `do` subcommand) reusing the shared `prefix:arg` resolver, and wire the classify → lock → execute SKELETON. Read the PRD `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("The command surface", "The advance TICK", "Classify → lock → execute", US #1/5/6/18, and Out of Scope — `do` subcommands and a standalone `slice` verb are REJECTED). This slice delivers the verb + arg shapes + the skeleton + an `obs:` resolver extension; the rung BODIES (surface/apply/triage) and the DRIVERS/`-n`/gates are LATER slices — dispatch to a named executor seam and orchestrate `do`/`do prd:` for the build/slice rungs (one build path, one slice path; `advance` is a driver ON TOP, never a duplicate).
>
> Shapes: `advance <slug>` (bare = slice), `advance prd:<slug>`, `advance obs:<slug>` (NEW namespace), `advance` (bare eligible-set — wire to single named item or stub with a clear "needs the driver slice" error, recorded in `## Decisions`). Extend `slug-namespace.ts` with the `obs:` namespace (it has `slice`/`prd` today); keep the bare-slug cross-check as `do` has it. Classify (read-only, no model, no lock) → take the `advancing` CAS lock → dispatch winner-only; a loser backs off having spent ~nothing.
>
> READ FIRST: `packages/dorfl/src/cli.ts` (how `do`/`do prd:` are wired as verbs — add `advance` as a SIBLING), `packages/dorfl/src/slug-namespace.ts` (`parseSlugArg`/`resolveSlug` — add the `obs:` namespace), the tick classifier from `advance-tick-classifier`, the `advancing` lock from `advancing-lock-borrow`, and `packages/dorfl/src/do.ts` (the `do`/`do prd:` machinery to ORCHESTRATE).
>
> FIRST, check this slice against current reality (drift). The resolver + `do prd:` routing-through-integration are LANDED substrate (PRD 2026-06-09 UPDATE). If they landed differently, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim advance-verb-resolver --arbiter origin
git fetch origin && git switch -c work/advance-verb-resolver origin/main
git mv work/in-progress/advance-verb-resolver.md work/done/advance-verb-resolver.md
```

## Needs attention

transient infra: {"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CbwpN666Kz46qPnsmf2ZY"           }

## Requeue 2026-06-11

Transient infra failure (Anthropic overloaded_error, req_011CbwpN666Kz46qPnsmf2ZY) — NOT a code/work problem. Partial work saved on the branch; continue from its tip and finish the slice.

---
title: do vs advance in CI — advance does NOT simplify SELECTION (both auto-pick the same pool); it adds the LIFECYCLE rungs + the answer-driven trigger
date: 2026-06-12
status: open
---

## What was noticed

While reviewing whether the `advance` command is usable here, the question came up: does `advance` simplify the CI (GitHub Actions) workflow logic about "picking up what to do" vs just using `do`? The conclusion is worth recording so it is not re-derived: **`advance` does NOT meaningfully simplify SELECTION over `do`; its CI value is a DIFFERENT axis — the lifecycle rungs + an answer-driven trigger.**

## The two concerns are distinct (conflating them is the usual confusion)

### Concern 1 — "what do I work on?" (selection): `do` and `advance` are ~equal

Both already auto-pick over the SAME mirror-side eligible-pool scan:

- `do` (auto-pick / `-n` / `do --remote -n`) picks buildable slices + sliceable PRDs.
- `advance` (auto-pick / `-n`) picks over the same pool, PLUS observations.

For a pure "build whatever is ready on a cron" job, `do -n` and `advance -n` are about the same amount of workflow YAML. `advance` does NOT reduce selection logic here. A build-only CI cron is well served by `do` alone.

### Concern 2 — the LIFECYCLE, not just the build: this is where `advance` earns its place

`do` knows only two rungs: build a slice, slice a PRD. It CANNOT triage an observation, surface a question to `work/questions/` when an item needs judgement, or apply a human's committed answer and then advance. `advance`'s whole point is "do every autonomous rung, and when you hit judgement, write a question file and STOP." That is what lets a CI loop drain a POPULATED `work/` tree (PRDs + observations + half-answered items) toward "all ready slices built," human's only job = answer files on their own time. `do` structurally cannot do that loop (no question/answer protocol).

## Where `advance` genuinely simplifies the WORKFLOW (not selection)

The shipped CI template (`docs/ci/advance-loop.yml.template`, validated by `src/advance-ci-template.ts`) shows the real win, which is trigger + integration-mode coupling:

1. **A trigger `do` has no concept of:** `on.push` touching `work/questions/**` — "a human committed an answer → run a pass to apply it and surface the next batch." That answer-driven cadence is the heart of the advance loop; `do` has no rung for it.
2. **One dispatch input `integrationMode` drives BOTH the integration flag AND the job shape**, so they cannot desync:
   - `propose` → a MATRIX of independent jobs (one PR per item, `--propose` tied to each leg so a leg can never merge to main);
   - `merge` → a SINGLE SEQUENTIAL job (`advance -n … --merge`) because merge-mode items rebase-chain and parallel merge jobs would thrash the main-CAS.

NOTE the propose=matrix / merge=sequential discipline is a property of the INTEGRATION MODE, not the verb — `do` could use the identical CI shape. The structural simplification `advance` adds is specifically the question/answer trigger + the unified lifecycle rung set, NOT the matrix logic.

## Recommendation (the routing rule)

- CI is "build ready slices / slice ready PRDs on a cron," human triages/answers locally ⇒ **`do -n` (or `do --remote -n`) is sufficient and simpler** (two rungs, no sidecar machinery).
- CI should drain a whole populated `work/` tree toward done while a human only answers question files committed to the repo (the "human is the clock" north star) ⇒ **`advance` was built for exactly this and `do` cannot replace it** — the win is the surface/apply rungs + the `on: push work/questions/**` trigger, not the auto-pick.

One line: **`advance` doesn't simplify PICKING; it adds the rungs and the answer-driven trigger that let CI advance the LIFECYCLE, not just the build.**

## Disposition hint (for triage)

Candidate to FOLD into an ADR or a CI/usage doc (the `do` vs `advance` routing rule is durable guidance, not a defect). Not a slice on its own. Cross-ref: `docs/ci/advance-loop.yml.template`, `src/advance-ci-template.ts`, PRD `work/prd-sliced/advance-loop.md` (US #27/28), and the new slice `work/backlog/advance-isolated-one-shot.md`.

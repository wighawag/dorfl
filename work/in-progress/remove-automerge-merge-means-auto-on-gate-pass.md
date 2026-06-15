---
title: DELETE the autoMerge knob entirely (config key, env var, CLI flags, and the merge→propose downgrade) — resolving the autoMerge concept-collision in favour of "merge means auto-merge on gate pass; propose means a human merges" (Model P). Hard delete, NO deprecation (no external users).
slug: remove-automerge-merge-means-auto-on-gate-pass
blockedBy: []
covers: []
---

## What to build

Resolve the long-standing `autoMerge` concept-collision (`work/findings/automerge-concept-collision-merge-vs-propose.md`, open since 2026-06-07) by REMOVING the `autoMerge` knob entirely. The maintainer has DECIDED the model (recorded here so it is not relitigated):

- **`integration: merge`** means "land it AUTOMATICALLY when the gate passes" (the gate being `verify`, plus the `review` Gate-2 judgement if `review` is on). There is no separate "auto" sub-knob — merge IS the auto-merge.
- **`integration: propose`** means "a human checkpoint before it lands" (a PR, or the PR-less propose flow). A human does the merge.
- The fourth combination `autoMerge` was invented to express (`merge` + `autoMerge: false` ⇒ silently DOWNGRADE to propose) is REDUNDANT with `propose` and is the source of the confusion. It goes away.

This adopts **Model P** from the finding (the maintainer's recorded intent: review/auto-land is a property of the chosen integration mode, not a separate gate) and answers the finding's four open user stories with the single rule above. The finding can be deleted (or marked resolved) by this slice.

### Hard delete — NO deprecation

This repo has NO external users (same basis as the `observationTriage` clean replacement of `autoTriage`, decided 2026-06-12). So `autoMerge` is HARD-DELETED: no deprecation warning, no `DEPRECATED_CONFIG_KEYS` entry, no env-var-ignored-with-warning. A stale `autoMerge` key in a config file simply has no effect (it is not a recognised key). Do NOT build migration machinery.

### VERIFIED against the code — the exact surface to remove (confirm against `src/` at build time)

`autoMerge` is threaded through (drift-check each before editing):

- **`config.ts`** — the `autoMerge: boolean` field on `Config`, its docstring, and the `DEFAULT_CONFIG.autoMerge: false`.
- **`repo-config.ts`** — `autoMerge` in the recognised per-repo key list (~L116).
- **`env-config.ts`** — `autoMerge: 'boolean'` in the env-var coercion table (~L98), so `AGENT_RUNNER_AUTO_MERGE` no longer resolves.
- **`do-config.ts`** — the `autoMerge?` flag-override field (~L125) + its `overrides.autoMerge` wiring (~L161).
- **`cli.ts`** — the `--auto-merge`/`--no-auto-merge` option(s) and every `autoMerge: config.autoMerge` pass-through (multiple commands: `do`, `run`, `complete`, the advance tick, remote variants).
- **`do.ts` / `run.ts` / `complete.ts`** — the `autoMerge?` option fields + pass-throughs.
- **`integration-core.ts`** — the load-bearing logic: `autoMerge?` on the input (~L254), the `downgradeMerge` field on the review outcome (~L2269), the `downgradeMerge: !input.autoMerge` decision (~L2390), and the TWO downgrade APPLICATION sites — the build path (~L680) AND the slicing path (~L1103), each `if (…downgradeMerge && mode === 'merge') { mode = 'propose'; }` plus its log line (~L682/~L1105). With `autoMerge` gone, a resolved `merge` ALWAYS proceeds on a green gate / review approve — NO downgrade. DELETE both downgrade branches + the `downgradeMerge` field, not just the flag.
- **`complete.ts`** — besides the `autoMerge?` option field (~L159) + pass-through (~L510): the `requestedMode`-vs-EFFECTIVE-mode plumbing (~L583-589) reads `result.mode` (the EFFECTIVE mode the core resolved) precisely BECAUSE a downgrade could make effective ≠ requested. With the downgrade gone, effective mode ALWAYS equals requested — the plumbing still WORKS (harmless), but its `post-downgrade` doc-comments (~L388, ~L584-587) become STALE and must be cleaned (and the now-pointless requested-vs-effective distinction simplified if it reads clearly). Do NOT leave comments asserting a downgrade that no longer exists.
- **`slicing.ts` / `intake.ts`** — these pass `autoMerge: true` precisely to OPT OUT of the downgrade (so an explicitly-chosen `--merge` slicing/intake run lands as chosen): `slicing.ts` (~L551), `intake.ts` (~L1056 + ~L1163). With the downgrade gone, that opt-out is unnecessary; remove the `autoMerge: true` lines AND their now-stale explanatory comments (the mode is honoured directly). NOTE: `intake.ts` (~L1052) also carries an unrelated "per-outcome KNOBS are a later slice" comment — that is the `per-type-integration-mode-prd-vs-slice` idea's concern, NOT this slice; leave it.

### Net behaviour after removal

- `merge` + `review: off` ⇒ lands on main on green `verify` (UNCHANGED — the downgrade never applied without review).
- `merge` + `review: on` ⇒ review gates; on APPROVE it lands on main automatically (was previously the `autoMerge: true` path; now the ONLY merge behaviour). On BLOCK it does not land (UNCHANGED).
- The old `merge` + `review: on` + `autoMerge: false` ("review gates but a human merges") is now expressed by `propose` + `review: on` — the canonical human-checkpoint form.

## Acceptance criteria

- [ ] The `autoMerge` field is GONE from `Config` (`config.ts`) + `DEFAULT_CONFIG`; the per-repo key list (`repo-config.ts`) no longer lists it; the env table (`env-config.ts`) no longer maps it (so `AGENT_RUNNER_AUTO_MERGE` is inert). A stale `autoMerge` config key is silently inert (NOT a hard error, NOT a deprecation warning — it is simply unrecognised). A test pins that an `autoMerge` key in config has no effect.
- [ ] The `--auto-merge` / `--no-auto-merge` CLI flags are REMOVED from every command that exposed them (`do`/`run`/`complete`/advance + remote variants). A test/`--help` assertion confirms they are gone.
- [ ] The `merge→propose` DOWNGRADE is deleted from `integration-core.ts` at BOTH application sites (build ~L680 + slicing ~L1103): a resolved `merge` ALWAYS proceeds on a green gate (review off) or a review APPROVE (review on) — it is never downgraded. The `downgradeMerge` field + the `!input.autoMerge` logic + both log lines are removed. A test asserts `merge` + `review: on` + APPROVE lands on main (no downgrade) and `merge` + `review: on` + BLOCK does not — on BOTH the build path and the slicing path.
- [ ] `complete.ts`'s `requestedMode`-vs-effective-mode plumbing (~L583-589) and its `post-downgrade` doc-comments (~L388, ~L584-587) are cleaned: with no downgrade, effective mode always equals requested mode. No comment asserts a downgrade that no longer exists; the requested-vs-effective distinction is simplified where it now reads as dead nuance. A test/read confirms `complete` integrates a resolved `merge` as `merge` (not silently as `propose`).
- [ ] `slicing.ts` + `intake.ts` no longer pass `autoMerge: true`; an explicitly-chosen `--merge` slicing/intake run still lands as chosen (the mode is honoured with no opt-out needed). A test pins a `--merge` slicing run still lands on main.
- [ ] Every existing test referencing `autoMerge` / `--auto-merge` is updated or removed: `integration-core.test.ts`, `do.test.ts`, `review-gate-pr.test.ts`, `run-integration-core.test.ts`, `review-gate.test.ts`, `watch-review-session.test.ts`, `run.test.ts`, `review-gate-pr-comment.test.ts`, `review-nits-observation.test.ts`. The downgrade-specific tests are deleted (the behaviour they pinned is gone); the merge-on-approve tests are kept/adjusted to the new single behaviour.
- [ ] The PRD `work/prd-sliced/review.md` is updated to Model P (review auto-lands iff `integration: merge`; `propose` = human merges) — its `autoMerge`-as-separate-knob language is removed. The ADR `docs/adr/ci-config-policy-and-gate-family.md` `autoMerge` reference is updated/removed to match.
- [ ] The finding `work/findings/automerge-concept-collision-merge-vs-propose.md` is marked RESOLVED (or deleted) citing this slice.
- [ ] `.agent-runner.json` in THIS repo no longer needs the `autoMerge` key (it is inert after removal); the slice may note it but the human owns editing the live repo config.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check: re-read `work/findings/automerge-concept-collision-merge-vs-propose.md` (the DECISION is Model P: merge auto-lands, propose = human merges; this slice resolves it by DELETING autoMerge, no separate knob). Confirm the surface still matches: `autoMerge` on `Config` (`config.ts`) + `DEFAULT_CONFIG`, in `repo-config.ts`'s key list, `env-config.ts`'s coercion table, the `--auto-merge`/`--no-auto-merge` flags in `cli.ts`, the `autoMerge?` options on `do.ts`/`run.ts`/`complete.ts`, the `downgradeMerge: !input.autoMerge` decision in `integration-core.ts` (~L2390) and its TWO application sites — the build path (~L680) AND the slicing path (~L1103) — plus `complete.ts`'s requested-vs-effective-mode plumbing (~L583-589, which exists ONLY because a downgrade could make them differ), and the `autoMerge: true` opt-outs in `slicing.ts` (~L551) / `intake.ts` (~L1056, ~L1163). If the surface has shifted, adapt — the GOAL is the invariant, not the line numbers.
>
> GOAL: HARD-DELETE the `autoMerge` knob (NO deprecation — this repo has no external users). After this, `integration: merge` means "auto-land on gate pass" (green verify, plus review-approve if review is on) and `integration: propose` means "a human merges" (PR / PR-less). The `merge`+`autoMerge:false` "downgrade to propose" combination is gone — it is redundant with `propose`. DELETE the downgrade logic in `integration-core.ts`, not just the flag.
>
> HARD INVARIANTS: (1) `merge` + review OFF still lands on a green verify (unchanged). (2) `merge` + review ON lands on APPROVE, does NOT land on BLOCK. (3) `propose` is unchanged (always a human checkpoint). (4) A stale `autoMerge` config key is silently inert — NOT a hard error, NOT a deprecation warning. (5) An explicit `--merge` slicing/intake run still lands as chosen (the removed `autoMerge:true` opt-out is no longer needed because there is no downgrade to opt out of).
>
> SEAMS TO TEST AT: `integration-core.ts` BOTH paths (build + slicing) (feed `merge` + review-approve ⇒ lands; `merge` + review-block ⇒ does not; assert NO downgrade-to-propose path exists on either); `complete.ts` (a resolved `merge` integrates AS `merge`, never silently `propose`); config load (an `autoMerge` key / `AGENT_RUNNER_AUTO_MERGE` env is inert); the CLI `--help` (no `--auto-merge`). Update/delete the 9 test files that reference autoMerge. No network; reuse the existing review-gate/integration-core test harnesses.
>
> DONE: `autoMerge` is gone everywhere (config/env/flags/downgrade), the PRD + ADR reflect Model P, the finding is marked resolved, the 9 tests are updated, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

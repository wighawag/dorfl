---
title: review-gate-pr — Gate 2 (PR/code review) on the `do` path; run the review skill after verify, merge only on approve, route block to needs-attention
slug: review-gate-pr
prd: review
blockedBy: []
covers: [3, 4, 6, 7]
---

## What to build

The **PR/code review gate (Gate 2)** as a step inside the `do`/`complete` pipeline, layered ON TOP of the deterministic `verify` floor. After the acceptance gate (`verify`) passes and BEFORE the done-move/integrate, `do` invokes the **`review` skill** (`skills/review/SKILL.md`, already built — `done/review-skill.md`) as a **fresh-context** agent, parses its verdict, and:

- **`approve`** → proceed to the existing done-move + commit + integrate exactly as today. On a repo configured `review: on` + `autoMerge: on` with `--merge`/`integration: merge`, this is what makes an autonomous merge trustworthy — verify (builds+tests+formats) **plus** an independent judgement verdict (does the diff reach the slice's goal).
- **`block`** → do NOT integrate. Route the work to `needs-attention/` through the **SAME** machinery the red-gate path already uses (`routeToNeedsAttention(arbiter)` in `complete.ts`, surfaced on `surfaceArbiter` for the autonomous `do` path), with the review's blocking findings recorded as the reason in the item body. Never merge.

This is the unlock for a trustworthy `do <slug> --merge` (and, once `do-autopick` lands, `do -n <N> --merge`) on a `review`-configured repo: the gate rides INSIDE `do`, so CI (a caller of `do`) inherits it for free.

### Scope fence — Gate 2 ONLY (this slice)

- **IN:** the PR/code review gate on the `do`/`complete` path — invocation after `verify`, verdict parsing, approve→integrate / block→needs-attention routing, the per-repo `review` toggle, the per-repo `review` MODEL OVERRIDE, the `reviewMaxRounds` iteration bound, and the `autoMerge`-on-approve gate (repo policy only).
- **OUT (deliberate, named follow-ups — do NOT build here):**
  - **Gate 1 (spec/slice review after auto-slicing)** — guards the `autoslice-*` chain, a separate slice (`review` PRD).
  - **Posting the verdict AS a GitHub PR review/comment via a provider seam** — `review.md` makes Gate 2 "more visible" by posting on the PR. There is no provider/PR-comment seam in `src/` today (no `provider*` module). This slice runs the gate and routes via needs-attention (cross-machine visible already); the PR-comment surfacing is a **follow-up slice** (`review-gate-pr-comment`) blocked on the provider seam. State this; do not stub a fake seam.
  - **Author-trust resolver** — `autoMerge` keys on **per-repo policy only** here (the `do`-path author is the operator who ran the command). Author-association / request-channel trust is a CI/issue-front-door concern owned by `issue-intake`, explicitly NOT shared with this gate (decoupled — see `review.md` Autonomy notes).

### How it composes with the existing pipeline (the real seam)

`do` (`src/do.ts` `performDo`) reaches integration via `performComplete({slug, cwd, arbiter, integration, verify, surfaceArbiter, …})` (`src/complete.ts`). Inside `performComplete`, step 1 runs the gate (`runVerify`) and, on red, calls `routeToNeedsAttention` and returns `outcome: 'gate-failed'`; on green it falls through to step 2 (the `git mv` done-move). **The review step inserts between the green gate and the done-move** — i.e. right after the `runVerify` success branch, before `mkdirSync(.../done)`. A `block` verdict re-uses the gate-fail routing verbatim (a new terminal outcome, e.g. `review-blocked`, mapped by `do.ts` into its existing `needs-attention` outcome the same way `gate-failed` is). The `review`-agent invocation uses the existing harness seam (`src/harness.ts` `LaunchInput {command, prompt, model}`); the review MODEL override flows through `model` (reuse `substituteModel`/the §13 model-routing intent, NOT a new mechanism). Fresh context = a separate harness launch, not the builder's session.

### Config + resolution (mirror `integration`/`allowAgents` precedence exactly)

Add to the per-repo config surface (`src/repo-config.ts` `REPO_CONFIG_KEYS` + `ResolvedRepoConfig`, alongside `integration`/`allowAgents`/`model`):

- **`review`** (bool, default **OFF**) — run Gate 2 on `do`/`complete`. Resolved **flag (`--review`/`--no-review`) > per-repo `.dorfl.json` > global > default false** — the SAME chain `integration`/`allowAgents` use.
- **`autoMerge`** (bool, default **OFF**) — on an `approve`, allow the resolved `merge` integration to proceed autonomously. Same precedence chain. **Repo policy only.** A non-`approve` verdict NEVER auto-merges regardless. (If `autoMerge` is off but `review` is on, review still runs and blocks/approves, but a human does the merge — i.e. review is advisory-but-blocking; `--propose` still applies.)
- **`reviewModel`** (string, optional) — the model the REVIEW agent runs on (de-correlation from the builder). Resolved like `model` (flag > env > per-repo > global > default = unset → no forced model). Distinct from the builder's `model`.
- **`reviewMaxRounds`** (number, default a small N e.g. 2) — bound the revise↔review loop. On exhaustion, **ERROR OUT** and force `needs-attention/` (never silently merge or loop), per the maintainer decision.

`verify` stays the **non-skippable deterministic floor** — review is ON TOP, never replaces it. `--skip-verify` remains the only (human-only) gate override and does NOT skip review unless a symmetrical, deliberately-named human override is added (out of scope; default is review-runs-when-`review`-on).

## Acceptance criteria

- [ ] With `review: on`, `do <slug>` (and `complete`) runs the `review` skill as a fresh-context agent AFTER `verify` passes and BEFORE the done-move.
- [ ] An `approve` verdict proceeds to the existing done-move + commit + integrate unchanged. With `autoMerge: on` + `merge` integration, the work merges autonomously; with `autoMerge: off`, review still gates but the merge is left to a human (`--propose` semantics).
- [ ] A `block` verdict does NOT integrate and routes the item to `needs-attention/` via the SAME `routeToNeedsAttention` path the red gate uses (surfaced on `surfaceArbiter` for the `do` path), with the review's blocking findings recorded as the reason. `do` maps it to its `needs-attention` outcome + exit 1, exactly like `gate-failed`.
- [ ] `verify` is STILL run and is NEVER replaced by the model review for code (assert the deterministic floor is intact — both run, in order).
- [ ] `review` / `autoMerge` / `reviewModel` / `reviewMaxRounds` resolve via the `integration`/`allowAgents` precedence (flag > per-repo > global > default), with `review`/`autoMerge` defaulting OFF.
- [ ] `reviewMaxRounds` is enforced: a revise↔review loop cannot run forever; on exhaustion it errors out and forces `needs-attention` (a test drives the loop to exhaustion and asserts the route + non-zero exit).
- [ ] A non-`approve` verdict NEVER auto-merges, regardless of `autoMerge`.
- [ ] The `reviewModel` override reaches the review-agent launch via the existing `LaunchInput.model` / `substituteModel` seam (no new model mechanism).
- [ ] Tests cover the new behaviour, stubbing BOTH the review agent (return a canned `approve`/`block` verdict — no real model) AND, where exercised, the integration/git via the existing `do`/`complete` test harness (local `--bare` arbiter, temp dirs). No network, no real GitHub, no real model.
- [ ] **Test isolation (shared-write-location rule, WORK-CONTRACT):** the `do`/`complete` tests already isolate `workspacesDir` + `PI_CODING_AGENT_DIR` (`isolatePiAgentDir`) and assert the real `~/.dorfl/` + `~/.pi/agent/sessions/` are UNTOUCHED — this slice keeps that intact (the review agent writes nothing outside its scratch context).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — startable now. `review`'s `sliceAfter` deps (`auto-slice`, `review-skill`) are both sliced and `review-skill` is built (`done/review-skill.md`), so the `review` skill this gate invokes already exists at `skills/review/SKILL.md`.
- (NOT blocked by `do-autopick`/`do-remote`/`runner-in-ci` — the gate lives in the shared `do`/`complete` pipeline and rides along into every `do` form and into CI for free.)

## Prompt

> Build **Gate 2 — the PR/code review gate** on the `do`/`complete` pipeline, per `work/prd/review.md` (the GATES PRD; the protocol it runs is the already-built `review` SKILL at `skills/review/SKILL.md`). Scope is Gate 2 ONLY — NOT Gate 1 (spec review), NOT a provider PR-comment seam, NOT any author-trust resolver (those are named follow-ups; see the slice's "Scope fence").
>
> FIRST run the drift check (this slice is a launch snapshot — verify it against what landed):
>
> - Confirm `src/complete.ts` `performComplete` still runs `runVerify` as step 1 and, on green, falls through to the done-move (`mkdirSync(.../done)` + `git mv`); the review step inserts BETWEEN them. Confirm the red-gate path calls `routeToNeedsAttention` and returns `outcome: 'gate-failed'` — you reuse that routing verbatim for a `block` verdict.
> - Confirm `src/do.ts` `performDo` reaches integration via `performComplete(…, surfaceArbiter: arbiter, …)` and maps `gate-failed` → its `needs-attention` outcome + exit 1; add a `review-blocked` terminal the same way (or fold into the existing needs-attention mapping).
> - Confirm the per-repo config seam: `src/repo-config.ts` `REPO_CONFIG_KEYS` + `ResolvedRepoConfig` carry `integration`/`allowAgents`/`model` resolved "flag > per-repo > global > default" — add `review`/`autoMerge`/`reviewModel`/ `reviewMaxRounds` the SAME way (`src/config.ts` documents the precedence).
> - Confirm the harness seam: `src/harness.ts` `LaunchInput {command, prompt,     model}` + `substituteModel` is how an agent is launched and how the model routing intent is injected — reuse it for the fresh-context review agent and the `reviewModel` override. Do NOT invent a new model/launch mechanism. Route the slice to `needs-attention/` on any real discrepancy (WORK-CONTRACT "Drift is a needs-attention signal").
>
> Then implement: after the green `verify`, if `review` resolves on, launch the `review` skill as a FRESH-CONTEXT agent (its own harness launch, `reviewModel` via `model`/`substituteModel`), parse a `{verdict: approve|block, findings[…]}` result. approve → existing done-move/commit/integrate (autonomous merge only when `autoMerge: on` AND integration resolves to `merge`; else leave merge to a human / `--propose`). block → `routeToNeedsAttention(surfaceArbiter)` with the findings as the reason, no integrate, exit 1. Enforce `reviewMaxRounds` (error out → needs- attention on exhaustion). `verify` is the non-skippable floor — review is ON TOP, never replacing it.
>
> READ FIRST: `skills/review/SKILL.md` (the verdict shape `{verdict, findings[ severity, question, context]}` you parse); `src/complete.ts` (`performComplete` — the gate→done-move→integrate flow and `routeToNeedsAttention`); `src/do.ts` (`performDo` — outcome mapping + `surfaceArbiter`); `src/repo-config.ts` + `src/config.ts` (the per-repo precedence to mirror); `src/harness.ts` (`LaunchInput`, `substituteModel`); `src/verify.ts` (`runVerify`/`VerifyConfig`); ADR `execution-substrate-decisions.md` §8 (the determinism boundary — review is a JUDGEMENT gate on top of the model-free `verify` floor, never a replacement) and §13 (the staged `review` role + model override).
>
> TDD with vitest, house style (local `--bare` arbiter, temp dirs, stubbed harness/review-agent, `isolatePiAgentDir` to scratch): a stubbed `approve` integrates (and merges only with `autoMerge` on); a stubbed `block` routes to needs-attention and never merges; `verify` still runs first and is never skipped; the four config keys resolve via the precedence chain; `reviewMaxRounds` exhaustion errors out to needs-attention; the real `~/.dorfl/` + `~/.pi/agent/sessions/` are untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim review-gate-pr --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-gate-pr <remote>/main
git mv work/in-progress/review-gate-pr.md work/done/review-gate-pr.md
```

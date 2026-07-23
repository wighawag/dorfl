---
title: 'intake <N> tracer bullet — issue seam read → decision prompt → dispatch the SLICE outcome through performIntegration (a runnable local one-shot)'
slug: intake-tracer-slice-outcome
spec: issue-intake
blockedBy: []
covers: [1, 6, 8, 11]
---

## What to build

The KEYSTONE vertical slice for `issue-intake`: a new **`intake <N>`** command that reads a GitHub issue + its thread, runs the decision as a prompt→verdict, and — for the **SLICE outcome only** — dispatches that verdict deterministically into a `work/backlog/<slug>.md` integrated through `performIntegration`. This is the tracer bullet: it must reach a **runnable local one-shot** that turns a real, clear, small issue into a proposed slice PR.

End-to-end behaviour after this slice:

- `intake <N>` is its OWN command (NOT a `do` namespace) and is **GATE-FREE**: the explicit invocation IS the authorization (exactly as `do <slice>`/`do prd:<slug>` explicit is not gated by `autoSlice`/`autoBuild`; slice `explicit-do-prd-not-gated-by-autoslice`). `autoSlice`/`autoBuild` config does NOT apply to `intake`.
- It reads the issue + comment thread via a NEW **issue seam** (`getIssue`, `listComments`, `postIssueComment`) with a GitHub adapter that shells out to `gh`. The CORE never imports `gh` — only the adapter does (same discipline as the harness/integration seams).
- The decision is a **prompt → VERDICT** (`{ask,slice,spec,bounce}` + drafted content), mirroring the review gate (prompt → `approve|block` → dispatch). The decision prompt is an **inline prompt builder** (a function returning the prompt string, like `buildSlicingBrief` in `slicing.ts` and the reviewer prompts in `review-gate.ts`) — NOT a standalone asset/`.md` file (no such convention exists in `packages/dorfl/src`; `prompt.ts` is the unrelated claim-wrapper reader). The **dispatcher is the testable seam**: a STUBBED verdict (a test-injectable canned verdict, exactly as `review-gate.ts`'s `ReviewGate` seam is injected) drives it with no model/network. THIS slice wires the `slice` branch end-to-end; the other three branches are completed in `intake-decision-prompt-and-four-outcome-dispatch`.
- On a stubbed `slice` verdict the dispatcher: derives a **content-derived slug** (never a counter), writes `work/backlog/<slug>.md` (`covers: []`, NO `prd:` — its own source of truth) carrying `Fixes #N`, and integrates it via `performIntegration` (default `--propose`; merge/propose KNOBS land in `intake-per-outcome-integration-modes`).
- The **agent only DRAFTS** — no git, no label ops, no posting. The RUNNER owns every git/seam side-effect (the in-band boundary). The dispatcher (runner) does the write + integrate; the prompt returns a verdict object only.

### postComment rename (do this here, scope-noted)

The existing PR-review `ReviewProvider` (`src/integrator.ts`) already has a `postComment` keyed by the **PR URL**. The issue seam needs a comment method keyed by the **issue number**. These are DISTINCT seams (sibling interfaces) — in GitHub the comment id space is shared, but other providers may not share it. So:

- **Rename** the existing `ReviewProvider.postComment` → **`postPRComment`** (and its input/result types `PostCommentInput`/`PostCommentResult` → `PostPRCommentInput`/`PostPRCommentResult`), updating every call site: the Gate-2 review-comment poster in `integration-core.ts` (~lines 683/746), the `ReviewProvider` interface + impls in `integrator.ts` (the `none` provider) and `github.ts` (the GitHub provider). NO behaviour change to the PR-comment path.
- **Add** `postIssueComment` on the new issue seam, with its OWN distinct input/result types (`PostIssueCommentInput` keyed by the **issue number**, NOT the PR `url` the PR-comment input carries). Do NOT reuse the PR-comment input type — the distinct key (issue number vs PR url) is the whole reason these are sibling seams.

This rename is a mechanical, in-scope sub-task of the tracer (it touches the seam surface this slice introduces). Keep it a clean rename — no behaviour change to the PR-comment path.

## Acceptance criteria

- [ ] `intake <N>` exists as its OWN command (not a `do` namespace) and runs LOCALLY one-shot. It is GATE-FREE: a test asserts it proceeds with `autoSlice`/`autoBuild` OFF (no config, no env).
- [ ] A STUBBED `slice` verdict drives the dispatcher to: write `work/backlog/<slug>.md` (content-derived slug, `covers: []`, no `prd:`) with `Fixes #N`, and integrate via `performIntegration` (default propose → opens a PR / does NOT touch `main`; assert with the throwaway-git integration harness, reusing `complete-integration.test.ts` / `run-integration-core.test.ts` patterns).
- [ ] The issue seam (`getIssue`, `listComments`, `postIssueComment`) is defined as a provider interface; the GitHub adapter is the only place that shells out to `gh`; the core never imports `gh` (the contract `github.ts` already documents). Tests STUB `gh` via the injectable `ghBin` (the `GitHubProvider`'s existing test seam; `DEFAULT_GH_BIN` is exported from `index.ts`) — the same mechanism the PR-provider tests use — so no network, no real GitHub.
- [ ] The agent does NO git and NO seam side-effects (it returns a verdict object only); the runner/dispatcher performs the write + integrate. A test asserts the stubbed-verdict path performs no git from the "agent" boundary.
- [ ] `ReviewProvider.postComment` is renamed to `postPRComment` across all call sites with no behaviour change to the PR-comment path (regression: the Gate-2 review-comment-poster tests still pass); the issue seam's `postIssueComment` is separate.
- [ ] A first-draft decision prompt BUILDER (an inline function returning the prompt string, like `buildSlicingBrief`) exists (thin is fine — the FULL prompt is `intake-decision-prompt-and-four-outcome-dispatch`); its JUDGEMENT is NOT unit-tested (only the dispatch is), exactly as the review prompt's judgement is not tested.
- [ ] Gate axis note (deliberate): this slice carries `humanOnly: false` (omitted) on purpose — its build-nature is mechanical (a stubbed-verdict dispatcher + an inline prompt builder + `gh` confined to the adapter), and `intake` is gate-free. This is a deliberate per-slice decision, NOT an oversight, notwithstanding the SPEC autonomy note's lean toward `humanOnly` for the seam adapter / prompt.
- [ ] Tests mirror the repo's existing style (throwaway git repos, `GIT_CONFIG_GLOBAL` isolation, stubbed harness/seam as the suites do).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — this is the FIRST slice of `issue-intake`; the others depend on it (it introduces the command, the seam, the prompt→verdict→dispatch shape, and the performIntegration wiring the rest extend).

## Prompt

> Build the KEYSTONE of `issue-intake`: a new **`intake <N>`** command (its OWN command, NOT a `do` namespace) that reads a GitHub issue + thread via a new ISSUE SEAM, runs the decision as a prompt→verdict, and dispatches the **SLICE outcome** through `performIntegration`. Goal: a runnable LOCAL one-shot that turns a clear, small issue into a proposed `work/backlog/<slug>.md` PR carrying `Fixes #N` (US #1, #6, #8, #11).
>
> DOMAIN VOCABULARY + PATTERNS TO REUSE (verify paths — launch snapshot):
>
> - The engine shape MIRRORS the review gate: prompt → VERDICT → deterministic DISPATCH. The decision prompt is an INLINE prompt builder (a function returning the prompt string, like `buildSlicingBrief` in `src/slicing.ts` / the reviewer prompts in `src/review-gate.ts`) — NOT an asset/`.md` file (no such convention exists). The dispatcher is the testable seam (a STUBBED, test-injectable verdict drives it, no model/network, exactly as `ReviewGate` is injected in `src/review-gate.ts`); the prompt's JUDGEMENT is not unit-tested (like the review prompt's is not).
> - `performIntegration` (`src/integration-core.ts`) is the shared verify→review→commit→rebase→integrate band — emit the produced slice THROUGH it (default propose), exactly as `slice-output-through-integration` (in `work/done/`) routes the slicer's output. Do NOT reinvent integrate.
> - The slug-namespace verb pattern (`src/slug-namespace.ts`, `src/cli.ts`) is the model for adding the new command. `intake` is GATE-FREE — explicit invocation IS authorization (precedent: `explicit-do-prd-not-gated-by-autoslice`).
> - whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the issue provider/seam + the `gh` adapter discipline. Reuse the SEAM; do NOT reuse its label state-machine or 1-PR-per-issue model.
>
> WHAT TO BUILD (this slice = the SLICE branch only):
>
> 1. The issue SEAM as a provider interface: `getIssue`, `listComments`, `postIssueComment` (read the issue + thread; post a comment). GitHub adapter via `gh`; the CORE never imports `gh` (only the adapter shells out).
> 2. The `intake <N>` command + a decision step returning a VERDICT object (`{ask,slice,spec,bounce}` + drafted content). A thin first-draft PROMPT asset is enough here (the full asset is the next slice).
> 3. The DISPATCHER, but wire only the `slice` branch end-to-end: stubbed `slice` verdict → content-derived slug (never a counter) → write `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) + `Fixes #N` → integrate via `performIntegration`.
> 4. The agent only DRAFTS (returns the verdict); the RUNNER (dispatcher) owns the write + integrate + any seam side-effect. Keep the agent git-free and seam-free (the in-band boundary).
>
> THE postComment RENAME (in scope here): the existing `ReviewProvider.postComment` (`src/integrator.ts`) is keyed by the PR URL. RENAME it to `postPRComment` (+ its input/result types) across all call sites (the Gate-2 poster in `integration-core.ts`, the `github`/`none` providers) with NO behaviour change; add the issue seam's `postIssueComment` separately. Rationale: GitHub shares the comment id space but other providers may not — keep them nominally distinct seams.
>
> SEAM TO TEST AT: the DISPATCHER with a STUBBED verdict (no model/network) + the throwaway-git integration harness (`test/complete-integration.test.ts`, `test/run-integration-core.test.ts`) for the `--propose` PR assertion. STUB the issue seam + `gh` throughout. Assert: gate-free run (autoSlice/autoBuild off); stubbed `slice` → backlog slice + `Fixes #N` + propose-PR + `main` untouched; agent does no git/seam ops; the rename leaves the PR-comment path green.
>
> SCOPE FENCE: build ONLY the `slice` branch of the dispatcher (ask/spec/bounce are `intake-decision-prompt-and-four-outcome-dispatch`). Do NOT build the per-outcome mode KNOBS (`intake-per-outcome-integration-modes`), the processing LOCK (`intake-processing-lock`), event-classification (`intake-event-classification`), or the "SPEC complete?" query (`prd-complete-query`). Do NOT build ANY CI/policy (trigger, author-trust, merge-vs-propose POLICY, install-ci, the close job) — that is the `runner-in-ci` SPEC. Do NOT add an issue-label state-machine (ADR §12) — no labels in this slice at all (the lock is a separate slice).
>
> FIRST run the drift check (launch snapshot): confirm `performIntegration` (`src/integration-core.ts`) is still the shared integrate core; confirm no `intake` command / issue seam already exists in `packages/dorfl/src`; confirm `ReviewProvider.postComment` still exists to be renamed. If any premise drifted, route this slice to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal") rather than building on a stale premise.
>
> "Done" = `intake <N>` runs a local one-shot, a stubbed `slice` verdict emits a `work/backlog/<slug>.md` (`Fixes #N`) through `performIntegration` (propose), the issue seam is stubbed in tests with `gh` confined to the adapter, the `postComment`→`postPRComment` rename is clean, the agent does no git/seam ops, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

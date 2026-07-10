---
title: run and do have SEPARATE gate+integrate pipelines — the review gate (#11/#12) covers do/complete but NOT run
date: 2026-06-06
status: open
---

## The finding (verified against the code)

`run` does NOT reuse the `do`/`complete` integrate path. Checked 2026-06-06:

- `src/run.ts` does **not** import `performDo` or `performComplete`.
- `run` has its **own** copy of the back-half: its own `testGate` (`pnpm -r test`, `run.ts` ~line 113/375), its own `applyNeedsAttentionTransition` calls (~316/391/453), and its own `integrateWithRebase` (~425). It is also currently SEQUENTIAL (a `for…await runOneItem` loop) — `run-daemon-reframe` is the slice that makes it genuinely concurrent.
- `do`/`complete` run the gate + integrate through `performComplete` (`src/complete.ts`), which is where the **review gate** (PR #11/#12) was inserted.

**Consequence:** the review gate (`review`/`autoMerge`/`reviewModel` + the verdict→needs-attention routing) lives in `performComplete` and is therefore inherited by `do` (and CI, which calls `do`) — but **`run` does NOT get it.** The maintainer's assumption that "run reuses the do code path" does NOT hold for the gate/integrate back-half.

## Worked examples of the drift (the fork is ALREADY producing bugs)

Three confirmed instances, each a feature/behaviour that `do` has and `run` lacks because the back-half is forked:

1. **The review gate (PR #11/#12)** — `review`/`autoMerge`/`reviewModel` + the verdict→needs-attention routing live in `performComplete`, so `do` (and CI) gets Gate 2; **`run` does NOT.** (The original instance.)
2. **PR title + body (PR #15, `propose-pr-body`)** — the synthesised single-line title + agent-summary body was threaded `do.ts → performComplete → … → gh`. `run.ts` builds its OWN `Integrator` and calls `integrateWithRebase` WITHOUT `title`/`body`, so **fleet PRs still open with `gh --fill`** (run-on title, empty body — the exact bug the slice existed to kill). Confirmed live: PR #15 itself was opened by the fleet path with no title/body. (Was captured as `work/observations/run-worktree-path-pr-no-title-body.md`; that signal now lives here — the observation can be retired.)
3. **The acceptance gate is a PROTOCOL VIOLATION in `run` (2026-06-07)** — `do`/`complete` run `runVerify(config.verify)`: the per-repo, language-agnostic `verify` gate (ADR §8), falling back to `DEFAULT_VERIFY_COMMAND` only when unset. `run.ts`'s `defaultTestGate` instead **hardcodes `pnpm -r test`** — test-only (no build, no format), and it **ignores `config.verify` entirely**. So a non-Node repo, or any repo with a custom `verify`, is gated WRONG by the fleet (a Rust repo `do`'d gets `cargo …`; the same repo run by the fleet gets `pnpm -r test`). This is not just drift — `run` violates the protocol's per-project gate.

## Why it matters

This is latent DUPLICATION of the gate→needs-attention→integrate logic across `run.ts` and `complete.ts`. Every back-half feature (the three above; future ones) must EITHER be duplicated into `run`, OR `run` should be refactored to share the back-half. Duplication is how the two drift (three confirmed instances and counting).

## RESOLVED DESIGN (2026-06-07 grilling pass) — see the convergence SPEC

Grilled and decided; the design now lives in `work/spec/run-do-integrate-convergence.md`. Summary of the ratified decisions:

- **Head / core / tail decomposition.** Extract the SHARED band — gate (verify) → review gate → done-move → atomic commit → rebase → integrate, INCLUDING the needs-attention routing — into a new `src/integration-core.ts` (`performIntegration`). Both `performComplete` (`do`/`complete`) and `runOneItem` (`run`) become thin HEAD + core-call + TAIL wrappers. They share a CALLEE, never call each other (no coupling of the human command to the fleet daemon).
- **The core owns:** the needs-attention routing (one place, both callers) AND the effective-integration-mode decision (incl. today's `autoMerge`-off `merge`→`propose` downgrade — preserved verbatim). It returns DATA (`{outcome, routedToNeedsAttention, branch, commitMessage, integration?, reason?}`); the tails do only their cosmetic post-step.
- **The tails own (never the core):** `do` = land-on-main / `syncLocalMain` / delete-local-branch / `--no-switch` / propose next-step block. `run` = `updateJobRecord` + `teardown` reap. The only knob distinguishing autonomous from human is `surfaceArbiter` (DATA, not a caller-identity flag).
- **Gate UNIFIED (protocol-conformance fix):** delete `defaultTestGate`/`TestGate`; `run` uses the core's `runVerify(config.verify)` like `do`. Fixes drift #3 above.
- **`autoMerge` concept-collision is FENCED OUT** (see `work/findings/automerge-concept-collision-merge-vs-propose.md`): the core preserves CURRENT behaviour; reconciliation is a separate later effort.
- **Two slices:** (1) extract `integration-core.ts`, `do`/`complete`-only, zero behaviour change; (2) route `runOneItem` through the core + unify the gate (one atomic slice). Sequenced BEFORE `run-daemon-reframe` (concurrency wraps one converged back-half, not a fork).

## Original disposition (superseded by the resolved design above)

- **Decide in the review grilling pass:** the review gate must cover BOTH `do` and `run`. Prefer making `run`'s per-item back-half CALL `performComplete` (one shared integrate path) over copying the review wiring into `run.ts`. That way the gate — and everything after it — is defined once.
- If full convergence is too big for the review slices, the minimum is: the review-gate slice(s) must EXPLICITLY wire the gate into `run`'s per-item path too (not silently only `do`), with a test asserting a `run` item is review-gated.
- A separate **`run`/`do` integrate-path convergence** refactor (route `run`'s per-item completion through `performComplete`) is the clean long-term fix — candidate for its own slice, possibly sequenced with `run-daemon-reframe`.

(Captured 2026-06-06 while checking whether the just-built review gate covers `run`. It does not — `run` has its own integrate pipeline.)

---
title: run-through-integration-core — route runOneItem through performIntegration + unify the gate (delete defaultTestGate/TestGate); fleet gets review gate, PR title/body, and the per-repo verify gate
slug: run-through-integration-core
prd: run-do-integrate-convergence
blockedBy: [extract-integration-core]
covers: [1, 2, 3]
---

## What to build

Route `runOneItem`'s per-item back-half (`src/run.ts`, steps 5–7: gate → done-move

- completion commit → integrate) through the shared `performIntegration` core extracted in `extract-integration-core`. Delete `run`'s forked back-half. This closes ALL THREE documented drift instances at once (see `work/findings/run-and-do-have-separate-integrate-paths.md`): the fleet now gets the review gate, PR title/body, AND the per-repo `verify` gate.

### What changes

- **Add the review wiring to `run` (it has NONE today — VERIFIED 2026-06-07).** `run`/`runOnce`/`OneItemContext` carry NO `reviewGate`/`review`/`autoMerge`/ `reviewModel`, and the CLI `run` command passes none of them (it calls `runOnce({config, workspace, onWarn})` only, and has no `--review` flag). This is the review-gate drift instance itself. So this slice must THREAD the review wiring through `run` end-to-end, mirroring the `do` command:
  - `RunOnceOptions` gains an optional `reviewGate?: ReviewGate` (and `runOnce` forwards it into `OneItemContext`); `OneItemContext` gains `reviewGate?`.
  - the CLI `run` command resolves `review`/`autoMerge`/`reviewModel`/ `reviewMaxRounds` the SAME way the `do` command does (the flag>env>per-repo>global>default chain / `reviewFlagOverrides`), adds the `--review`/`--no-review` (+ siblings) flags, and passes `reviewGate: config.review ? harnessReviewGate() : undefined` into `runOnce`.
  - `review`/`autoMerge`/`reviewModel` come from the per-repo resolved `config` inside `runOneItem` (already on `Config`); only `reviewGate` needs threading.
- **`runOneItem` calls `performIntegration`** with `cwd: tree.dir`, `arbiter: tree.arbiterRemote`, `slug`, `source: 'in-progress'`, `recovering: false`, `surfaceArbiter: tree.arbiterRemote` (run is ALWAYS autonomous), the resolved per-repo `verify`/`review`/`autoMerge`/`reviewModel` (from `config`) + the threaded `reviewGate` (from `ctx`), the selected `provider`, `mode: config.integration`, and the synthesised `title`/`body`.
- **Delete `run`'s forked steps 5–7:** the `ctx.testGate` call, the `gitMv` done-move, `commitCompletion`, and the `new Integrator` + `integrateWithRebase` block — all now done by the core.
- **The TAIL stays in `run.ts`:** map `IntegrationCoreResult.outcome` → `updateJobRecord` + `ItemStatus` (`completed`→`claimed-done`; `gate-failed`→`tests-failed`; `review-blocked`/`rebase-conflict`→`needs-attention`, recording `reason`), set `prUrl` from `integration?.url`; the `teardown()` reap in `finally` is unchanged. `run` NEVER does switch/ff/delete-branch (that is `do`'s tail; a job worktree is reaped, not switched).
- **Handle a THROWN error from the core (from PR #17 review, finding #2):** `performIntegration` THROWS a plain `Error` for a misconfigured gate (`review` on but no `reviewGate` wired) — `complete.ts` catches it via its `performComplete` catch-all and maps it to a usage failure. `run`'s tail has NO such catch-all today, so `runOneItem` must wrap the `performIntegration` call so a thrown core error becomes a saved/needs-attention `ItemResult` (reuse `saveAgentFailure` / the needs-attention seam), NOT an uncaught crash that takes down the whole tick. Since `run` always passes a real `reviewGate` when `config.review` is on, this is a defensive guard, but it must not be left to crash.
- **Gate UNIFICATION (option a — protocol-conformance fix):** DELETE `defaultTestGate` and the `TestGate` type. `run` now gates via the core's `runVerify(config.verify)` — the per-repo, language-agnostic gate it currently ignores. (Today `defaultTestGate` hardcodes `pnpm -r test`: test-only and Node-only — a protocol violation. This deletes it.)
- **Surface `run`'s agent output:** `run.ts`'s `runAgent` currently DROPS `launched.output`; surface it (mirror `do.ts`'s `runDoAgent`) so the synthesised PR `body` (the agent's final summary) is non-empty on the fleet path too.

### Decisions (from the PRD — do not relitigate)

- This is partly a deliberate BEHAVIOUR CHANGE to `run`, stated as intended: `run` gains the review gate, PR title/body, and the full configured `verify` floor (build + test + format, or the repo's command) instead of test-only `pnpm`. State it with an ADR note.
- The `autoMerge` concept-collision stays FENCED OUT — the core carries current behaviour; do NOT touch it (`work/findings/automerge-concept-collision-merge-vs-propose.md`).
- The head-half `run` already owns is UNCHANGED: claim, `jobWorktreeStrategy`, `continueRebaseConflict`, `runAgent`, `saveAgentFailure` (already shared via the `applyNeedsAttentionTransition` seam).

### Scope fence

- IN: `runOneItem` steps 5–7 → one `performIntegration` call; add the review wiring to `run` (`RunOnceOptions`/`OneItemContext`/CLI flags + gate) since it has none today; delete `defaultTestGate`/`TestGate`; surface `runAgent`'s `output`; map core result → job record + `ItemStatus`; re-point the gate stubs in `run`'s tests.
- OUT: `run`'s head-half (claim/isolate/agent/failure-save); `run-daemon-reframe` (concurrency — sequenced AFTER this); any `do`/`complete` change (Slice 1 already did the extraction); the `autoMerge` reconciliation.

## Acceptance criteria

- [ ] `runOneItem` integrates via `performIntegration` (one call); `run`'s forked `testGate`/`gitMv`/`commitCompletion`/`integrateWithRebase` back-half is gone.
- [ ] **Review wiring threaded through `run`:** `RunOnceOptions` + `OneItemContext` carry `reviewGate?`; the CLI `run` command resolves `review`/`autoMerge`/ `reviewModel`/`reviewMaxRounds` (flag>env>per-repo>global>default, like `do`), adds the `--review`/`--no-review` (+ sibling) flags, and passes `reviewGate: config.review ? harnessReviewGate() : undefined` into `runOnce`.
- [ ] **Review-gated:** with `review` on and a stubbed `block` verdict (injected `reviewGate`), a `run` item routes to needs-attention and is NOT integrated (mirrors `do`'s review test).
- [ ] **PR title + body:** a `run` propose PR passes a synthesised single-line `--title` and a `--body` (from the agent's surfaced `output`) — a stubbed provider records the `gh` args; no `--fill` when title/body present.
- [ ] **Per-repo, language-agnostic gate:** a repo whose `.dorfl.json` sets a CUSTOM `verify` has THAT command run by `run` (NOT `pnpm -r test`); and a format-only failure (build+test green, format red) routes a `run` item to needs-attention (proving the full floor, not test-only).
- [ ] `defaultTestGate` and the `TestGate` type are deleted; `run`'s tests inject the gate via `verify: 'exit 0'` / `verify: 'exit 1'` (the same string-command stubs `do`'s tests use), assertions otherwise unchanged.
- [ ] The TAIL mapping is correct: `completed`→`claimed-done` (+prUrl); `gate-failed`→`tests-failed`; `review-blocked`/`rebase-conflict`→ `needs-attention` (with the reason); `teardown` reap unchanged.
- [ ] A THROWN core error (e.g. `review` on with no `reviewGate` — `performIntegration` throws a plain `Error`, unlike the data outcomes) is caught in `runOneItem` and turned into a saved/needs-attention `ItemResult`, NOT an uncaught crash of the tick (a test injects the misconfiguration / a throwing gate and asserts the item is routed, the worktree handled, and the run continues).
- [ ] **Test isolation:** all writes go to temp work trees / scratch arbiters; the real `~/.dorfl/` + `~/.pi/agent/sessions/` are UNTOUCHED.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `extract-integration-core` — `performIntegration` must exist first (and this slice edits the same modules, so it serialises behind Slice 1 regardless).

## Prompt

> Route `runOneItem` (`src/run.ts`, steps 5–7) through the `performIntegration` core that `extract-integration-core` added (`src/integration-core.ts`), deleting `run`'s forked back-half. This closes all three drift instances at once (`work/findings/run-and-do-have-separate-integrate-paths.md`): the fleet gains the review gate, PR title/body, and the per-repo `verify` gate. See `work/prd/run-do-integrate-convergence.md`.
>
> FIRST run the drift check: confirm `extract-integration-core` landed `performIntegration` with the contract the PRD names, and that `runOneItem` still has the forked steps 5–7 (the `ctx.testGate` call, `gitMv` done-move, `commitCompletion`, `new Integrator`+`integrateWithRebase`) and the `runAgent` that drops `launched.output`. If Slice 1 landed differently, route to needs-attention rather than build on a stale premise.
>
> Implement: call `performIntegration({cwd: tree.dir, arbiter: tree.arbiterRemote, slug, source: 'in-progress', recovering: false, surfaceArbiter: tree.arbiterRemote, verify: config.verify, review: config.review, autoMerge: config.autoMerge, reviewModel: config.reviewModel, reviewGate: <prod gate>, mode: config.integration, provider, title, body})`. Delete steps 5–7's forked code. Keep the TAIL in `run.ts`: map `IntegrationCoreResult.outcome` → `updateJobRecord`
>
> - `ItemStatus` (completed→claimed-done+prUrl; gate-failed→tests-failed; review-blocked/rebase-conflict→needs-attention with the reason); `teardown` reap unchanged; `run` NEVER switches/deletes branches. ADD the review wiring to `run` (it has NONE today): `reviewGate?` on `RunOnceOptions` + `OneItemContext`, the `--review`(+siblings) flags + resolution on the CLI `run` command (mirror the `do` command / `reviewFlagOverrides`), and `reviewGate: config.review ? harnessReviewGate() : undefined` passed into `runOnce`. DELETE `defaultTestGate` + the `TestGate` type (gate unified on `runVerify(config.verify)` — a protocol- conformance fix; state it with an ADR note). Surface `runAgent`'s `launched.output` (mirror `do.ts`'s `runDoAgent`) so the PR body is non-empty. Do NOT touch `autoMerge` behaviour (fenced out: `work/findings/automerge-concept-collision-merge-vs-propose.md`) or `run`'s head-half.
>
> READ FIRST: `src/run.ts` (`runOneItem` steps 5–7, `runAgent`, `ItemStatus`, `RunOnceOptions`/`OneItemContext` — NOTE they have NO review wiring today — `defaultTestGate`/`TestGate`, the `updateJobRecord`/`teardown` tail); `src/cli.ts` (the `run` command's `runOnce({config, workspace, onWarn})` call + the `do` command's review-flag resolution / `reviewFlagOverrides` / `harnessReviewGate()` to mirror); `src/integration-core.ts` (`performIntegration` from Slice 1); `src/do.ts` (`runDoAgent` — the output-surfacing + `performComplete` call to mirror); `src/complete.ts` (how `do` passes `surfaceArbiter`/`review`/`body`); the PRD + the two findings.
>
> TDD with vitest, house style (temp work trees, scratch arbiters, `isolatePiAgentDir`, stubbed provider + review agent): the four acceptance proofs (review-gated; title+body; custom `verify` honoured; format-only failure routes), the gate-stub re-pointing, real `~/.dorfl` + sessions untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim run-through-integration-core --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/run-through-integration-core <remote>/main
git mv work/in-progress/run-through-integration-core.md work/done/run-through-integration-core.md
```

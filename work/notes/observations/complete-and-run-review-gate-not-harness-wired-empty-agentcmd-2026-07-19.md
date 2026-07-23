---
title: '`complete --review` (and `run`) wire `harnessReviewGate()` with NO harness/agentCmd → Gate 2 throws "empty agentCmd" even when `harness: pi` is configured'
type: observation
status: spotted
spotted: 2026-07-19
needsAnswers: true
---

## What was seen

Driving the `wezig` repo's `explore-native-renderer` task pool with
`dorfl do <slug> --arbiter origin --merge --review`, one task bounced at Gate 2
(a legitimate code-review block). After fixing the flagged issue on the pushed
`work/<slug>` branch, re-integrating with:

```
dorfl complete <slug> --arbiter origin --merge --review --review-max-rounds 2
```

ran the acceptance gate GREEN, committed the done-move, then on
"Running the PR/code review gate (Gate 2)…" errored with:

```
error: no command to run: the null/shell adapter was launched with an empty
agentCmd — nothing would run. Set `agentCmd` (--agent-cmd, per-repo, or global
config) or configure `harness: pi`.
```

But `dorfl config --json` for that repo shows `harness: pi` IS resolved (with
`agentCmd: ""`, which is normal for the pi harness — the pi harness does not need
`agentCmd`; it is the NULL/shell adapter that does). Crucially, the ORIGINAL
`dorfl do … --review` on the SAME repo/config ran Gate 2 fine. So this is
NOT a misconfiguration — it is a wiring asymmetry between `do` and `complete`
(`run` looks identically affected).

Workaround used: since the reviewer's exact objection was verifiably resolved,
finished with `--no-review`. But that defeats the point of re-review after a
Gate-2 bounce fix.

## Root cause (located)

The review gate is constructed in three places in `packages/dorfl/src/cli.ts`,
and only the `do` command threads the resolved harness into it:

- **`do` command — CORRECT.** `harnessReviewGate({harness, agentCmd: config.agentCmd})`
  at `packages/dorfl/src/cli.ts:424` (and again at `:2783` for the `--remote`
  variant). The `do` action resolves `const harness = createHarness({harness:
  config.harness, piBin: config.piBin})` (`cli.ts:350`) and PASSES it, so the
  pi-backed gate is used.

- **`complete` command — BUG.** `reviewGate: config.review ? harnessReviewGate() : undefined`
  at `packages/dorfl/src/cli.ts:2191` — called with NO arguments. With no
  `harness`/`agentCmd`, `harnessReviewGate()` defaults to the NullHarness + an
  empty `agentCmd`, so when Gate 2 launches it hits the "empty agentCmd — nothing
  would run" guard and throws — even though `harness: pi` is configured. The
  `complete` action scope does not resolve/thread a `harness` at all
  (no `createHarness(...)` in the `complete` block ~`cli.ts:1996`–`2210`).

- **`run` command — SAME BUG shape.** `const reviewGate = config.review ?
  harnessReviewGate() : undefined` at `packages/dorfl/src/cli.ts:1545`, also
  arg-less. (The comment there even says "mirror the `do`/`complete` commands" —
  but it mirrors the BROKEN `complete`, not the correct `do`.) A `run` daemon
  with `review` on and `harness: pi` would fail Gate 2 identically; worth a
  confirming test.

So the fix is to thread the same `{harness, agentCmd}` the `do` path uses into
the `complete` (and `run`) review-gate construction, resolving `harness` via
`createHarness({harness: config.harness, piBin: config.piBin})` in each action's
scope exactly as `do` does.

## Why it matters

`complete --review` is the DESIGNATED path to re-integrate a stranded/bounced
`work/<slug>` branch after fixing a Gate-2 block (the tool literally prints
"To FINISH the stranded branch … run `dorfl complete …`"). If that path cannot
run Gate 2 under the very harness the repo configured, then a Gate-2 bounce
fixed on-branch can NEVER be re-reviewed through the tool — the operator is
forced to `--no-review` (skipping the gate) or to re-drive the whole task from
scratch via `do`. That silently erodes the two-gate guarantee exactly at the
moment (post-bounce) it matters most.

## Suggested fix shape (NOT decided here)

1. In the `complete` action, resolve `const harness = createHarness({harness:
   config.harness, piBin: config.piBin})` (as `do` does at `cli.ts:350`) and pass
   `harnessReviewGate({harness, agentCmd: config.agentCmd})` at `cli.ts:2191`
   (and any `--remote`/isolated complete variant, mirroring `do`'s `:2783`).
2. Do the same at the `run` construction (`cli.ts:1545`) — resolve + thread the
   harness so a `run --review` daemon uses the pi gate.
3. Add a regression test: a `complete --review` (and a `run`-tick review) under
   `harness: pi` must construct a harness-backed review gate, NOT a NullHarness
   with empty agentCmd. Mirror the existing `harness.test.ts` empty-agentCmd
   guard and `cli-apply-decider-wiring.test.ts` (which already asserts the
   unwired default THROWS — the same class of defect, so a wiring test is the
   right shape).

## Provenance / refs

- `packages/dorfl/src/cli.ts:350` (`createHarness` in `do`), `:424` + `:2783`
  (`do` threads `{harness, agentCmd}` into `harnessReviewGate` — the CORRECT
  wiring).
- `packages/dorfl/src/cli.ts:2191` (`complete`'s arg-less `harnessReviewGate()`
  — the BUG); `:1545` (`run`'s arg-less `harnessReviewGate()` — same shape).
- `packages/dorfl/src/review-gate.ts` (`harnessReviewGate` default harness =
  NullHarness + empty agentCmd).
- `packages/dorfl/test/harness.test.ts:80` (the empty-agentCmd guard that throws);
  `packages/dorfl/test/cli-apply-decider-wiring.test.ts` (the analogous
  NullHarness-unwired-THROWS wiring test).
- Observed against dorfl 0.5.0 driving `github.com:wighawag/wezig` (task
  `spike-harfbuzz-shaping`, 2026-07-19).

## Note on scope

Wiring/correctness bug in the `complete` (and likely `run`) review-gate
construction, not a config error — the repo's `harness: pi` is correct and the
`do` path proves the gate works. Small, well-scoped, and independently
acceptance-able (thread the harness; add a wiring regression test).

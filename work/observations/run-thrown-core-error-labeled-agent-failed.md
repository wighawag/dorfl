---
title: run labels a THROWN core error (e.g. Gate-2 wiring misconfig) as ItemStatus 'agent-failed' — imprecise; a wiring/config error reads as if the agent misbehaved
date: 2026-06-07
status: open
---

## The signal

Spotted in the PR #18 (`run-through-integration-core`) review. After the run/do
convergence, `runOneItem` wraps the `performIntegration` call in a `try/catch` so a
THROWN core error does not crash the whole tick (the finding-#2 guard folded in from
PR #17's review). The catch routes the item through `saveAgentFailure` — which yields
`ItemStatus: 'agent-failed'`.

But `performIntegration` THROWS (rather than returning a data outcome) for a
MISCONFIGURATION — specifically `review` on with NO `reviewGate` wired — not for an
agent misbehaving. So a Gate-2 WIRING/config bug is surfaced to the operator as
`agent-failed`, implying the agent is at fault when it is not.

## Why it is OK as-is (not a delivered-behaviour defect)

- Work is PRESERVED and the tick CONTINUES (the guard does its job — reuses the
  work-preserving needs-attention seam).
- Production always wires a real `reviewGate` when `config.review` is on (`run`'s CLI
  passes `harnessReviewGate()`), so this is a DEFENSIVE guard — the misconfig path is
  not expected in normal operation.
- The acceptance criterion for the guard only required "a saved/needs-attention
  ItemResult, not a crash," which is satisfied; the test asserts exactly
  `status === 'agent-failed'`, so the label is intentional + tested.

Hence the PR #18 review rated this **non-blocking**.

## The question to think through later (batch-qa fodder)

Should a thrown wiring/config error from the core carry a DISTINCT status/reason
(e.g. `usage-error` / `config-error`) rather than `agent-failed`, so an operator
triaging a stuck fleet item is not misled into blaming the agent? Two angles:

- It mirrors how `complete.ts` maps the SAME thrown error to `outcome: 'usage-error'`
  (its catch-all) — so `run` and `do` currently CLASSIFY the identical error
  differently (`do`: usage-error; `run`: agent-failed). That cross-path divergence is
  itself a small drift worth noting (the convergence was meant to reduce such
  divergence).
- Counter: a distinct status adds surface for a path that "can't happen" in
  production; maybe a clearer REASON string on the existing status is enough.

## Where

`src/run.ts` `runOneItem`'s `catch` around `performIntegration` → `saveAgentFailure`
(`ItemStatus: 'agent-failed'`); compare `src/complete.ts`'s `performComplete`
catch-all (`outcome: 'usage-error'`). Decide in a later pass (no fix now).

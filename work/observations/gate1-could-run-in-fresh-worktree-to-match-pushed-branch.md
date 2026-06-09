---
title: Gate-1 (do's acceptance gate) runs on the agent's working checkout, not the pushed PR branch — a fresh-worktree gate would close the rare checkout-≠-pushed divergence and remove the need for any Gate-3 re-verify
date: 2026-06-08
kind: observation
area: packages/agent-runner/src (do.ts / complete.ts / integration-core.ts — the gate step)
severity: low
status: open
---

## What prompted this

While reviewing the `drive-backlog` skill we removed its "Gate-3" step of re-running `agent-runner verify` on a throwaway checkout of `origin/work/<slug>`. That re-run existed to catch ONE rare risk: **`do` runs its acceptance gate (\"Gate-1\") on the AGENT'S working checkout, but what actually merges is the PUSHED `work/<slug>` branch** — and the two can differ (an integration rebase onto the latest main, an uncommitted/gitignored file the gate relied on, or any state that is in the checkout but not in the pushed tree). The Gate-3 re-verify was belt-and-suspenders for that gap, but it is EXPENSIVE (a full test suite per slice) and largely duplicates the gate `do --review` already ran.

We dropped the re-verify (trust Gate-1 + Gate-2). This note records the better, root-cause fix so the rare divergence is still closed WITHOUT a per-slice double gate.

## The idea (do NOT build now — just captured)

Make **Gate-1 itself run against the artifact that will actually land**, by running the acceptance gate in a **fresh worktree checked out from the (to-be-)pushed `work/<slug>` tip** (the same tree the arbiter will integrate), rather than in the agent's live working checkout. Then the green gate provably describes the merged artifact, and no separate downstream re-verify is ever needed.

Sketch (for whoever slices this):

- After the agent's edits are committed to `work/<slug>` and rebased onto the latest `<arbiter>/main` (the integration tip), run `verify` in a clean worktree cut from THAT commit — not the live checkout — so gitignored/uncommitted state cannot leak into a falsely-green gate, and the rebased tree is what is tested.
- This subsumes the dropped Gate-3 re-verify: one gate, run on the right tree.
- Cost note: it adds a worktree + (possibly) a dependency install per gate; weigh against the per-slice cost. May be opt-in (a config) if the install cost is high.
- Interaction: `do --remote` / `run` already build in job worktrees off the mirror, so they may ALREADY be close to this property — check whether only the IN-PLACE `do` gate runs against the live checkout, and scope the fix to that path.

## Why low severity

The divergence it guards against is rare (it needs a checkout-vs-pushed-tree difference AND a gate outcome that flips because of it). Gate-1 + Gate-2 on the agent's checkout catch essentially everything today. This is a robustness improvement + a simplification (it lets the conductor skills trust one gate), not a live bug. Captured rather than built so it can be sliced deliberately (and checked against the `advance-loop` / isolation-seam work, which already deals in worktrees).

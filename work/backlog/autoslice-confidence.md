---
title: autoslice-confidence — no-human confidence check → needsAnswers / needs-attention routing
slug: autoslice-confidence
prd: auto-slice
blockedBy: [autoslice-command]
covers: [3]
---

## What to build

The safety behaviour when slicing with NO human present (an agent auto-slicing):
the slicer must never emit a guessed, wrongly-cut slice. This slice adds the
confidence check + the two honest fallbacks on top of the `agent-runner slice`
command (autoslice-command).

When auto-slicing, if ANY of {granularity, dependency order, a gate, a seam} is
genuinely unresolved by the PRD/ADRs, the slicer does NOT guess. Instead it does
exactly one of:

- **(a) flag the specific uncertain slice** — emit it with `needsAnswers: true`
  and the open questions in its body (so it is created but not agent-buildable
  until a human answers); OR
- **(b) route the whole PRD to `needs-attention/`** — when the *decomposition
  itself* is unclear (not just one slice), move the PRD to
  `work/needs-attention/<slug>.md` with the questions as the reason, rather than
  emitting any slices.

This is the slicing-time application of the WORK-CONTRACT "drift / unresolved =
needs-attention" discipline, and it routes through the **same needs-attention
mechanism** the rest of the system uses (the ledger-transition write seam's
needs-attention transition) — so a stuck PRD is surfaced (incl. on `main` via the
landed surfacing) for the human, never silently mis-sliced.

The confidence judgement is the AGENT's (it runs the slicer methodology); this
slice wires the *routing* of a low-confidence verdict, not a heuristic that second-
guesses the model.

## Acceptance criteria

- [ ] On a low-confidence single slice, the slicer emits it with
      `needsAnswers: true` + the questions in its body (created, not
      agent-buildable until answered).
- [ ] On a low-confidence whole decomposition, the slicer routes the PRD to
      `work/needs-attention/` with the questions as the reason (and emits NO
      guessed slices), via the shared needs-attention seam transition.
- [ ] The human path is unaffected (a human resolves ambiguity in conversation; no
      auto-routing is forced on them).
- [ ] Tests (stubbed harness verdict): a "low-confidence slice" verdict produces a
      `needsAnswers` slice; a "low-confidence decomposition" verdict routes the PRD
      to needs-attention and emits no slices; a confident verdict slices normally.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `autoslice-command` — this extends the command's slicing path with the
  confidence routing; same code path/files, so serialized after it.

## Prompt

> Add the no-human CONFIDENCE behaviour to `agent-runner slice` (built on
> autoslice-command — read its done file + module first). PURE addition to the
> slicing path: when no human is present, never emit a guessed slice.
>
> READ FIRST: `work/prd/auto-slice.md` (the confidence behaviour), the
> autoslice-command module, `src/needs-attention.ts` + the done file for
> `ledger-write-seam-needs-attention` (route through the seam's needs-attention
> transition — and `needs-attention-surface-on-main` gives you on-main surfacing
> for free), and WORK-CONTRACT.md "Drift is a needs-attention signal" (this is the
> slicing-time application of the same discipline).
>
> Implement two fallbacks on a low-confidence verdict: (a) emit the specific
> uncertain slice with `needsAnswers: true` + questions in its body; or (b) when
> the whole decomposition is unclear, route the PRD to `work/needs-attention/` with
> the questions as the reason via the shared seam transition, emitting NO slices.
> The confidence judgement is the agent's; you wire the ROUTING of its verdict, not
> a heuristic that overrides it. The human path is unaffected.
>
> TDD with vitest, stubbing the harness verdict: low-confidence-slice ⇒ needsAnswers
> slice; low-confidence-decomposition ⇒ PRD routed to needs-attention, no slices;
> confident ⇒ normal slicing. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim autoslice-confidence --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/autoslice-confidence <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/autoslice-confidence.md work/done/autoslice-confidence.md
```

---
title: scan human dashboard — group items by who-can-take-it
slug: scan-human-dashboard
prd: agent-runner
blockedBy: [scan]
covers: [1, 4, 9]
---

## What to build

Enhance the `scan` output so it works as a **human decision dashboard**, not just
a runner-eligibility check. Today `scan` prints a single eligible/not bit; this
slice groups every backlog item by **who can take it and why**, so a human can
glance at the cross-repo queue and choose what to work on — including the
human-only items an autonomous runner will never claim.

End-to-end (read-only, building on the existing `scan` core — no new claiming or
execution):

- **Categorise** each backlog item from its `afk` gate + `blocked_by` status into
  one of three groups:
  - **Runner-eligible now** — `afk: true` AND deps satisfied (an autonomous
    runner can claim it now).
  - **Claimable if allowed** — gate *unspecified* (no `afk`) AND deps satisfied:
    a runner would claim it only under `allowUnspecifiedGate` / the
    `--allow-unspecified-gate` flag.
  - **Human-only** — `afk: false`: a human decides/builds it; a runner never
    claims it.
- **Display grouped sections** (one block per group, under each repo), each
  group clearly labelled. Empty groups still render with `(none)` so the picture
  is complete.
- **Show readiness per item**: whether its `blocked_by` deps are satisfied, and
  if not, what it's waiting on. Within a group, **sort by readiness first**
  (ready/deps-satisfied items above blocked ones) so the actionable items float
  to the top.
- **Flag-independent display**: `scan` ALWAYS shows all three groups regardless
  of `--allow-unspecified-gate`. The flag only affects the runner-eligibility
  *verdict* (i.e. whether "claimable if allowed" items count as eligible in the
  summary), never which categories are shown — a human always sees the full
  picture and the consequence of the flag without re-running.
- **Summary line**: report totals per category and readiness, e.g.
  `N items across R repos — X runner-eligible, Y if-allowed, Z human-only
  (P ready, Q blocked)`.

## Acceptance criteria

- [ ] Output groups items into: Runner-eligible now / Claimable if allowed
      (unspecified gate) / Human-only, under each repo. Empty groups show `(none)`.
- [ ] `afk: false` items appear under Human-only (never runner-eligible),
      regardless of `--allow-unspecified-gate`.
- [ ] Items with an unspecified gate appear under "Claimable if allowed", and the
      label/notes make clear they need `--allow-unspecified-gate` to be claimed.
- [ ] Each item shows its readiness (deps satisfied, or what it's waiting on).
- [ ] Within each group, ready (deps-satisfied) items sort above blocked ones.
- [ ] The set of groups shown does NOT change with `--allow-unspecified-gate`;
      only the eligibility verdict / summary counts do.
- [ ] Summary reports per-category totals plus ready/blocked counts.
- [ ] The categorisation logic is unit-tested (vitest) against fixture trees
      covering every afk×deps combination; output formatting is tested too.

## Blocked by

- `scan` — extends the scan command's detection/eligibility/output core.

## Prompt

> Enhance `agent-runner scan` (in `packages/agent-runner/`) so its output is a
> human decision dashboard. Read the source PRD (`work/prd/agent-runner.md`) and
> the existing `scan` implementation + tests first; reuse its config/detection/
> eligibility/frontmatter core — this is a presentation + categorisation change,
> read-only, no claiming or execution.
>
> Group every `work/backlog/` item by who-can-take-it, derived from the `afk`
> gate and `blocked_by` status (deps resolved against the SAME repo's
> `work/done/`):
>   - **Runner-eligible now**: `afk: true` AND deps satisfied.
>   - **Claimable if allowed**: gate unspecified (no `afk`) AND deps satisfied —
>     would be claimed only under `allowUnspecifiedGate`.
>   - **Human-only**: `afk: false` — a runner never claims it; a human does.
> Render one labelled section per group under each repo; empty groups show
> `(none)`. Show each item's readiness (deps satisfied, or what it waits on), and
> within a group sort ready items above blocked ones. The displayed groups must
> be **independent of `--allow-unspecified-gate`** — the flag only changes the
> eligibility verdict / summary counts, never which categories are shown. End
> with a summary: per-category totals plus ready/blocked counts.
>
> Target output shape (illustrative):
>
>     agent-runner  (/path/to/repo)
>
>       Runner-eligible now (autonomous can claim):
>         (none)
>       Claimable if allowed (unspecified gate; needs --allow-unspecified-gate):
>         (none)
>       Human-only (afk:false — a human decides/builds):
>         * run-once   deps: satisfied (scan)
>         o watch      deps: waiting on run-once
>
>     Summary: 2 items across 1 repo — 0 runner-eligible, 0 if-allowed,
>              2 human-only (1 ready, 1 blocked).
>
> TDD with vitest (in `test/`): unit-test the categorisation against fixture
> trees covering every afk×deps combination, and test the formatted output.
> Match the house style (NodeNext, tabs + single quotes, `type: module`).
> "Done" = the acceptance criteria are met and `pnpm -r build && pnpm -r test &&
> pnpm -r format:check` are green.

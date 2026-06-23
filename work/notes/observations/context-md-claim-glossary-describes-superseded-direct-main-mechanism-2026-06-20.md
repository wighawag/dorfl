---
title: CONTEXT.md's `claim (CAS)` glossary entry still describes the SUPERSEDED backlog→in-progress direct-`main` claim mechanism, not the per-item lock ref
type: observation
status: spotted
spotted: 2026-06-20
slug: context-md-claim-glossary-describes-superseded-direct-main-mechanism
needsAnswers: true
---

## What was seen

Noticed 2026-06-20 while retiring `skills/to-task/scripts/claim.sh` (triaging the
observation `claim-sh-still-describes-superseded-direct-main-claim`). The
`claim.sh`-specific clauses were removed from `CONTEXT.md`, but the surrounding
`claim (CAS)` glossary entry (CONTEXT.md ~L40) STILL describes the OLD claim
mechanism that the per-item-lock migration superseded:

> **claim (CAS)** — atomically moving an item `backlog → in-progress` by pushing a
> micro-commit to the arbiter's `main` with `--force-with-lease`; ... This
> direct-`main` write is the **current (only) strategy behind the ledger-transition
> seam**.

## Why it is stale (verified against current `main`)

The per-item-lock-refs migration LANDED (tasks `claim-acquires-unified-lock-no-body-move`,
`cutover-retire-slicing-advancing-markers-and-trim-folder-sets` in `work/tasks/done/`;
ADR `ledger-status-on-per-item-lock-refs`). Current reality:

- A claim ACQUIRES the item's per-item lock `refs/agent-runner/lock/<entry>`
  (`action: implement`) and writes NOTHING to `main` — the body STAYS in
  `work/tasks/todo/` (`claim-cas.ts`: "the body STAYS at `work/backlog/<slug>.md`,
  the claimable predicate is 'in `backlog/` on `main` AND no lock held'").
- There is NO `backlog → in-progress` move on claim, and NO `in-progress/` folder.
- The claim no longer writes `main` at all (a protected-`main` repo is claimable
  precisely because claim touches no protected ref).

So the glossary's "moving an item backlog → in-progress by pushing a micro-commit to
`main`" and "direct-`main` write is the current strategy" are BOTH describing the
retired mechanism.

## Scope note

This is a SEPARATE, broader drift than the `claim.sh` retirement (which was a dead
script). It is a load-bearing GLOSSARY entry in CONTEXT.md, so a careful rewrite to
the per-item-lock reality is warranted rather than a surgical clause-removal. Likely
also touches the sibling references to the ledger-transition seam framing if that
framing changed under the migration.

## Refs

- `CONTEXT.md` ~L40 — the `claim (CAS)` glossary entry.
- `packages/agent-runner/src/claim-cas.ts` — the current per-item-lock claim (body
  stays in `todo/`, no `main` write).
- `docs/adr/ledger-status-on-per-item-lock-refs.md` — the decision.
- Sibling already-discharged note: `claim-sh-still-describes-superseded-direct-main-claim`
  (the `claim.sh` script half; retired 2026-06-20).

## Applied answers 2026-06-22

### q1: Is this observation actionable as a slice (rewrite CONTEXT.md's `claim (CAS)` glossary entry — and any sibling 'ledger-transition seam' framing it implies — to match the per-item-lock-refs reality), or should it be folded into a broader CONTEXT.md docs-drift sweep, or dropped?

DROP — overtaken by events. The load-bearing premise is no longer true: CONTEXT.md's `claim (CAS)` glossary entry already describes the per-item-lock-ref model ("acquiring an item's per-item lock ... the claim writes NOTHING to `main`"), and the status/needs-attention entries already state the transient states are "NO LONGER folders". No "direct-`main` micro-commit" or "ledger-transition seam" text remains to rewrite. Disposition: dropped.

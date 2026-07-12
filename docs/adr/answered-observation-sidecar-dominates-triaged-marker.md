---
title: An answered observation sidecar routes to APPLY even when the observation body carries a `triaged:` settled marker (answer never stranded)
status: accepted
created: 2026-07-10
decided: 2026-07-10
supersedes:
superseded_by:
---

# ADR: an ANSWERED sidecar wins over a `triaged:` marker — a human's answer must never be stranded

> Ratifies a decision recorded in-line in the source task
> `route-answered-observation-sidecar-to-apply-pool` (now in
> `work/tasks/done/`). Gate 2 approved the source change with three
> non-blocking review nits; this ADR is one of them (the source task's file has
> no `## Decisions` block and is done, so the decision is recorded HERE).

## Context

`buildLifecyclePools` (`packages/dorfl/src/lifecycle-pools.ts`) routes each
observation into one of two sub-pools:

- `triage` (CREATE — gated by `observationTriage`, born OFF): an UNTRIAGED
  observation whose body carries no `triaged:` settled marker.
- `apply` (CONSUME — ALWAYS on, ungated, ADR
  `ci-config-policy-and-gate-family.md` §4): an observation whose active
  question sidecar (`work/questions/observation-<slug>.md`) is fully answered.

An observation CAN, in principle, carry BOTH signals at once: a `triaged:`
frontmatter marker (the body is settled) AND a fully-answered sidecar (the
human wrote an answer to a question that was minted for it — before or after
the marker was stamped). The classifier must pick ONE pool, and the choice is
load-bearing: it decides whether the human's answer is actioned or dropped on
the floor.

## Decision

An observation whose active sidecar is fully answered routes to `apply` —
UNCONDITIONALLY, regardless of whether the body ALSO carries a `triaged:`
marker. The presence of a `triaged:` marker is IGNORED for the apply-routing
step; it only gates the create-side `triage` sub-pool.

The behaviour is encoded by the test
`an ANSWERED sidecar wins even when the observation is ALSO triaged:` in
`packages/dorfl/test/lifecycle-pools.test.ts` — the canonical pinned example.
The routing is implemented in the answered-sidecar arm of the observation loop
in `buildLifecyclePools`.

### Why — the create-vs-consume invariant, applied

Two facts compose:

1. **CONSUME is always on** (ADR `ci-config-policy-and-gate-family.md` §4).
   Gates govern CREATE acts; a CONSUME act (applying a human's committed
   answer) is never gated, because gating it would STRAND the human's answer.
2. **An answered sidecar IS a human answer** — the human wrote it in the right
   channel (a valid `work/questions/observation-<slug>.md`). Whether the body
   was ALSO stamped `triaged:` at some point is orthogonal: the sidecar is the
   HUMAN's committed intent, and it must be actioned.

If the marker won instead, an observation with `triaged: keep` (or any
non-empty value) plus a fully-answered sidecar would sit in neither pool: not
`triage` (settled), not `apply` (blocked by the marker). The human's answer
would be silently orphaned — the exact failure mode the create-vs-consume
invariant exists to prevent.

### Alternatives considered

- **Marker wins (settled body → drop).** Rejected: it strands answers. A
  `triaged: keep` observation whose sidecar the human then answered would sit
  forever, contradicting §4.
- **Refuse the combination (raise a usage error).** Rejected: the classifier
  is a pure routing step, not a validator. A body-and-sidecar mismatch is a
  data condition the apply rung is the right place to reason about (via the
  agentic apply-decide) — the human's answer + the settled body are both
  inputs to that decision. Failing at the router would strand the answer
  behind a bug the human can't fix from GitHub.
- **Prefer the marker for `triaged: duplicate`, sidecar otherwise.**
  Rejected: a marker-value-dependent split re-fragments the settled concept
  and re-litigates the CONSUME-is-always-on invariant per marker value. The
  clean rule ("answered sidecar wins, full stop") is easier to explain and
  auditable at one seam.

## Consequences

- The `triaged:` marker remains authoritative for the CREATE-side triage pool:
  a settled observation with no answered sidecar (or a pending one) is not
  re-enumerated for triage.
- The `apply` sub-pool is the ONE seam that handles an answered observation,
  irrespective of the body's settled state. The apply rung's agentic
  `applyDecide` then chooses `task` / `spec` / `adr` / `delete` / `ask` from
  the answer(s) + body — it sees BOTH signals and can honour the marker in
  its verdict (e.g. a `triaged: duplicate` observation with an answer might
  yield `delete` for the reason recorded in the answer).
- A pending sidecar on a settled observation is deliberately DROPPED at the
  classifier (`lifecycle-pools.ts`), codified by an explicit `continue`
  branch: a pending sidecar would only no-op if re-enumerated, and a settled
  observation is already resolved on the create side. Future readers see the
  drop as intentional, not as dead code.

---
title: Pool placement is a RUNNER-deterministic decision; humanOnly is an AGENT non-deterministic judgement
status: proposed
created: 2026-06-17
supersedes:
superseded_by:
---

# ADR: the staging/pool POSITION is runner-deterministic; humanOnly is agent judgement, they sit on opposite sides of the determinism/trust line

> **Forward note (2026-06-22 — `code-identifier-slice-prd-to-task-brief-rename` + `folder-taxonomy-reorg-and-rename`):** the vocabulary and the `work/` folder layout were RENAMED after this ADR was written. Read every conceptual `slice` below as **task**, `PRD` as **brief**, the verb `slicing`/`slicer` as **tasking**/**tasker**, and the frontmatter `sliceAfter` as **briefAfter**. The pre-reorg folder names map: `backlog/`→`tasks/todo/` (the agent pool), `prd/`→`briefs/ready/`, `prd-ready/`→`briefs/ready/` (the auto-tasking pool), and `prd-sliced/`→`briefs/tasked/`. The DECISION this ADR records (placement is runner-deterministic; humanOnly is agent judgement) is unchanged; only the names moved, and the original text is left intact to preserve the decision history.

> **STATUS: proposed.** Pins the WHY behind a three-axis autonomy model and a runner-enforced
> placement gate. Full design + edge cases + config in
> `work/prd/staging-pool-position-gate-and-trust-model.md`; design trail in
> `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md`.

## Decision

An item's autonomy is governed by THREE orthogonal axes, each OWNED by the side that can correctly
produce it:

- **POSITION (a folder, RUNNER-deterministic, STRUCTURAL).** A staging vs pool split, `backlog/`
  (staging, not agent-eligible) vs `todo/` (the agent pool) for slices; `prd/` (staging) vs
  `prd-ready/` (auto-slice pool) for PRDs. WHICH folder an item's output lands in is COMPUTED by the
  RUNNER from unforgeable inputs (the `originTrust` stamp, the per-repo placement policy, explicit
  operator flags) via a fixed precedence chain. No judgement; a pure function the agent cannot
  influence.
- **NATURE (`humanOnly`, AGENT/human judgement, ADVISORY).** "An agent must NEVER auto-take this by
  nature", decided by reasoning about the work (does building/slicing it need human
  judgement/security/secrets?). Non-deterministic, content-derived, advisory (a human can override).
  Slice `humanOnly` gates BUILDING (survives even in `todo/`); PRD `humanOnly` gates SLICING.
- **DISCOVERED (`needsAnswers`, AGENT judgement, ADVISORY).** "Blocked on an open question" , 
  unchanged.

The agent CREATES ledger files ONLY in the staging folder (`backlog/` for slices, `prd/` for PRDs);
the RUNNER owns every MOVE and every PROMOTION into a pool. This restates the existing "the agent does
not move files between `work/` folders" rule to also cover CREATION (slicing creates, not moves).

## Why

1. **The two gates live on OPPOSITE sides of the determinism/trust boundary, so neither can replace
   the other.** `humanOnly` is a non-deterministic JUDGEMENT (the slicer reasons about the nature of
   the work), the runner cannot make it. Placement is a deterministic COMPUTATION from trust +
   policy, the agent cannot be trusted to make it. The determinism line (judgement vs computation)
   and the trust line (agent-produced vs runner-resolved) COINCIDE. So `humanOnly` MUST stay an
   advisory agent flag, and placement MUST be a structural runner decision. Each axis sits on the
   only side that can correctly own it.
2. **It de-overloads `humanOnly`.** Today `humanOnly` is a catch-all for both "a human should review
   this first" (a POSITION concern) and "an agent must never build this by nature" (a NATURE
   concern). The folder takes the position/review job (where position is the honest encoding);
   `humanOnly` keeps ONLY the never-by-nature job. Each axis then means exactly one thing.
3. **It makes the gates STRUCTURAL, not advisory/bypassable.** Because the runner owns placement,
   promotion, trust-mode, and the lock from unforgeable inputs, a misbehaving or compromised agent
   physically CANNOT self-promote into the pool, self-place its output, or set its own trust. The
   gate's safety rests on the runner-owns-transitions invariant the codebase already enforces, not on
   trusting agent output. The structural axis (pool eligibility) is exactly the one that must be
   tamper-proof, and it is the one the runner deterministically owns.
4. **One mechanism, several payoffs.** The position gate is human CONTROL over the agent pool
   (valuable even when working-tree visibility is dropped); it trust-gates untrusted-origin output;
   and it enables REVIEW WITHOUT A PR SYSTEM for ledger-file output (slicing): `--merge` slices land
   in `backlog/` (durable, not eligible) and a human promotes the approved ones, review becomes a
   ledger position, not an out-of-band PR. (Code/implementation review still uses a branch/PR; a diff
   cannot be folder-gated, the right tool per artifact.)

## Considered and rejected

- **Fully retire `humanOnly`, encode everything as position.** Rejected: position is "not yet /
  pending a human's nod"; `humanOnly` is "never, by nature." Conflating them loses information (a
  human could wrongly promote a never-for-agents item into the pool). The hard never-for-agents case
  needs a durable flag that survives even in the pool.
- **Let the agent choose its birth folder / promote itself.** Rejected: it makes every gate advisory
  and bypassable. Placement must be runner-resolved from inputs the agent cannot forge.
- **A PRD-level position split is not worth it (earlier view).** Reversed: `intake` authors PRDs and
  untrusted origins exist today, so PRDs have the same intake-triage need as slices; they get the
  `prd/ → prd-ready/` split too.

## Consequences

- A per-repo placement policy (default landing per lifecycle) + per-source exceptions (untrusted
  origin forces staging; explicit operator flag overrides), resolved like the existing
  `originTrust`/`integration` precedence, RUNNER-resolved, the agent never sets it.
- Slice `humanOnly` is NARROWED to the rare hard case; PRD `humanOnly` is UNCHANGED and still
  essential (it gates auto-slicing, no folder substitute). `needsAnswers` unchanged.
- The `AGENTS.md`/WORK-CONTRACT "agent does not move files" rule is restated to cover creation: the
  agent may CREATE only in the staging folder; the runner owns moves + promotions.

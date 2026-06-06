---
title: review-skill — the review PROTOCOL as a pure, runner-agnostic skill that EMITS verdicts (callers route them)
slug: review-skill
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.

## Problem Statement

The review **protocol** (the ordered adversarial lenses ending in a destination
check) is needed by **two unrelated consumers**:

- the **review GATES** (`work/prd/review.md`) — slice-time (Gate 1) and PR/code
  (Gate 2), with toggles, a `--propose` PR arbiter, auto-merge, model overrides,
  the §13 role, and the shared trust resolver; and
- **`batch-qa`** (`work/prd/batch-qa.md`) — the human-batching loop that gathers
  review questions into one file for bulk answering.

Today the protocol is described only *inside* the `review` gate PRD, entangled
with the heavy, runner-coupled gate machinery. That makes it impossible for
`batch-qa` to reuse "just the review pass" without dragging in the gates — and it
blocks `batch-qa` behind the entire gate effort. The protocol is **methodology,
not execution** (ADR `command-surface-and-journeys` §8: adopt = skill); it should
be its OWN small, runner-agnostic skill that both consumers compose.

## Solution

Extract the review protocol into a standalone **`review` skill** (tool-agnostic,
like `to-slices`/`to-prd`), built FIRST, as the single source of the protocol that
both the gates and `batch-qa` consume.

### The protocol (verbatim from review.md — do NOT re-derive)

Ordered adversarial lenses ENDING in a destination check: (1) claim-vs-code,
(2) cleanup-vs-behaviour, (3) cross-slice composition, (4) **the destination
check** ("if built/sliced exactly as written, do we reach the PRD/ADR goal?").
The empirical case for multiple independent passes lives in
`work/ideas/review-gate-default-for-autoslicing.md`; do not duplicate it here.

### The load-bearing boundary: the skill EMITS verdicts; the CALLER routes them

This is the whole reason the skill is reusable by both consumers. The skill is
**pure assessment**: it READS items (slices / PRDs / code) and RETURNS findings.
It does **NOT** write `needsAnswers`, does **NOT** `git mv` to `needs-attention/`,
does **NOT** edit any file. Routing the verdict is the **caller's** job, because
each caller routes the SAME verdict to a DIFFERENT destination:

- the **autonomous gate** routes a `block` → set `needsAnswers: true` on the
  item (question into its body) / `git mv` to `needs-attention/`;
- **`batch-qa`** routes a `block` → a section in its one batch file (so the human
  answers it in bulk), and only later (its APPLY pass) flips `needsAnswers`.

This mirrors the discipline already chosen elsewhere: `to-slices` stays a pure
producer (the caller mixes in review on top); likewise the review skill stays a
pure assessor (the caller decides what to do with the verdict). A reusable skill
COMPUTES; the caller DECIDES. `needsAnswers` remains the unifying parked-question
signal — it is just WRITTEN BY THE ROUTER, from a verdict EMITTED BY THE SKILL.

### Output contract

```
review-skill(items) → per item:
  { verdict: "approve" | "block",
    findings: [ { severity: "blocking" | "non-blocking",
                  question: <the question for a human, with enough context>,
                  context:  <the relevant excerpt / reasoning> } ] }
```

No file writes; no frontmatter edits; no moves. Severity distinguishes blocking
(keeps an item out of "ready") from non-blocking (recorded, does not block) — the
same split `batch-qa`'s soft-floor stop rule relies on.

## User Stories

1. As a consumer (gate or batch-qa), I want a single `review` skill that runs the
   four-lens protocol over given items and RETURNS structured verdicts, so the
   protocol lives in exactly one place.
2. As a consumer, I want the skill to be **pure** (read-only; emits findings,
   writes nothing), so I can route the verdict to wherever I need (frontmatter,
   needs-attention, or a batch file) without the skill presuming my destination.
3. As a consumer, I want each finding tagged **blocking vs non-blocking**, so I
   can implement a soft floor / a gate threshold consistently.
4. As the `batch-qa` author, I want to compose this skill for my B (question-
   generation) pass without dragging in any gate machinery, so batch-qa is not
   blocked behind the gate effort.
5. As the `review`-gates author, I want both gates to invoke this ONE skill (and
   route its verdict to `needsAnswers`/`needs-attention`/auto-merge), so the
   protocol is not duplicated across the two gates.
6. As the maintainer, I want this built FIRST and depended on by both `review`
   (the gates) and `batch-qa`, so the shared protocol is a clean prerequisite.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** OMITTED. This is a well-scoped extraction of an already-decided
  protocol into a pure skill with a crisp output contract — agent-sliceable.
- **`needsAnswers`:** none open — the protocol is fixed (from `review.md` +
  the idea file), and the emit-vs-route boundary + output contract are decided
  (maintainer-confirmed 2026-06-06).

## Implementation Decisions

- **A SKILL** (`skills/review/`), runner-agnostic, alongside `to-slices`/`to-prd`.
  It is the single source of the review protocol.
- **Pure assessor, structured output** (the contract above). No file I/O beyond
  reading the items it reviews; emits verdicts/findings only.
- **Severity model** (blocking / non-blocking) is part of the contract — both the
  gate threshold and batch-qa's soft floor are built on it.
- **Does NOT include** the §13 role wiring, model overrides, toggles, the PR
  arbiter, auto-merge, or the trust resolver — those are the GATES (`review.md`).

## Testing Decisions

- Test the skill as a pure function of its inputs: given fixture items with known
  defects (a claim the code doesn't meet; an acceptance gap; a cross-slice
  conflict; a slice that misses its PRD goal), assert the emitted verdict +
  findings + severities. Stub any model call (as the autoslice/review slices do)
  so the protocol's STRUCTURE is tested deterministically, not a model's prose.
- Assert the skill writes NOTHING (no frontmatter edits, no moves) — purity is a
  testable property and the boundary that makes it reusable.

## Out of Scope

- **The review GATES** — slice-time + PR/code, toggles, PR arbiter, auto-merge,
  model override, the §13 role, the shared trust resolver. That is `review.md`
  (now `sliceAfter: [review-skill]`).
- **Routing verdicts** — by design the caller's job (gate → `needsAnswers`/
  needs-attention; batch-qa → the batch file).

## Further Notes

- Extracted from `work/prd/review.md` on 2026-06-06 (maintainer decision): that
  PRD encompassed BOTH the protocol (a skill) and the gates (runner machinery);
  `batch-qa` needs only the protocol, so the skill is split out as a shared
  prerequisite both `review` (gates) and `batch-qa` depend on.
- Protocol + empirical case: `work/ideas/review-gate-default-for-autoslicing.md`.

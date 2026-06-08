---
title: review-skill — a standalone, protocol-native review discipline (thorough + easy review of slices/PRDs/code/notes); emits verdicts, callers route
slug: review-skill
---

> **Sliced into `work/backlog/` on 2026-06-06** — detail trimmed to the slice
> (`work/backlog/review-skill.md`). Launch snapshot, NOT maintained. Current truth:
> `docs/adr/` + the code; remaining work: that slice. The durable framing
> (Problem / Solution / Stories / Out of Scope) is kept below; the
> Implementation/Testing detail moved into the slice.

## Problem Statement

Reviewing protocol artifacts — slices, PRDs, code, observations/findings/ADRs —
well is HARD and easy to do shallowly. An agent (or human) needs a **standalone,
reliable discipline** that makes reviewing such artifacts **more thorough and
easier**, grounded in THIS protocol's own rules (the `work/` contract + its
design) so it catches real, protocol-specific defects rather than offering a
generic checklist.

That discipline does not exist as its own thing. The review lenses are described
only *inside* the `review` GATE PRD (`work/prd/review.md`), entangled with the
heavy runner-coupled gate machinery (toggles, PR arbiter, auto-merge, model
overrides, the §13 role, the trust resolver). So nobody can simply "do a thorough
protocol review" without dragging in the gates — and `batch-qa` is blocked behind
the entire gate effort. The discipline is **methodology, not execution** (ADR
`command-surface-and-journeys` §8: adopt = skill); it should be its OWN skill that
stands alone.

## Solution

A **standalone, protocol-native `review` skill** (tool-agnostic, like
`to-slices`/`to-prd`) whose PURPOSE is to make an agent's review of protocol
artifacts more thorough and easier. It stands on its own — a human or agent reaches
for it directly to review better; the review GATES and `batch-qa` are simply two
CALLERS, not its reason for being. Built FIRST (the prerequisite both depend on).

It is **protocol-NATIVE and may assume it:** intended for a repo that uses the
`work/` contract, it KNOWS the protocol's peculiarities and reviews an artifact
AGAINST the contract + its design (status=folder, the gate axes, bucket polarity,
the shared-write isolation rule, drift=needs-attention, …). That assumption is what
makes it efficient here — it is deliberately NOT a generic reviewer.

### The discipline: four lenses as thinking tools, grounded in the protocol

Ordered lenses ENDING in a destination check, each grounded in concrete `work/`
standards: (1) claim-vs-reality, (2) cleanup-vs-behaviour (incl. acceptance
criteria + the shared-write isolation rule), (3) cross-artifact composition
(contract conformance: slugs, camelCase, gate axes honest, bucket polarity,
file-orthogonality), (4) **the destination check** ("if built/sliced/merged
exactly as written, do we reach the `prd:`/ADR goal?"). The empirical case for
multiple independent passes lives in
`work/ideas/review-gate-default-for-autoslicing.md`; do not duplicate it here.

### Output boundary (a consequence of standing alone, not the headline): the skill EMITS verdicts; the CALLER routes them

Because it stands alone, it does not presume how its output is used — which is also
what lets programmatic callers (gates, batch-qa) reuse it. The skill is
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

1. As an agent (or human) reviewing a protocol artifact, I want a standalone
   `review` skill I can reach for directly, so my review of a slice/PRD/code/note
   is MORE THOROUGH and EASIER — not dependent on any gate or caller.
2. As a reviewer, I want the lenses GROUNDED in this protocol's rules (the `work/`
   contract + ADRs), so the skill catches real protocol-specific defects (a
   dishonest gate axis, a wrong bucket, a missing isolation test, drift) rather
   than offering a generic checklist.
3. As a reviewer, I want each finding tagged **blocking vs non-blocking**, so a
   soft floor / a gate threshold can be applied consistently.
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

> Implementation & testing detail moved to the slice
> (`work/backlog/review-skill.md`). Note: `review-skill` is a METHODOLOGY skill
> (prose, like `to-slices`/`to-prd`) — there is NO code, NO model-invocation seam,
> and NO unit-test harness; its "acceptance" is doc-shaped (the protocol +
> emit-vs-route contract are completely and clearly stated). The model seam /
> toggles / PR machinery belong to the GATES (`review.md`), not here.

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

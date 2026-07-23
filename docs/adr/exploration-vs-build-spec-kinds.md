---
title: 'A spec has a KIND distinguished by its definition of DONE — a BUILD spec (done = capability shipped) vs an EXPLORATION spec (done = confidence + a de-risked plan); an exploration spec is the atomically-taskable escape valve for work too big/uncertain to build-task, and is still just a spec (no new folder/state)'
status: accepted
created: 2026-07-14
supersedes:
superseded_by:
---

# ADR: exploration spec vs build spec (a spec KIND by its definition of DONE)

## Context

ADR `tasking-is-atomic-or-split-no-partial-tasked-state` established a hard rule: a spec is tasked ATOMICALLY (every story becomes a task, or none does) or it is SPLIT. That rule assumes the pieces you split INTO are build-taskable. But splitting alone does not resolve the common case where a spec is too big AND too UNCERTAIN to build-task at any granularity: you do not yet KNOW how to build it, so writing vertical build tasks for it would be fiction, and splitting it just yields smaller specs that STILL are not confidently buildable.

Worked example (the anti-pattern): "grow WezigRenderer to match existing browsers" is decade-scale (Ladybird-class). Splitting it into "implement CSS grid", "implement flexbox", "bind HarfBuzz" does not help, because the approach itself is unproven: HarfBuzz-behind-the-paint-seam is not validated, write-vs-bind for JS is undecided, the progressive-swap routing is untested. Build tasks written now would be guesses dressed as tasks.

The honest move is not "split into smaller build specs". It is to REFRAME the work as an EXPLORATION whose deliverable is reaching CONFIDENCE: a pinned seam/interface, a thin end-to-end spike on the narrowest real case, the open questions resolved into decisions, and a de-risked, sliced BUILD PLAN. That IS atomically taskable, and the actual capability BUILD becomes a follow-on spec written AFTER the exploration says "yes, this way, and here is how".

## Decision

**A spec has a KIND, distinguished by its definition of DONE:**

- **Build spec** — "done" = the capability is SHIPPED. Tasked atomically as vertical build tasks (the existing model; the default kind).
- **Exploration spec** — "done" = CONFIDENCE + a de-risked, sliced build plan. Its stories are "reach confidence" stories (pin the seam, spike the risky part on the narrowest real case, evaluate-and-recommend a fork, resolve the open questions, emit the build plan), NOT "deliver the capability" stories. Tasked atomically as pin/spike/evaluate/plan tasks. The capability BUILD is a FOLLOW-ON build spec the exploration de-risks and plans, ordered via `taskedAfter:` from the follow-on to the exploration.

This closes the tasker's decision procedure into three exhaustive branches (TASKING-PROTOCOL.md §2a): (1) every story build-taskable now → task atomically; (2) part gated / mixed confidence → SPLIT; (3) whole thing too big/uncertain to build-task → REFRAME as an exploration spec.

The kind is a scoping/framing distinction the author and tasker reason with, carried by the spec's stories and its stated definition of done (and signalled by the slug, e.g. an `explore-*` prefix) — NOT a new frontmatter enum, folder, or lifecycle state.

## Consequences

- **The atomic-or-split rule becomes livable.** Branch 2 stops you tasking a confident SUBSET of a mixed spec; branch 3 stops you writing FICTIONAL build tasks for a spec whose approach is not yet proven. Together they keep every spec honestly, atomically taskable.
- **Specs get authored at the right scope up front.** `to-spec`'s nudge: if the ambition is too big/uncertain to build-task, author it as an exploration spec (confidence-scoped stories + an "emit the build plan" story), not a build spec that will balloon into an un-taskable one and then get partially tasked (the exact failure the sibling ADR describes).
- **No new folder or state.** An exploration spec is STILL just a spec in `work/specs/`, tasked atomically like any other; it moves `ready/ → tasked/` on the same binary taxonomy. We deliberately did NOT add a `specs/exploration/` folder or a `kind:` enum — the distinction is in the spec's content (its definition of done), not the taxonomy.
- **Reuse the `prototype` skill vocabulary for spikes.** An exploration's spike/pin/evaluate tasks are throwaway-code-that-answers-a-question in the sense of the existing `prototype` skill (the ANSWER is the deliverable — captured into the build plan or an ADR — not the code). We did NOT invent a parallel spike vocabulary.
- **`wighawag/wezig`'s `explore-webview-shell` / `explore-native-renderer` / `explore-web3-capabilities` are the canonical worked example** of the reframe: a too-big BUILD ambition (`browser.md`) split, then the too-big pieces reframed as exploration specs whose done is confidence + a plan.

## Considered alternatives

- **Only the atomic-or-split rule (no exploration kind).** Rejected: it leaves the too-big/uncertain case stuck — you cannot task it (it is not build-taskable) and splitting it just reproduces the problem at smaller scale. The escape valve is what makes the hard rule usable.
- **A new `kind:` frontmatter enum, or a `specs/exploration/` folder.** Rejected: the distinction is a scoping judgement carried by the spec's stories and definition of done, not a piece of taxonomy. Adding a folder/state would re-introduce the "more states than the binary lifecycle" complexity the sibling ADR is careful to avoid; an exploration spec is still just a spec.
- **Invent a bespoke "spike task" vocabulary.** Rejected: the repo already has a `prototype` skill for throwaway-code-that-answers-a-question. Reusing it keeps one concept, not two.

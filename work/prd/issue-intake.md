---
title: issue-intake — one issue front-door whose outcome is AGENT-DECIDED (a PRD, or slices directly); agent-authored slices land as a review-PR by default
slug: issue-intake
humanOnly: true
needsAnswers: true
sliceAfter: [auto-slice, runner-in-ci, issue-to-prd]
---

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`);
> once sliced, technical detail moves into the slices and durable rationale into
> `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **Provenance.** Maintainer discussion (2026-06-06). Generalises the planned
> `issue-to-prd` capability: in MOST real cases a filed issue wants **a slice (or a
> few)**, not a full PRD — but **CI cannot know which upfront**. So the front-door
> is ONE entry point whose OUTCOME is agent-decided. This PRD also fixes a safety
> asymmetry the discussion surfaced (a slice is immediately claimable; a PRD is
> not). `needsAnswers: true` — the decide/execute shape is the load-bearing open
> question (below). **Supersedes the standalone framing of `issue-to-prd`:** that
> PRD's committed-PRD output becomes ONE of this front-door's two outcomes.

## Problem Statement

agent-runner's planned front-of-funnel (`issue-to-prd`) assumes every issue
becomes a **PRD**. But observed reality (including this very repo's dogfooding):
when we notice a bug or a small improvement, we write **a slice directly, no PRD**
— which is fully in-contract (WORK-CONTRACT: a self-contained chore/refactor omits
`prd:` and is its own source of truth; `propose-pr-body` is exactly such a slice).
PRDs are the LESS likely outcome for everyday issues; the more common need is
**issue → slice(s)**, which has NO capability today.

Crucially (the maintainer's sharpening): **you cannot know before reading an issue
whether it should be a PRD or a set of slices.** A fuzzy/large issue → a PRD (grill
it, then `auto-slice`); a crisp small bug → one or a few slices directly. So from
CI's point of view there is **ONE thing** (an issue arrived) that can produce
**different outcomes** — the decision is part of the work, made by an agent that
has read the thread, not a pre-routed config.

And a **safety asymmetry** the discussion surfaced: a **PRD** committed to `main`
is safe (it builds nothing; with auto-slice off it just sits there). A **slice**
landing in `work/backlog/` is **immediately claimable** — an agent-authored slice
on `main` could be auto-built before any human sees it. So the slice outcome needs
a gate the PRD outcome does not: **agent-authored slices land as a review-PR (not a
direct backlog write) by default**, with an opt-in to let trusted authors'
slices auto-accept.

## Solution

One CI-installed **issue-intake** pipeline (behind the SAME issue seam
`issue-to-prd` defines) that conducts the clarifying conversation and ends by
emitting whichever outcome the agent judges right — a committed PRD OR one/more
slices — landing each outcome through the correct safety gate.

### One front-door, agent-decided outcome

- Same trigger policy + authorization + conversation loop as `issue-to-prd`
  (`command` default / `every-issue`; `maintainer` default / `anyone`; any
  spec-change re-evaluates → advance or ask). REUSE that machinery; this PRD adds
  the **outcome branch**, not a second pipeline.
- The conversation ends by the agent **classifying** the clarified requirement:
  - **PRD outcome** — fuzzy/large/multi-story → draft + commit `work/prd/<slug>.md`
    (exactly `issue-to-prd`'s output, with `issue: N`). Safe to land on `main`.
  - **Slices outcome** — crisp/small/self-contained → emit one or more
    `work/backlog/<slug>.md` (each `covers: []`, no `prd:` link, its own source of
    truth, per WORK-CONTRACT).

### The slice-outcome safety gate (the asymmetry fix)

- **Agent-authored slices DEFAULT to a review-PR, NOT a direct `backlog/` write on
  `main`.** A human reviews the slice (its spec) before it becomes claimable —
  closing the "auto-built before anyone looked" hole. (A PRD outcome needs no such
  gate: it is inert on `main`.)
- **Opt-in auto-accept by AUTHOR TRUST.** A per-repo policy may let a TRUSTED
  author's slices auto-accept (land directly in `backlog/`, claimable immediately).
  The trust inputs the discussion named: **who the author is** (issue author /
  trigger author, via the seam's author-association check — generalising
  `issue-to-prd`'s `maintainer | anyone`), **whether it was requested via a command
  / by whom**, and the repo's policy. Generalises today's binary `allowAgents`.
- **This is the SAME trust primitive `review`'s PR auto-merge needs.** Resolve it
  ONCE (a shared author/trust resolver), consumed by both this PRD's slice
  auto-accept and `review`'s `autoMerge`-on-approve.

## User Stories

1. As a user, I want to file ONE issue and have the agent decide — after grilling
   me — whether it becomes a PRD or slices, so I do not have to know upfront which
   shape my request is.
2. As the maintainer, I want a crisp small issue to become **slices directly** (no
   PRD), because most everyday work is a fix/small improvement that needs no PRD.
3. As the maintainer, I want a fuzzy/large issue to become a **PRD** (then
   `auto-slice` handles it), reusing the `issue-to-prd` output.
4. As the maintainer, I want **agent-authored slices to land as a review-PR by
   default**, NOT directly claimable on `main`, so that bad/over-eager slices can
   never be auto-built before a human reviews the spec.
5. As the maintainer, I want a per-repo **auto-accept** policy keyed on author
   trust (and how the work was requested), so that a TRUSTED author's slices can
   land directly in `backlog/` while everyone else's wait in a review-PR.
6. As the maintainer, I want the front-door to share the `issue-to-prd` seam +
   trigger/auth machinery and add only the outcome branch, so we do not maintain
   two issue pipelines.
7. As the maintainer, I want the slice-auto-accept trust primitive to be the SAME
   one `review`'s PR auto-merge uses, so trust is defined once.

## Implementation Decisions

(From the 2026-06-06 discussion — do not relitigate.)

- **One front-door, agent-decided outcome.** CI cannot pre-route; the agent reads
  the thread and decides PRD-vs-slices. NOT two separate triggers.
- **PRD outcome = `issue-to-prd`'s output** (committed PRD, `issue: N`, inert on
  `main`). This PRD subsumes `issue-to-prd` as one of two outcomes — reconcile that
  PRD's standalone framing when slicing (it may become this PRD's PRD-branch, or
  stay a building block this consumes).
- **Slice outcome = one or more `covers: []` backlog slices**, each its own source
  of truth (in-contract per WORK-CONTRACT), carrying a `Refs #N` link.
- **Agent slices default to a review-PR, never a direct `backlog/` write.** The
  safety asymmetry (claimable slice vs inert PRD) is the reason. Auto-accept is
  opt-in.
- **Author-trust auto-accept policy** generalises `allowAgents` (inputs: author
  association, request channel, repo policy) and is the SAME primitive `review`'s
  `autoMerge`-on-approve uses — resolve once.
- **Reuse the `issue-to-prd` issue seam + trigger/auth/conversation machinery.**
  Core never imports `gh`; only the adapter shells out. No labels, no issue
  lifecycle in core (ADR §12); loop-closure stays `Refs #N` + the folder-native
  "PRD/slice complete?" query.

## Testing Decisions

- **Stub the issue seam + the agent verdict** (no network, no real GitHub/model).
  Test the OUTCOME BRANCH as pure logic: given a stubbed "PRD" verdict the runner
  commits a PRD; given a stubbed "slices" verdict it emits the backlog slice(s).
- Test the **safety gate**: an agent "slices" outcome by an UNTRUSTED author lands
  as a review-PR (NOT a direct `backlog/` write on `main`); a TRUSTED author with
  auto-accept on lands directly in `backlog/`. The runner does the git; the agent
  drafts only.
- Test the **author-trust resolver** in isolation (author association × request
  channel × repo policy → accept/review-PR) and that `review` consumes the SAME
  resolver for `autoMerge` (no duplicated trust logic).
- Test `Refs #N` (never `Fixes #N`) on emitted PRs and clean degradation on a
  non-GitHub arbiter.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** reads untrusted issues, posts under
  the project's identity, and (critically) can make work CLAIMABLE — plus it
  defines an author-trust auto-accept policy. Security-sensitive front-door a human
  must drive the slicing of. Per-slice: the pure outcome-branch + author-trust
  resolver + "emit via seam" wiring is agent-buildable; the auth/seam adapter and
  the auto-accept policy lean `humanOnly`.
- **`needsAnswers: true` (PRD-level — the load-bearing open question):**
  - **Decide/execute shape.** HOW does the agent decide-then-act? Options the
    discussion floated: **(i) one agent** that decides AND emits the chosen outcome
    in one step (it has the thread context; on decision it invokes the right
    tool/writes the right artifact); **(ii) two steps** — a classifier agent
    decides PRD-vs-slices, then a dedicated executor (the existing `to-prd`-style
    PRD drafter, or a slice emitter) runs. Trade-off: (i) is simpler + keeps
    context; (ii) de-correlates the decision from the emission and lets each step
    use a fit-for-purpose role/model (and dovetails with `review`/§13 roles). DECIDE
    THIS before slicing — it shapes the seam (does the agent need a "tool to invoke
    an outcome", or does the runner branch on a returned verdict?).
  - **Multi-slice emission.** When the outcome is "a few slices", does the agent
    emit them with `blockedBy` between them (it knows the decomposition), and do
    they go in ONE review-PR or one-PR-each? (Lean: one review-PR for the set, since
    a human reviews the decomposition as a whole.)
  - **Relationship to `issue-to-prd`.** Does this PRD REPLACE `issue-to-prd`
    (subsume it as the PRD-branch) or BUILD ON it (consume its PRD-drafting as the
    PRD outcome)? Resolve when slicing to avoid two overlapping pipelines.

## Out of Scope

- The PR/code review gate + its auto-merge (that is `review`; this PRD SHARES the
  author-trust primitive but specs the issue front-door, not the review gate).
- Runner-in-CI packaging / `install-ci` (that is `runner-in-ci`).
- The slicer itself (`auto-slice`); the PRD outcome hands off to it as today.
- Non-GitHub issue providers (GitHub adapter first; the seam allows others later).
- Any issue-label state-machine / issue lifecycle in core (ADR §12).

## Further Notes

- `issue-to-prd` (`work/prd/issue-to-prd.md`) is the source for the issue seam
  shape, trigger/authorization policy, the unified conversation rule, and
  loop-closure (`Refs #N` + folder-native "complete?" query). REUSE all of it; this
  PRD adds the outcome branch + the slice safety gate on top.
- whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the issue
  provider/seam, author-association checks, and the slash-command/event workflow.
  Do NOT reuse its label state-machine or 1-PR-per-issue model.
- The author-trust auto-accept primitive is deliberately shared with `review`'s
  `autoMerge`-on-approve — define it once, consumed by both.

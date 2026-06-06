---
title: issue-intake — the issue front-door, slices-first: 1 ask → 1 slice; needs >1 slice → a PRD (in-thread conversation, stop there); unrelated → split into N issues
slug: issue-intake
humanOnly: true
needsAnswers: true
sliceAfter: [auto-slice, runner-in-ci, issue-to-prd]
---

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`);
> once sliced, technical detail moves into the slices and durable rationale into
> `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **Provenance.** Maintainer discussion (2026-06-06), refined over several passes.
> The original `issue-to-prd` capability assumed every issue → a PRD. Observed
> reality: MOST issues are a bug fix / small improvement that wants **one slice, no
> PRD** (in-contract: a `covers:[]` slice is its own source of truth, per
> WORK-CONTRACT — `propose-pr-body` is exactly such a slice). So the front-door is
> **slices-first**. A PRD is produced ONLY when the work genuinely needs MORE THAN
> ONE slice — because that is precisely when there is a shared vision worth
> recording (and a PRD is never a thin grouping stub; a >1-slice issue has real
> cross-slice content). `issue-to-prd` is NOT dropped — it is the in-thread PRD
> CONVERSATION this front-door routes to for the >1-slice case (and that PRD is
> human-driven via the issue thread, the same way `to-prd` is human-driven at a
> desk).

## Problem Statement

agent-runner's front-of-funnel was designed as `issue-to-prd` (every issue → a
committed PRD, then `auto-slice`). But most filed issues — a bug, a small
improvement, a refactor — do not need a PRD at all; they want **a single slice**.
There is no capability for that today, and forcing a PRD on every issue is
ceremony the common case does not warrant.

The clean rule the discussion arrived at (a sharp trigger, not a fuzzy heuristic):

- **One ask that fits in ONE slice → emit one slice, NO PRD.** The common case.
- **One ask that needs MORE THAN ONE slice → a PRD.** If a single coherent ask
  cannot be done in one slice (it splits for scope or architectural reasons), then
  the thing tying those slices together IS a shared vision — and that vision is
  exactly what a PRD records. So >1 slice ⟺ shared vision ⟺ PRD. The PRD here is
  not thin: it carries *why it splits, how the pieces relate, and their order* —
  real content each slice needs.
- **Multiple UNRELATED slices in one issue → invalid; reply "file separate
  issues."** If the agent cannot articulate a shared vision for a would-be
  multi-slice set, the slices are unrelated work wearing one issue — bounce it.
  (Reserved for genuinely unrelated concerns, NOT a legitimately-coupled pair that
  is simply small: a coupled-but-light pair still gets a light PRD, not a bounce.)

This makes **"needs a PRD" decidable by COUNT, not vibe**: can this be one slice?
If not, it needs a PRD. And it eliminates the only case that would have required a
new slice-grouping mechanism (multiple unrelated slices per issue) — by policy, not
machinery.

## Solution

A CI-installed **issue-intake** pipeline (behind the SAME issue seam `issue-to-prd`
defines: trigger policy, authorization, the unified conversation loop). It conducts
the clarifying conversation in the issue comments and resolves to ONE of three
outcomes.

### The three outcomes

1. **Single slice (default, common).** The clarified ask fits one slice → emit one
   `work/backlog/<slug>.md` (`covers:[]`, no `prd:`, its own source of truth),
   carrying `Fixes #N` so its merge closes the issue (a lone slice = one PR = clean
   `Fixes`).
2. **A PRD (needs >1 slice).** The ask is coherent but cannot be one slice → the
   conversation continues IN-THREAD until a PRD emerges (this is exactly the
   `issue-to-prd` conversation). Commit `work/prd/<slug>.md` with `issue: N`, then
   **STOP** — CI does NOT also emit the slices. Slicing is a separate, gated step
   (`auto-slice` or a human via `to-slices`); the clean cut at the committed PRD is
   `issue-to-prd`'s existing contract.
3. **Bounce (unrelated work).** The agent cannot find a shared vision for a
   multi-slice set → post a comment asking the user to file separate issues, leave
   the issue open. (Distinct from #2: #2 is coupled work with a vision; #3 is
   unrelated work.)

### Tracking / loop-closure needs NOTHING new — `prd:` presence is the switch

The discriminator is already in the contract: **a slice with no `prd:` is alone;
a PRD groups its slices.** So:

- **Single-slice outcome** → the slice's PR carries `Fixes #N` → merge closes the
  issue directly. (Safe: exactly one PR, no fan-out, so `Fixes` is correct here.)
- **PRD outcome** → reuses `issue-to-prd`'s loop-closure UNCHANGED: PRs use
  `Refs #N` (never `Fixes #N` — the PRD fans out to N slices = N PRs); the
  folder-native "PRD complete?" query (all `prd:<slug>` slices in `done/`, ≥1)
  closes `issue: N` via the seam at the merge that completes the set.
- **No slice-level `issue:` field is introduced** — there is no vision-less
  multi-slice case to group (outcome #3 bounces it), so the only multi-slice case
  is the PRD case, which the existing `prd:` mechanism already tracks.

### The slice-emission safety gate (single-slice outcome)

A slice landing in `work/backlog/` is **immediately claimable** (unlike a PRD,
which is inert on `main`). So the single-slice outcome lands through a trust gate:

- **DEFAULT: a review-PR**, not a direct `backlog/` write on `main` — a human
  reviews the slice spec before it becomes claimable.
- **OPT-IN: direct to `backlog/` (auto-accept) when the AUTHORIZING ACTOR is
  trusted** — e.g. the repo owner filed the issue, OR a maintainer issued the
  trigger command. Keyed on the **authorizing actor** (the trigger comment's
  author, who may differ from the issue opener — so a maintainer can bless a
  stranger's issue into a direct slice).
- This **author-trust resolver** generalises today's binary `allowAgents` (inputs:
  author association × request channel × repo policy). **It is a CI /
  issue-front-door concern — NOT shared with `review`'s `autoMerge`** (decoupled
  2026-06-06; see Autonomy notes): `review`'s merge keys on per-repo policy only
  because the `do`-path author is the operator. Author-trust matters here solely
  because an *untrusted issue author* can trigger work.
- (The PRD outcome needs no such gate — a committed PRD is inert; its slicing is
  separately gated.)

### Emission mode: CI emits the artifact (mode a), gated by review-PR

CI emits the actual slice file (single-slice outcome) on a branch → review-PR (or
direct, per trust) — NOT a triage-only comment a human then turns into files. A
considered alternative ("triage-only": the agent posts a slice OUTLINE as a
comment, a human runs `to-slices`) was folded out: review-PR already delivers the
same safety (a human approves before claimable) with less human work, so it is not
built as a separate mode (recorded here so it is not relitigated).

## User Stories

1. As a user, I want to file an issue describing a bug or small improvement and get
   **one slice** (no PRD), because most work does not need a design doc.
2. As the maintainer, I want an issue that genuinely needs MORE THAN ONE slice to
   produce a **PRD** (via the in-thread conversation), because >1 slice means there
   is a shared vision worth recording — and CI then STOPS at the committed PRD.
3. As the maintainer, I want an issue whose would-be slices are UNRELATED to be
   bounced with a "file separate issues" comment, so unrelated work is not smuggled
   under one issue.
4. As the maintainer, I want a single-slice outcome to land as a **review-PR by
   default**, NOT directly claimable, so a bad slice can never be auto-built before
   a human reviews the spec.
5. As the maintainer, I want **auto-accept (direct to backlog)** when the
   authorizing actor is trusted (owner-filed issue, or a maintainer command), keyed
   on the authorizing actor, so my own crisp issues do not need a PR round-trip.
6. As the maintainer, I want issue closure to need NO new mechanism: a lone slice
   closes via `Fixes #N`; a PRD closes via the existing folder-native "all slices
   done" query — distinguished by whether the slice has a `prd:`.
7. As the maintainer, I want the trust resolver to be the SAME one `review`'s PR
   auto-merge uses, so trust is defined once.

## Implementation Decisions

(From the 2026-06-06 discussion — do not relitigate.)

- **Slices-first; PRD only when >1 slice is needed.** Sharp trigger by COUNT: one
  ask that fits one slice → slice (no PRD); needs splitting → PRD.
- **>1 slice ⟺ shared vision ⟺ PRD** (not a thin grouping stub; the PRD carries why
  it splits + how the pieces relate + order).
- **Multiple UNRELATED slices → bounce** ("file separate issues"). Reserved for
  unrelated concerns; a coupled-but-light pair gets a light PRD, not a bounce.
- **PRD outcome = `issue-to-prd`'s in-thread conversation; CI STOPS at the
  committed PRD** (the existing clean cut). CI does not also emit the slices.
- **No slice-level `issue:` field.** The only multi-slice case is the PRD case
  (the vision-less multi case is bounced), so `prd:` presence is the tracking
  discriminator; nothing new is added to the contract.
- **Closure:** lone slice → `Fixes #N`; PRD → `Refs #N` + the existing
  "PRD complete?" query closes `issue: N`. Provider-portable, no labels (ADR §12).
- **Single-slice safety gate:** review-PR by default; direct-to-backlog auto-accept
  when the AUTHORIZING ACTOR is trusted. Trust resolver generalises `allowAgents`;
  it is a CI / issue-front-door concern, **NOT shared with `review`'s `autoMerge`**
  (decoupled 2026-06-06).
- **Emission mode (a)** (CI emits the file, review-PR gated); triage-only folded
  out (review-PR subsumes it).
- **Reuse the `issue-to-prd` seam + trigger/auth/conversation machinery.** Core
  never imports `gh`; only the adapter shells out.

## Testing Decisions

- **Stub the issue seam + the agent verdict** (no network, no real GitHub/model).
  Test the OUTCOME BRANCH as pure logic: a "single-slice" verdict emits one
  backlog slice (no `prd:`); a "needs-PRD" verdict commits a PRD (`issue: N`) and
  STOPS (emits no slices); an "unrelated" verdict posts the split-issues comment and
  emits nothing.
- Test the **safety gate**: a single-slice outcome by an UNTRUSTED actor lands as a
  review-PR (not a direct `backlog/` write); a TRUSTED authorizing actor
  (owner-filed / maintainer command) with auto-accept on lands directly in
  `backlog/`. The runner does the git; the agent drafts only.
- Test the **author-trust resolver** in isolation (author association × request
  channel × repo policy → review-PR vs direct) and that `review` consumes the SAME
  resolver for `autoMerge` (no duplicated trust logic).
- Test **closure**: a lone slice's PR carries `Fixes #N`; a PRD's PRs carry
  `Refs #N` and the existing "PRD complete?" query closes `issue: N` at set
  completion. Clean degradation on a non-GitHub arbiter (no close, no breakage).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** reads untrusted issues, posts under
  the project's identity, and can make work CLAIMABLE — plus it defines an
  author-trust auto-accept policy. Security-sensitive front-door a human must drive
  the slicing of. Per-slice: the pure outcome-branch + author-trust resolver +
  "emit via seam" wiring is agent-buildable; the auth/seam adapter and the
  auto-accept policy lean `humanOnly`.
- **`needsAnswers`: true — ONE open question (raised 2026-06-06, batch-qa).** The
  earlier decide/execute-shape question (one agent vs two-step) dissolved (see
  below). What remains OPEN is the **author-trust resolver's shape + ownership**
  (it ties to `review` Q4, also open):
  - **OPEN — author-trust resolver (a CI / issue-front-door concern, now
    DECOUPLED from `review`).** Maintainer steer (2026-06-06): the trust is
    fundamentally about the **issue author**, BUT issue-intake must also be
    processable when a **repo owner / maintainer issues a `/command` in an issue
    comment** — i.e. the authorizing actor (the trigger-comment author) can differ
    from and override the issue opener. So the resolver's inputs are at least
    *(issue-author association) × (trigger-comment author association) × (request
    channel: command vs every-issue) × (repo policy)*. STILL TO DECIDE: the exact
    resolver signature, and where it lives in the issue-front-door wiring.
    **DECOUPLING (2026-06-06, batch-qa round 2):** the earlier "SAME primitive as
    `review`'s `autoMerge`, define once, consumed by both" is **WITHDRAWN**.
    Author-trust matters ONLY because an *untrusted issue author* can trigger work
    — it is purely a CI / issue-front-door concern. `review`'s `autoMerge` keys on
    per-repo policy only (on the `do` path the author IS the operator who ran the
    command — no untrusted author to gate). So this resolver is OWNED HERE
    (issue-intake / CI), is NOT shared with the `do`/review gate, and does not
    block `review` from slicing. It remains genuinely open *for this PRD* — but as
    an issue-front-door question, settled when this PRD (or `runner-in-ci`) is
    sliced, NOT as a cross-PRD shared primitive.
  - *(Resolved/closed:)* the decide/execute-shape question — with slices-first + a
    sharp count-based PRD trigger + CI stopping at the PRD, the conversation agent
    resolves to one of three outcomes and the runner branches on the verdict (the
    same shape `issue-to-prd` already uses).

### Slice-readiness notes (resolved 2026-06-06, batch-qa)

- **Slice ORDER: issue-intake is sliced LAST of the chain** — after BOTH
  `runner-in-ci` and `issue-to-prd` are sliced (its `sliceAfter` names both, plus
  the already-sliced `auto-slice`). Not this cycle. It reuses `issue-to-prd`'s
  seam/conversation slugs and needs `runner-in-ci`'s `install-ci` slugs.
- **Blocked from slicing by the open author-trust question above** (not just by
  order): the resolver is a core deliverable this PRD's slices reference, so its
  shape + owner must be pinned (jointly with `review` Q4) first.

## Out of Scope

- The PR/code review gate + its auto-merge (that is `review`; this PRD SHARES the
  author-trust primitive but specs the issue front-door, not the review gate).
- Runner-in-CI packaging / `install-ci` (that is `runner-in-ci`).
- The slicer itself (`auto-slice`); the PRD outcome hands off to it (CI stops at
  the committed PRD).
- Emitting the slices in CI for the PRD outcome (CI stops at the PRD — slicing is a
  separate gated step).
- A slice-level `issue:` grouping field (not needed — no vision-less multi-slice
  case to group; outcome #3 bounces it).
- Non-GitHub issue providers (GitHub adapter first; the seam allows others later).
- Any issue-label state-machine / issue lifecycle in core (ADR §12).

## Further Notes

- `issue-to-prd` (`work/prd/issue-to-prd.md`) is NOT dropped: it IS the in-thread
  PRD conversation outcome #2 routes to (and the source for the issue seam shape,
  trigger/authorization policy, the unified conversation rule, and the PRD
  loop-closure `Refs #N` + "PRD complete?" query). This PRD adds the slices-first
  default + the single-slice safety gate + the bounce; `issue-to-prd` provides the
  PRD path. `sliceAfter` it so this PRD's slices can reference its slugs.
- whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the issue
  provider/seam, author-association checks, and the slash-command/event workflow.
  Do NOT reuse its label state-machine or 1-PR-per-issue model.
- The author-trust resolver is a CI / issue-front-door concern, **NOT shared with
  `review`'s `autoMerge`** (decoupled 2026-06-06). `review`'s merge gate keys on
  per-repo policy only — the `do`-path author is the operator who ran the command,
  so there is no untrusted author to resolve. Author-trust matters only where an
  untrusted *issue author* can trigger work; it is owned here.

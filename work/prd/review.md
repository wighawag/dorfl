---
title: review — a model-driven review role, as TWO complementary gates (spec review + PR/code review), each independently on/off, with per-repo auto-merge-on-approve
slug: review
humanOnly: true
sliceAfter: [auto-slice, review-skill]
---

> **SCOPE NARROWED 2026-06-06 — the review PROTOCOL was extracted to its own PRD
> (`work/prd/review-skill.md`).** This PRD is now ONLY the review **GATES** (the
> runner machinery): Gate 1 (slice-time), Gate 2 (PR/code), the per-repo toggles,
> the `--propose` PR arbiter, auto-merge-on-approve, the model override, the §13
> role, and the shared trust resolver. The protocol itself — the four adversarial
> lenses + destination check, realised as a runner-agnostic `review` SKILL that
> EMITS verdicts (callers route them) — is `review-skill` and must be built FIRST
> (hence the added `sliceAfter`). Where this PRD's text below describes "the
> shared protocol (a SKILL)", that content now LIVES in `review-skill.md`; both
> gates here CONSUME that skill and ROUTE its verdict to `needsAnswers` /
> `needs-attention` / auto-merge.

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`);
> once sliced, technical detail moves into the slices and durable rationale into
> `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **Provenance.** This PRD promotes `work/ideas/review-gate-default-for-autoslicing.md`
> (two independent dogfood sessions reproduced its core finding) AND a maintainer
> discussion (2026-06-06) that sharpened the framing: there are **two kinds of
> review gate, complementary, not one mechanism with two defaults**. Read that idea
> file for the empirical case + the review PROTOCOL; this PRD is the buildable
> shaping. It **activates** `execution-substrate-decisions.md` §13's staged
> `review`/`grilling` role (and would add a `review` model override there).

## Problem Statement

Defects in this project concentrate in **slicing/specs**, not the agents' code —
the session-path slice took FOUR review passes and still missed a product gap; the
do-remote slice rested on a stale central premise. Yet the only automated quality
floor today is **`verify`** (a deterministic, model-free shell gate, ADR §8) —
which exists for CODE and **does not exist at all for slicing** (slicing emits
prose; there is no `pnpm test` for a decomposition). Separately, in real use the
maintainer keeps doing the same thing by hand: a `--propose` PR lands, then a human
asks an agent to **review the PR** (the multi-angle + destination-check protocol),
and merges only if it passes. That manual PR-review wants to be a capability too.

These are **two distinct review gates** (the discussion's key sharpening):

- **Spec/slice review** — gates the *autonomous slicer*, which has NO `verify`
  floor. Here a model verdict is the ONLY possible gate (the output is prose). This
  is where review's ROI is highest.
- **PR / code review** — layers *on top of* `verify` for built work in `--propose`
  mode. `verify` proves it builds+tests+formats; the PR review is the **judgement**
  second-opinion (does the diff actually reach the slice's goal, any landmines a
  human reviewer would flag). It is the **final arbiter of the `--propose` PR**.

**They are complementary, not mutually exclusive, and each is independently
on/off.** A repo may run both, either, or neither. They share one **protocol** and
one **`review` role/seam**, but differ on the determinism boundary (§8) and on
visibility.

## Solution

One **`review` role** (the methodology) realised as a runner-agnostic **skill**,
invoked by the runner at two gate points (each a per-repo toggle), with verdicts
routed through the EXISTING needs-attention / `needsAnswers` seam.

### The shared protocol (a SKILL — adopt=skill, ADR command-surface §8)

The review PROTOCOL — ordered adversarial lenses ENDING in a destination check —
is **methodology, not execution**, so it is a `review` **skill** (tool-agnostic,
like `to-slices`/`to-prd`): (1) claim-vs-code, (2) cleanup-vs-behaviour, (3)
cross-slice composition, (4) **the destination check** ("if built/sliced exactly
as written, do we reach the PRD/ADR goal?"). The skill is the single source of the
protocol; both gates run the SAME skill. (Full protocol + the empirical case for
multiple independent passes live in the idea file; do not duplicate here.)

### RESOLVED DESIGN (2026-06-06 grilling pass) — THREE concepts, ONE mechanism, MANY insertion points

> This section is the authoritative resolved shaping; where older text below
> ("Gate 1 / Gate 2", the idea file's "one-mechanism-two-defaults") conflicts, THIS
> wins. Source: `work/findings/review-gate-vs-slicer-edit-loop.md` +
> `work/findings/run-and-do-have-separate-integrate-paths.md` + the idea file's M×N.

The review PROTOCOL (the ordered adversarial lenses + the destination/goal check) is
ONE methodology (the `review` skill, already built — `done/review-skill.md`). It is
consumed in TWO operational SHAPES, and plugged in at several INSERTION POINTS:

**Shape 1 — the review GATE (one-shot, terminal: approve / block).**
- A single reviewer invocation → verdict. approve ⇒ proceed; block ⇒ route to
  `needsAnswers` / `needs-attention` (the existing seam). NOT a loop — **no
  `reviewMaxRounds` on a gate** (the rounds knob on the built Gate-2 path is an
  orphan from a miscommunication — see
  `work/observations/reviewmaxrounds-on-wrong-concept.md`; later removed from the
  gate).
- The **destination/goal check is a PROMPT-FRAMING ASPECT folded into the single
  gate pass**, not a separate step: "do these slices / this diff reach the PRD/ADR
  goal?" is part of the best review prompt, combinable with the other lenses.
- Insertion points (same mechanism, different prompt): post-build impl review
  (**built — #11/#12**); and, later, the pre-build slice check + the run path (see
  below).

**Shape 2 — the SLICER EDIT LOOP (NOT a gate — an improver).**
- The observed phenomenon: slices keep IMPROVING when reviewed; findings feed back
  into EDITS, repeatedly. So slice-generation review is a **review→edit→re-review→
  converge** loop, with the goal/destination check INSIDE the loop (it can itself
  trigger edits — which is why it is a loop, not a terminal gate).
- **Mechanism (resolved Q1): ONE agent reviews-and-EDITS in a SINGLE context** (the
  N in-context multipass, accumulating across angle-switched passes). A **fresh
  context is simply a NEW EXECUTION of that same loop in a fresh context** (the M).
  So the M×N grid = "run the (review+edit) loop N passes deep, M times in fresh
  contexts." Degenerate `M=1,N=2` = cheap; `M=k` = k fresh independent loops.
- **Termination (resolved Q2):** natural terminator = a pass finds no NEW blocking
  issue; `maxReview` is the HARD CAP (per-repo configurable, flag > env > per-repo >
  global, cheap default). **On reaching `maxReview` with unresolved blockers, the
  slice(s) are REJECTED as `needsAnswers`** (the verdict sink below). `maxReview`
  lives HERE (the loop), never on the gate.
- **Verdict routing (the loop's sink) = the EXISTING needsAnswers / needs-attention
  routing** that `autoslice-confidence` built: (a) a specific uncertain slice →
  emit with `needsAnswers: true` + questions in its body; (b) the whole
  decomposition unclear / `maxReview` exhausted → route the PRD to
  `needs-attention/` with the questions, emit no guessed slices. The loop FEEDS
  this routing; it does not replace it.

**Relation to `autoslice-confidence` (resolved Q4): re-scope, do NOT blind-delete.**
`autoslice-confidence` bundles two things: (1) a one-shot self-confidence JUDGEMENT
— SUPERSEDED by the edit loop (the loop is the confidence mechanism done right, an
INDEPENDENT adversarial pass a self-check cannot be); and (2) the needsAnswers /
needs-attention ROUTING fallbacks — LOAD-BEARING, and exactly the edit loop's
verdict sink. So: the edit-loop slice ABSORBS the judgement; the ROUTING survives
(carried by the edit-loop slice, or kept as a re-scoped routing slice the loop
`blockedBy`s). 4 artifacts reference `autoslice-confidence` (`autoslice-command`,
the `auto-slice`/`command-surface-phase-2`/`review` PRDs) — reconcile those refs
when re-scoping; the routing behaviour must NOT be lost.

**Insertion points (the mechanism is defined ONCE, consumed at each):**
- **(A) slice-generation** — the SLICER EDIT LOOP on the `do prd:<slug>` path.
  **THE FIRST SET (built now, to dogfood slicing non-yet-sliced PRDs).**
- **(B) pre-build slice check** — a slice-review (Shape-1 gate, slice-framed prompt)
  INSIDE `do <slug>` BEFORE the agent builds, so a slice that slipped through with a
  missed judgement is caught/refined before implementation. **Later set.**
- **(C) post-build impl review** — Gate 2. **Built (#11/#12).**
- **(D) run coverage** — `run` has a SEPARATE integrate path and does NOT inherit
  the gate today (`work/findings/run-and-do-have-separate-integrate-paths.md`).
  This is its OWN later set whose FIRST job is to converge `run` on the `do`
  codepath (`performComplete`); review then integrates naturally, no duplication.
- **(E) issue-thread surface** — issue-to-prd / issue-intake CI runs the SAME
  review/edit loop on the generated PRD/slices and surfaces findings as QUESTIONS
  (and edits where sensible) into the ISSUE COMMENT THREAD. **Later set** (belongs
  in the issue-intake design; reuses this mechanism).

### Gate 1 — SPEC/SLICE review  *(SUPERSEDED by "RESOLVED DESIGN" above — slice-gen
review is the EDIT LOOP (Shape 2, insertion point A), not a one-shot gate. Retained
for history.)*

- Runs as a distinct STEP after the auto-slicer emits slices (NOT a "review
  yourself" line in the slicer prompt — a separate invocation/role; a prompt
  instruction may sit ON TOP, not instead).
- **Default ON for slicing** — there is no `verify` floor there, so review is the
  only gate; for an autonomous slicer with no human, the destination check is the
  strongest trust signal a decomposition is sound.
- **Verdict routing reuses the existing seam:** a blocking finding sets the
  PRD/slice `needsAnswers` (or routes the offending slice to `needs-attention`) —
  the same valve the producer's own humility-check uses (`needsAnswers` is the
  unifying lever: producer + reviewer, one signal). An `approve` lets the slices
  land claimable.

### Gate 2 — PR / CODE review (the final arbiter in `--propose`)

- Runs as a CI step (and a local command) when a **work PR** is opened by
  `do --propose` / `complete --propose`. It does NOT replace `verify` — `verify`
  ran first (the deterministic floor); this is the judgement second-opinion ON TOP.
- **It is the FINAL ARBITER of the `--propose` PR** and is **more VISIBLE than Gate
  1**: its output is posted **as a PR review/comment** (via the provider seam), so
  a human sees the reasoning on the PR itself — unlike the spec gate, which acts
  inside the slicing pipeline.
- **Per-repo `autoMerge`-on-approve policy.** If (and only if) the repo opts in,
  an `approve` verdict auto-merges the PR; otherwise the review is advisory/blocking
  but a human merges. Resolved exactly like `integration`/`allowAgents`: **flag >
  per-repo config > global > built-in default (OFF)**. A non-approve verdict NEVER
  auto-merges and routes to needs-attention / leaves the PR for a human.
- **Determinism boundary (§8), explicit:** putting a model in the merge decision is
  a **judgement gate, not a determinism gate**. It is acceptable ON TOP of `verify`
  (never silently replacing it) and ONLY auto-merges when the repo explicitly
  enabled `autoMerge`. `verify` remains the non-skippable deterministic floor.

### Both gates: one role, two toggles, independent

- `reviewSpec` (Gate 1) and `reviewPr` (Gate 2) are **independent per-repo
  toggles** (each on/off), resolved like other policies. Gate 1 defaults ON
  (slicing has no other floor); Gate 2 defaults OFF (it adds a model to the merge
  path — opt-in), and its `autoMerge` sub-policy defaults OFF.
- Both invoke the same `review` skill via the §13 role; both may use the staged
  per-repo `review` **model override** (a cheaper/different model than the builder,
  for de-correlation).

## User Stories

1. As the maintainer, I want an automatic **spec review** after auto-slicing
   (default on), because slicing has no `verify` floor and that is where defects
   concentrate, so that a bad decomposition is caught before any slice is claimed.
2. As the maintainer, I want the spec reviewer's blocking findings to route through
   the SAME `needsAnswers`/needs-attention seam the producer uses, so that there is
   one verdict valve, not a new surfacing mechanism.
3. As the maintainer, I want an automatic **PR/code review** on `--propose` work
   PRs (opt-in), layered ON TOP of `verify`, posted AS a PR comment/review so it is
   visible, so that I get the second-opinion I currently request by hand.
4. As the maintainer, I want a per-repo **auto-merge-on-approve** policy (default
   off, resolved like `integration`), so that trusted/low-risk repos can let an
   approved PR merge itself while everything else waits for me.
5. As the maintainer, I want spec review and PR review to be **independently
   on/off** (complementary, not coupled; either, both, or neither), so that I can
   adopt them at my own pace per repo.
6. As the maintainer, I want both gates to run the **same review protocol** (the
   angle sequence + destination check) from ONE `review` skill, and to optionally
   use a per-repo `review` model override, so the methodology lives in one place
   and the verdict can be de-correlated from the producer.
7. As the maintainer, I want `verify` to stay the **non-skippable deterministic
   floor** and the model review to be an explicit **judgement** gate on top (never
   silently replacing `verify` for code), so the trust boundary (§8) is preserved.

## Implementation Decisions

(From the idea file + the 2026-06-06 discussion — do not relitigate.)

- **Two complementary gates, one role.** Spec review and PR/code review are
  distinct gates (different determinism properties, different visibility), each
  independently toggled, sharing one `review` skill + the §13 role. NOT "one
  mechanism with two defaults."
- **Protocol = skill; running it + posting/merging = command/runner.** The angle
  sequence + destination check is a runner-agnostic `review` skill (adopt=skill).
  Invoking it at a gate, posting the PR comment via the provider seam, and the
  auto-merge decision are execution (the runner/command).
- **PR review is the final arbiter in `--propose`, and more visible** (posted on
  the PR). `verify` runs first; review layers on top; neither replaces the other.
- **`autoMerge`-on-approve is per-repo, default OFF, resolved like `integration`**
  (flag > per-repo > global > default). Only an `approve` auto-merges; any other
  verdict never does.
- **Verdict routing reuses the existing seam** (blocking → `needsAnswers` /
  needs-attention). No new surfacing mechanism, no labels (ADR §12).
- **Determinism boundary explicit (§8):** review is a judgement gate ON TOP of
  `verify`; `verify` stays the non-skippable model-free floor for code. For slicing
  there is no `verify`, so the model IS the gate — acceptable because the output is
  prose and there is no deterministic alternative.
- **Uses the provider seam, never `gh` directly** for posting reviews/comments and
  merging — same discipline as the harness/integration seams (GitHub adapter
  first).

## Testing Decisions

- **Stub the review role/agent and the provider seam** (no network, no real model,
  no real GitHub). Test the GATE WIRING + verdict routing as pure logic: an
  `approve` lets slices land / merges the PR (only when `autoMerge` on); a blocking
  verdict sets `needsAnswers` / routes to needs-attention and NEVER merges.
- Test the two toggles are **independent** (spec-on/PR-off, PR-on/spec-off, both,
  neither) and that `autoMerge` resolution follows flag > per-repo > global >
  default-off.
- Test that PR review is posted via the seam's review/comment method and that a
  non-GitHub arbiter **degrades cleanly** (review still runs; just no PR comment /
  no auto-merge) — mirroring the integration seam's `none` degradation.
- Test the **iteration bound** (`reviewMaxRounds`): a revise↔review loop can never
  run forever; on exhaustion it forces needs-attention.
- Assert `verify` is still run and is **never replaced** by the model review for
  code (the deterministic floor is intact).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** this PRD puts a model in the
  merge/quality decision (the trust boundary, §8) and adds an auto-merge policy —
  security/judgement-sensitive surface a human must drive the SLICING of. Per-slice
  gates: the pure verdict-routing + toggle-resolution + "post via seam" wiring is
  agent-buildable; anything that decides auto-merge policy or touches the §8
  determinism boundary leans `humanOnly`.
- **`needsAnswers`: CLEARED 2026-06-06 (batch-qa round 2) — all four resolved:**
  - **Context isolation — RESOLVED.** A **fresh-context** reviewer is the floor
    (a cold read; the `review` skill already insists on this) — enough for now.
    No different model is MANDATED by default, BUT the `review` step's model is
    **configurable specifically for reviews** (a per-repo `review` model override,
    already staged in `execution-substrate-decisions.md` §13) for opt-in stronger
    de-correlation. So: fresh context + adversarial reframe always; review-model
    override available per repo.
  - **Role vs grilling — RESOLVED: SAME STEP.** One `review` role/skill; "grilling"
    is review with the adversarial reframe dialed up, NOT a second role/seam.
  - **Iteration bound — RESOLVED.** `reviewMaxRounds` per-repo (resolved flag >
    per-repo > global > built-in default); on exhaustion **ERROR OUT** and force
    `needs-attention/` (never silently merge or loop) — matches the Testing
    Decisions `reviewMaxRounds` bullet.
  - **Auto-merge trust model — RESOLVED (round 2): `autoMerge` keys on PER-REPO
    POLICY ONLY.** A repo opts in (`reviewPr: on` + `autoMerge: on`, resolved
    flag > per-repo > global > default-off); on an `approve` verdict the work
    merges; any other verdict never does. **Author-trust is OUT OF SCOPE for the
    `do`/review gate** — on the `do` path the author IS the operator who ran the
    command, so there is no untrusted author to gate on. The author-association /
    request-channel trust resolver is a **CI / issue-front-door concern only**
    (it exists because an untrusted *issue author* can trigger work) and stays
    specced in `issue-intake`, NOT here. The earlier "SAME shared primitive as
    issue-intake" coupling is **withdrawn** (2026-06-06): they are different
    concerns — `review`'s merge = repo policy; `issue-intake`'s author-trust = how
    CI surfaces an untrusted trigger. Decoupled.

### Slice-readiness notes (resolved 2026-06-06, batch-qa round 2)

- **DEPENDENCY DIRECTION CORRECTED — `review` does NOT depend on `runner-in-ci`;
  CI depends on `review`.** The review GATE lives on **`do`** (the per-repo
  in-place worker, which exists and runs on the laptop today): `do` runs `verify`
  then the review step, and routes a `block` through the SAME needs-attention
  surface seam the gate-fail path already uses. **CI is merely a CALLER of `do`**
  (`runner-in-ci` wires `do` into GitHub Actions), so CI INHERITS the review gate
  by invoking `do` — review must NOT wait on CI. The stale `sliceAfter:
  runner-in-ci` (which implied the reverse) has been **dropped**; `runner-in-ci`,
  when sliced, should `blockedBy` the review-gate slice, not the other way round.
- **`review` is slice-ready NOW** (its `sliceAfter` deps `auto-slice` ✓ and
  `review-skill` ✓ are both sliced; the `review` skill itself is built).
- **Scope for the FIRST slice = Gate 2 (PR/code review) on the local `do`
  `--propose`/`--merge` path** — that is the gate guarding `--merge`, the unlock
  for `do -n <N> --merge` on a `reviewPr`-configured repo. **Gate 1 (spec/slice
  review after auto-slicing) is DEFERRED** — it guards the `autoslice-*` chain,
  not the build-backlog drain, so it is a later slice.

### PARTIALLY SLICED 2026-06-06 (NOT fully sliced — no `sliced:` marker yet)

The Gate-2 slice has been emitted: **`work/backlog/review-gate-pr.md`** (the
PR/code review gate on the `do`/`complete` pipeline — run review after `verify`,
approve→integrate, block→needs-attention, per-repo `reviewPr`/`autoMerge`/
`reviewModel`/`reviewMaxRounds`). A supporting slice was also emitted:
**`work/backlog/harness-agent-output.md`** — the harness seam had no channel for an
agent invocation's OUTPUT (only `ok`/liveness/`stderr`), so Gate 2 could not read
the review verdict live. Resolved as **Option C** (2026-06-06, after a pi-vs-opencode
research pass): each adapter extracts the final assistant message at launch and
returns it in `LaunchResult.output` (pi from its `.jsonl`, opencode from its
stdout-stream). `review-gate-pr` FUNCTIONS live (real `reviewPr: on`) only once
`harness-agent-output` lands — though it does not formally `blockedBy` it (the gate
is correct in isolation; the output-read is the activation). See also
`work/observations/pi-harness-jsonl-reliance.md` (the `.jsonl`-scraping debt).

**The SECOND set is now being sliced (2026-06-06):** the **slicer EDIT LOOP**
(insertion point A, Shape 2) on the `do prd:<slug>` path — emitted as
**`work/backlog/slicer-review-edit-loop.md`** (built next, to dogfood slicing the
not-yet-sliced PRDs). See the RESOLVED DESIGN section.

This PRD is **deliberately NOT marked `sliced:`** because further scopes remain as
named follow-ups (all REUSE the one review mechanism — see RESOLVED DESIGN insertion
points):
  - **pre-build slice check (B)** — a slice-review gate inside `do <slug>` before
    building. Later set.
  - **run coverage (D)** — its own set; converge `run` on the `do`/`performComplete`
    path FIRST, then review integrates. Later set.
  - **issue-thread surface (E)** — run the review/edit loop in issue-to-prd /
    issue-intake CI, surfacing findings as comment-thread questions/edits. Later
    set (issue-intake design).
  - **`review-gate-pr-comment`** — post the Gate-2 verdict AS a GitHub PR
    review/comment via a provider seam (does NOT exist in `src/` today). Later.
  - **remove `reviewMaxRounds` from the Gate-2 path** (orphan; the loop owns
    `maxReview`) — cleanup, later.
Add the `sliced:` marker (and the one-time PRD trim) only once these are sliced.
Until then this PRD stays the source for them.

## Out of Scope

- The auto-slicer itself (that is `auto-slice`; this PRD adds the review STEP that
  gates its output).
- The CI packaging that runs these gates headless (that is `runner-in-ci`'s
  `install-ci`; this PRD defines the gate, not its CI wiring).
- Replacing `verify` (never — review is ON TOP of the deterministic floor, §8).
- Issue-front-door author-trust policy (that is `issue-intake`). **DECOUPLED
  2026-06-06:** the earlier "the two SHARE a trust primitive" is WITHDRAWN —
  `review`'s `autoMerge` keys on per-repo policy only; author-association /
  request-channel trust is a CI / issue-front-door concern, specced in
  `issue-intake`, not shared with the `do`/review gate.
- Non-GitHub review providers (GitHub adapter first; the seam allows others later).

## Further Notes

- The review PROTOCOL (the ordered angles + the destination check) and the
  empirical case for multiple INDEPENDENT passes (M×N: N angle-passes within one
  context, M fresh-context reviewers) live in
  `work/ideas/review-gate-default-for-autoslicing.md`. Carry that protocol into the
  `review` skill verbatim; do not re-derive it here.
- Complements `autoslice-confidence` (the slicer's SELF-confidence check): review
  is the INDEPENDENT second opinion a self-check cannot be.
- ~~The PR-review/auto-merge author-trust question is deliberately shared with
  `issue-to-slices`~~ — **WITHDRAWN 2026-06-06.** On the `do` path the author is
  the operator who ran the command (no untrusted author), so `autoMerge` is
  repo-policy-only. Author-trust matters solely where an untrusted issue author
  can trigger work — a CI/`issue-intake` concern, decoupled from this gate.

---
title: A review gate (a self-grilling STEP) — default-on for auto-slicing, where there is no verify floor
slug: review-gate-default-for-autoslicing
type: idea
status: incubating
---

# Review gate as a self-grilling STEP — default-on for auto-slicing

> Captured 2026-06-05 from the phase-2 command-surface slicing conversation. This
> is a proposed shaping for the (not-yet-written) **review-gate** PRD. It is
> SEPARATE from the phase-2 slicing work; recorded here so it is not lost. It
> activates the **review role the substrate ADR already reserved**:
> `docs/adr/execution-substrate-decisions.md` §13 \u2014 *"Per-ROLE model (build vs
> slice vs review vs grilling) is STAGED, not built now."* This idea is "make the
> `review` role real, starting where it is most needed."

## The gap it closes

The autonomous trust boundary today is **`verify`** (build + test + format \u2014 ADR
\u00a78): a deterministic shell gate that keeps bad CODE out of `done/`. It works
because code changes are testable.

**Auto-slicing has no such floor.** When an agent slices a PRD (`do prd:<slug>` /
the `run`/`do` auto-slice step), the output is **markdown slice files \u2014 no code
changes** \u2014 so `verify` has *nothing to gate* (there is no build/test of "are
these slices well-cut?"). The only current check is the slicer's own
**confidence-check** (`autoslice-confidence`): the same model judging its own
output in the same context. That is necessary but weak \u2014 a model rubber-stamping
its own decomposition.

So: **the one autonomous output with no deterministic gate is exactly the one that
should get a review gate by default.**

## The proposal

- **A review gate that is a distinct STEP, not a prompt instruction.** A separate
  review invocation (its own model call / role \u2014 the `review` and/or `grilling`
  role from \u00a713; ideally a fresh or differently-framed context) takes the proposed
  output and must produce a VERDICT: approve, or route-to-`needs-attention` with
  specific findings. It iterates adversarially \u2014 "attack these slices: granularity?
  dependency order? gate correctness? drift vs current code/ADRs? a missed seam?"
  \u2014 the same shape as a human grilling pass.
- **A STEP beats a "review yourself" prompt** (though a prompt is fine ON TOP, not
  INSTEAD): a step is an enforced phase with its own invocation, an adversarial
  framing, and a pass/fail that can gate. A prompt is advisory and runs in the same
  context that produced the work \u2014 prone to self-rubber-stamping. (Distinct from the
  build/slice agent, like the conflict-`resolve` agent the substrate ADR §10 already
  anticipates.)
- **Default-ON for slicing; opt-in for code.** Clean policy: **`verify` is the
  floor for code (review optional on top); review is the DEFAULT gate for slicing
  (no verify floor exists there).** One review-gate mechanism, two defaults keyed on
  "is there a deterministic gate underneath?"
- **Verdict routing reuses the existing seam.** An un-approved review routes the
  PRD/slices to `needs-attention/` (with the findings as the reason) via the ledger
  write seam's needs-attention transition \u2014 the same mechanism every other stuck
  outcome uses (ADR §12). No new surfacing.

## Why we believe multiple/independent review passes are worth it

Direct evidence from the conversation that produced this note: re-grilling the
phase-2 slices across **five separate passes** found ~25 real defects \u2014 a missing
PRD reader, a bare-mirror read gap, a lost-edit, a half-removed `claimedBy`
concept, an autonomous-vs-human failure-surfacing divergence, a parallel-claim
conflict on one command's grammar. A SINGLE "review it" pass would have shipped
most of them. Independent, adversarial, repeated review demonstrably catches what
one pass (and especially self-review-in-context) misses.

**The crucial empirical findings about the PROTOCOL (not just "review more"):**

1. **Each pass must take a DIFFERENT ANGLE, or it stops finding things.** The
   defect count tapered (5 / 8 / 8 / 2 / 0-defects-but-verified) precisely because
   later passes deliberately changed the lens; re-running the SAME lens converges
   fast on nothing. The angles that each found a distinct class of defect:
   - **per-claim verification** — every concrete claim (symbol, path, function
     signature, "reuse X") checked against the ACTUAL code (caught ghost paths,
     wrong module homes, "reuse X" where X is private / wrongly-shaped).
   - **"cleanup or behaviour?"** — anything framed as dead-code removal checked for
     hidden live behaviour (caught `--by` feeding the claim commit + read back).
   - **cross-slice composition** — do the slices COMPOSE? handoffs (one slice ships
     a stub another fills), shared helpers with no owner, two siblings editing one
     command's grammar in parallel, one slice deleting another's live tooling.
   - **destination completeness** — the final move below.
2. **A SECOND identical error/finding is a SIGNAL, not noise.** (Meta, this very
   session: the reviewer repeatedly mis-emitted a tool call and normalised it
   instead of stopping — see
   `work/observations/agent-skipped-edit-skill-repeated-stray-key.md`.) Treat "I've
   seen this shape before" as a trigger to generalise the fix, not patch instances.
3. **Re-read what actually LANDED after each edit — do not trust intent.** One pass
   found an earlier pass's edit had silently failed to apply (a botched retry),
   leaving a slice internally contradictory. Verify against the committed artifact,
   not memory of what you changed.

So the gate encodes: separate context, adversarial framing, a SEQUENCE of distinct
angles, and re-reading the artifact between rounds — not merely "run it N times."

## The review PROTOCOL — a sequence of angles ENDING in the destination check

The review STEP should run ordered adversarial lenses (each its own framing; stop
when a full pass finds nothing NEW) and — critically — **finish with a destination
check**:

1. **Claim-vs-code** — verify every concrete reference against real code.
2. **Cleanup-vs-behaviour** — check anything framed as removal/no-op for hidden
   live behaviour.
3. **Cross-slice composition** — handoffs, shared-helper ownership, parallel-edit
   conflicts on shared files/commands, cross-slice side-effects.
4. **THE FINAL MOVE — destination / PRD-goal achievement:** *"if every slice is
   built exactly as written, do we END UP WITH the system the PRD/ADR describes?"*
   Distinct from per-slice correctness, and the highest-value final check. Done by:
   - taking the PRD/ADR end-state surface as the spec and **mapping every promised
     element to a delivering slice** (a hole = an element no slice delivers);
   - confirming **coverage is complete + non-duplicated** (every user story covered
     once);
   - auditing the **deletion sweep** — a new system also means the OLD surface is
     GONE; every removal owned by exactly one slice, none unowned/double-owned;
   - checking for **orphans** (a slice delivering something the end-state doesn't
     need) and that assumed-pre-existing foundations actually exist;
   - confirming **deliberate non-deliveries are flagged** as named follow-ups, not
     silently missing.
   In this session this final pass found ZERO new defects but *verified* the slices
   compose into the ADR end-state — which is the gate's most important output:
   **"approve" must mean "provably reaches the PRD goal," not just "each piece looks
   fine."** For an auto-slicer with no human, this destination check is the
   strongest signal a decomposition is trustworthy — or, if it finds a hole, the
   most important thing to route to `needs-attention`.

## Open questions (for the PRD)

- **Role/model:** does review get its own `review` model override (\u00a713 staged it),
  and is "grilling" a distinct role from "review" or the same step with an
  adversarial prompt?
- **Context isolation:** how separate must the review context be from the producing
  context to avoid rubber-stamping (fresh subagent? different model? just a
  hard adversarial reframe)? Cheapest thing that actually de-correlates the verdict.
- **Iteration bound:** how many review rounds before forced `needs-attention`
  (avoid an infinite review\u2194revise loop with no human)?
- **Scope creep:** does the review gate also apply (opt-in) to CODE on top of
  `verify` (the original review-PRD intent), and is THAT the same mechanism? (This
  idea says yes \u2014 one mechanism, default-on for slicing, opt-in for code.)
- **Determinism boundary (\u00a78 tension):** `verify` is deliberately a dumb,
  model-free shell gate to keep an LLM out of the trust boundary. A review gate
  PUTS a model in the boundary \u2014 acceptable for slicing (there is no deterministic
  alternative; the output is prose), but the PRD must be explicit that this is a
  judgement gate, not a determinism gate, and never silently replaces `verify` for
  code.

## Relation to other work

- **Activates** `execution-substrate-decisions.md` §13's staged `review`/`grilling`
  role (and would add a `review` model override there, resolved per-repo).
- **Complements** `autoslice-confidence` (the slicer's self-confidence check):
  review is the INDEPENDENT second opinion the confidence-check cannot be.
- **NOT part of** the phase-2 command-surface build (`command-surface-phase-2`);
  this is its own future PRD.

## Update (2026-06-06) — a SECOND session confirms it; sharper framing + new config axes

A second long build/dogfood session (session-path-pi-default + do-remote planning)
independently reproduced the core finding — strengthening the case (and, per this
file's own rule #2, "a second instance is a signal, not noise" → promote-to-PRD
when autonomy paths are close).

New/sharper points from that session:

1. **Defects concentrate in SLICING, not implementation (the sharper
   justification).** Original motivation: "auto-slicing has no `verify` floor."
   Stronger, observed: across the session, the bugs were overwhelmingly in the
   SLICES/SPECS, not the agents' code — the session-path slice took FOUR review
   passes and STILL missed test-isolation + a `PI_CODING_AGENT_DIR` product gap; the
   do-remote slice rested on a stale central premise ("`do` already routes through
   the isolation seam" — it doesn't). The agents BUILT what they were told,
   correctly. So review's highest ROI is on the slice/spec, not the diff — which
   argues for raising the review gate's priority.

2. **`needsAnswers` is the UNIFYING lever (producer + reviewer, one signal).** The
   review gate's verdict-routing ("blocking finding → `needsAnswers`/needs-attention
   → human") is the SAME signal a humble producer raises up front. So: (a) a
   producer-side NUDGE — slicer/agent should reach for `needsAnswers` liberally when
   unsure, not guess (shipped now as a prompt-protocol change: `to-slices` SKILL +
   `CLAIM-PROTOCOL.md` wrapper); (b) the review gate is the ENFORCED, adversarial
   version of the same valve. Cheap humility up front + adversarial review after,
   both raising "not autonomous-safe yet." The nudge is the cultural version,
   buildable immediately; the gate is the enforced version (this PRD).

3. **Context isolation resolves to TWO ORTHOGONAL, CONFIGURABLE AXES (not a binary).**
   The open question was "fresh context vs same-context multi-pass." Resolution:
   BOTH, composable as an **M × N** grid —
   - **N = passes within one review (SAME context):** angle-switching passes that
     ACCUMULATE (each sees prior findings + self-reflects). De-correlation by ANGLE.
     (How this session worked; the angle-switch is what finds new defects, not a
     fresh context.)
   - **M = independent reviews (FRESH context each):** separate review sessions,
     each running its own N-pass sweep. De-correlation by CONTEXT (a fresh reviewer
     can't rubber-stamp work it never produced).
   - Degenerate cases recover the simple modes (`M=1` = one multi-pass reviewer;
     `N=1,M=k` = k independent single-pass reviews). The powerful middle (`M>1,N>1`)
     gets BOTH de-correlations. The grid is the config surface — cheap repo
     `M=1,N=2`; high-stakes human-less auto-slice `M=3,N=until-clean`.

4. **Termination = "until no blocking issues" capped by a hard max (both,
   configurable).** Resolves the "iteration bound" open question: stop early when a
   pass finds no NEW blocking issue (the natural terminator — passes taper to zero,
   as observed), with a `reviewMaxRounds` ceiling so it can never loop forever; on
   hitting the cap with unresolved blockers → `needsAnswers` (human). Applies per
   axis (N within a review; M reviews overall).

These refine the eventual PRD; they do not change that this stays a FUTURE PRD
(promote when run/auto-slice autonomy is close). The producer-side `needsAnswers`
nudge (point 2a) is shipped separately now as the cheap, immediate down-payment.

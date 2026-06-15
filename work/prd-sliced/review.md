---
title: review — a model-driven review role, as TWO complementary gates (spec review + PR/code review), each independently on/off; on approve a resolved `merge` lands automatically while `propose` always leaves the merge to a human (Model P)
slug: review
humanOnly: true
sliceAfter: [auto-slice, review-skill]
---

> **SCOPE NARROWED 2026-06-06 — the review PROTOCOL was extracted to its own PRD (`work/prd/review-skill.md`).** This PRD is now ONLY the review **GATES** (the runner machinery): Gate 1 (slice-time), Gate 2 (PR/code), the per-repo toggles, the `--propose` PR arbiter, auto-merge-on-approve, the model override, the §13 role, and the shared trust resolver. The protocol itself — the four adversarial lenses + destination check, realised as a runner-agnostic `review` SKILL that EMITS verdicts (callers route them) — is `review-skill` and must be built FIRST (hence the added `sliceAfter`). Where this PRD's text below describes "the shared protocol (a SKILL)", that content now LIVES in `review-skill.md`; both gates here CONSUME that skill and ROUTE its verdict to `needsAnswers` / `needs-attention` / auto-merge.

> **RESOLVED 2026-06-15 — the `autoMerge` concept-collision is closed in favour of Model P (slice `remove-automerge-merge-means-auto-on-gate-pass`).** There is NO separate `autoMerge` knob. `integration: merge` MEANS "land automatically when the gate passes" (a green `verify`, plus a Gate-2 `approve` if `review` is on); `integration: propose` MEANS "a human merges" (the PR / PR-less checkpoint). The old per-repo `autoMerge`-on-approve policy (and the `merge` + `autoMerge: false` "downgrade to propose" combination) is DELETED — it was redundant with `propose`. Wherever the text below says "`autoMerge` on/off" or "auto-merge the PR on approve", read it as: `merge` IS the auto-land mode, `propose` IS the human checkpoint. `autoMerge` is gone from config/env/flags and a stale key is silently inert.

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`); once sliced, technical detail moves into the slices and durable rationale into `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **Provenance.** This PRD promotes `work/ideas/review-gate-default-for-autoslicing.md` (two independent dogfood sessions reproduced its core finding) AND a maintainer discussion (2026-06-06) that sharpened the framing: there are **two kinds of review gate, complementary, not one mechanism with two defaults**. Read that idea file for the empirical case + the review PROTOCOL; this PRD is the buildable shaping. It **activates** `execution-substrate-decisions.md` §13's staged `review`/`grilling` role (and would add a `review` model override there).

## Problem Statement

Defects in this project concentrate in **slicing/specs**, not the agents' code — the session-path slice took FOUR review passes and still missed a product gap; the do-remote slice rested on a stale central premise. Yet the only automated quality floor today is **`verify`** (a deterministic, model-free shell gate, ADR §8) — which exists for CODE and **does not exist at all for slicing** (slicing emits prose; there is no `pnpm test` for a decomposition). Separately, in real use the maintainer keeps doing the same thing by hand: a `--propose` PR lands, then a human asks an agent to **review the PR** (the multi-angle + destination-check protocol), and merges only if it passes. That manual PR-review wants to be a capability too.

These are **two distinct review gates** (the discussion's key sharpening):

- **Spec/slice review** — gates the _autonomous slicer_, which has NO `verify` floor. Here a model verdict is the ONLY possible gate (the output is prose). This is where review's ROI is highest.
- **PR / code review** — layers _on top of_ `verify` for built work in `--propose` mode. `verify` proves it builds+tests+formats; the PR review is the **judgement** second-opinion (does the diff actually reach the slice's goal, any landmines a human reviewer would flag). It is the **final arbiter of the `--propose` PR**.

**They are complementary, not mutually exclusive, and each is independently on/off.** A repo may run both, either, or neither. They share one **protocol** and one **`review` role/seam**, but differ on the determinism boundary (§8) and on visibility.

## Solution

One **`review` role** (the methodology) realised as a runner-agnostic **skill**, invoked by the runner at two gate points (each a per-repo toggle), with verdicts routed through the EXISTING needs-attention / `needsAnswers` seam.

### The shared protocol (a SKILL — adopt=skill, ADR command-surface §8)

The review PROTOCOL — ordered adversarial lenses ENDING in a destination check — is **methodology, not execution**, so it is a `review` **skill** (tool-agnostic, like `to-slices`/`to-prd`): (1) claim-vs-code, (2) cleanup-vs-behaviour, (3) cross-slice composition, (4) **the destination check** ("if built/sliced exactly as written, do we reach the PRD/ADR goal?"). The skill is the single source of the protocol; both gates run the SAME skill. (Full protocol + the empirical case for multiple independent passes live in the idea file; do not duplicate here.)

### RESOLVED DESIGN (2026-06-06 grilling pass) — THREE concepts, ONE mechanism, MANY insertion points

> This section is the authoritative resolved shaping; where older text below ("Gate 1 / Gate 2", the idea file's "one-mechanism-two-defaults") conflicts, THIS wins. Source: `work/findings/review-gate-vs-slicer-edit-loop.md` + `work/findings/run-and-do-have-separate-integrate-paths.md` + the idea file's M×N.

The review PROTOCOL (the ordered adversarial lenses + the destination/goal check) is ONE methodology (the `review` skill, already built — `done/review-skill.md`). It is consumed in TWO operational SHAPES, and plugged in at several INSERTION POINTS:

**Shape 1 — the review GATE (one-shot, terminal: approve / block).**

- A single reviewer invocation → verdict. approve ⇒ proceed; block ⇒ route to `needsAnswers` / `needs-attention` (the existing seam). NOT a loop — **no `reviewMaxRounds` on a gate** (the rounds knob on the built Gate-2 path is an orphan from a miscommunication — see `work/observations/reviewmaxrounds-on-wrong-concept.md`; later removed from the gate).
- The **destination/goal check is a PROMPT-FRAMING ASPECT folded into the single gate pass**, not a separate step: "do these slices / this diff reach the PRD/ADR goal?" is part of the best review prompt, combinable with the other lenses.
- Insertion points (same mechanism, different prompt): post-build impl review (**built — #11/#12**); and, later, the pre-build slice check + the run path (see below).

**Shape 2 — the SLICER EDIT LOOP (NOT a gate — an improver).**

- The observed phenomenon: slices keep IMPROVING when reviewed; findings feed back into EDITS, repeatedly. So slice-generation review is a **review→edit→re-review→ converge** loop, with the goal/destination check INSIDE the loop (it can itself trigger edits — which is why it is a loop, not a terminal gate).
- **Mechanism (resolved Q1, RECONCILED 2026-06-14): a PER-PASS review-edit loop.** Each pass is ONE agent launch that reviews the candidate slice(s), applies its edits to the slice **FILES** (the slicer path) or accumulates them IN MEMORY (the intake path, which must not write `work/backlog/` pre-convergence), and the loop re-launches a fresh pass that sees the EDITED slices. This is the N axis (review->edit->re-review->converge), driven by the runner's `for (pass ...)` loop. The M axis = running that loop again in a wholly fresh context for de-correlation. So the M x N grid = "run the (review+edit) per-pass loop N passes deep, M times." Degenerate `M=1,N=2` = cheap; `M=k` = k independent loops. The ONLY built loop (`src/slicer-review-loop.ts` `runOneExecution`, via slice `slicer-review-edit-loop`; intake's variant via PR #62 `intake-lone-slice-bounded-internal-review`) IS this per-pass model, and it is the ACCEPTED end state.

  > **NOTE (reconciled 2026-06-14).** An earlier draft of this section had a contradictory "SINGLE context" headline (one launch looping internally, in-memory accumulation) over a per-pass operative spec. That contradiction is resolved IN FAVOUR of the per-pass model above (which is what was built and is intended). The single-context variant (one launch, internal multipass, in-context accumulation) was the ORIGINAL idea and is genuinely different + potentially cheaper for some contexts; it is deferred, NOT discarded, and parked as an incubating idea for a future revisit: `work/ideas/single-context-review-edit-loop.md`. Full adjudication: `work/findings/review-edit-loop-single-context-is-unbuilt-aspiration-vs-per-pass-disk-impl.md`. Sibling fresh-context M-layer idea: `work/ideas/lone-slice-review-fresh-context-m-layer.md`.

- **Termination (resolved Q2):** natural terminator = a pass finds no NEW blocking issue; `slicerLoopMax` is the HARD CAP (per-repo configurable, flag `--slicer-loop-max` > env > per-repo > global, cheap default). **On reaching `slicerLoopMax` with unresolved blockers, the slice(s) are REJECTED as `needsAnswers`** (the verdict sink below). `slicerLoopMax` lives HERE (the loop, the `--slicer-loop*` family), never on the gate.
- **Verdict routing (the loop's sink) = the needsAnswers / needs-attention routing** (the outcome distinction the loop OWNS): (a) a specific uncertain slice → emit with `needsAnswers: true` + questions in its body; (b) the whole decomposition unclear / `slicerLoopMax` exhausted → route the PRD to `needs-attention/` with the questions, emit no guessed slices. Keeping this routing IN the loop slice is why the slice reads coherently: the loop produces the verdict AND owns the three outcomes (converge→land / uncertain-slice→needsAnswers / decomposition-unclear→ PRD-to-needs-attention).

**Relation to `autoslice-confidence` (resolved Q4 → decision B, 2026-06-06): FOLD + DELETE.** `autoslice-confidence` bundled (1) a one-shot self-confidence JUDGEMENT — SUPERSEDED by the edit loop (an INDEPENDENT adversarial pass is the confidence mechanism a self-check cannot be); and (2) the needsAnswers / needs-attention ROUTING fallbacks — LOAD-BEARING. **Decision B (chosen for coherence — the routing belongs with the loop that produces the verdicts): `slicer-review-edit-loop` FOLDS IN the routing and `autoslice-confidence` is DELETED**, its 4 references reconciled to point at the loop (done 2026-06-06, at slice-authoring time — the build agent never touches sibling slices). The routing behaviour is preserved IN the loop slice; only the redundant self-check concept is gone.

**Insertion points (the mechanism is defined ONCE, consumed at each):**

- **(A) slice-generation** — the SLICER EDIT LOOP on the `do prd:<slug>` path. **THE FIRST SET (built now, to dogfood slicing non-yet-sliced PRDs).**
- **(B) pre-build slice check** — a slice-review (Shape-1 gate, slice-framed prompt) INSIDE `do <slug>` BEFORE the agent builds, so a slice that slipped through with a missed judgement is caught/refined before implementation. **Later set.**
- **(C) post-build impl review** — Gate 2. **Built (#11/#12).**
- **(D) run coverage** — `run` has a SEPARATE integrate path and does NOT inherit the gate today (`work/findings/run-and-do-have-separate-integrate-paths.md`). This is its OWN later set whose FIRST job is to converge `run` on the `do` codepath (`performComplete`); review then integrates naturally, no duplication.
- **(E) issue-thread surface** — issue-to-prd / issue-intake CI runs the SAME review/edit loop on the generated PRD/slices and surfaces findings as QUESTIONS (and edits where sensible) into the ISSUE COMMENT THREAD. **Later set** (belongs in the issue-intake design; reuses this mechanism).

### Gate 1 — SPEC/SLICE review \*(SUPERSEDED by "RESOLVED DESIGN" above — slice-gen

review is the EDIT LOOP (Shape 2, insertion point A), not a one-shot gate. Retained for history.)\*

- Runs as a distinct STEP after the auto-slicer emits slices (NOT a "review yourself" line in the slicer prompt — a separate invocation/role; a prompt instruction may sit ON TOP, not instead).
- **Default ON for slicing** — there is no `verify` floor there, so review is the only gate; for an autonomous slicer with no human, the destination check is the strongest trust signal a decomposition is sound.
- **Verdict routing reuses the existing seam:** a blocking finding sets the PRD/slice `needsAnswers` (or routes the offending slice to `needs-attention`) — the same valve the producer's own humility-check uses (`needsAnswers` is the unifying lever: producer + reviewer, one signal). An `approve` lets the slices land claimable.

### Gate 2 — PR / CODE review (the final arbiter in `--propose`)

- Runs as a CI step (and a local command) when a **work PR** is opened by `do --propose` / `complete --propose`. It does NOT replace `verify` — `verify` ran first (the deterministic floor); this is the judgement second-opinion ON TOP.
- **It is the FINAL ARBITER of the `--propose` PR** and is **more VISIBLE than Gate 1**: its output is posted **as a PR review/comment** (via the provider seam), so a human sees the reasoning on the PR itself — unlike the spec gate, which acts inside the slicing pipeline.
- **Auto-land is a property of the integration MODE (Model P), not a separate knob.** On an `approve`, a resolved `integration: merge` lands automatically; `integration: propose` always leaves the merge to a human (the PR / PR-less checkpoint). A non-approve verdict NEVER lands and routes to needs-attention / leaves the PR for a human. (`merge`/`propose` resolve flag > env > per-repo > global > built-in default, like `integration`.)
- **Determinism boundary (§8), explicit:** putting a model in the merge decision is a **judgement gate, not a determinism gate**. It is acceptable ON TOP of `verify` (never silently replacing it) and only lands on an `approve` under `integration: merge`. `verify` remains the non-skippable deterministic floor.

### Both gates: one role, two toggles, independent

- `reviewSpec` (Gate 1) and `review` (Gate 2) are **independent per-repo toggles** (each on/off), resolved like other policies. Gate 1 defaults ON (slicing has no other floor); Gate 2 defaults OFF (it adds a model to the merge path — opt-in). Whether an `approve` lands automatically is the `integration` MODE (`merge` lands, `propose` waits for a human), NOT a separate sub-policy.
- Both invoke the same `review` skill via the §13 role; both may use the staged per-repo `review` **model override** (a cheaper/different model than the builder, for de-correlation).

## User Stories

1. As the maintainer, I want an automatic **spec review** after auto-slicing (default on), because slicing has no `verify` floor and that is where defects concentrate, so that a bad decomposition is caught before any slice is claimed.
2. As the maintainer, I want the spec reviewer's blocking findings to route through the SAME `needsAnswers`/needs-attention seam the producer uses, so that there is one verdict valve, not a new surfacing mechanism.
3. As the maintainer, I want an automatic **PR/code review** on `--propose` work PRs (opt-in), layered ON TOP of `verify`, posted AS a PR comment/review so it is visible, so that I get the second-opinion I currently request by hand.
4. As the maintainer, I want **`integration: merge` to land an approved item automatically** while **`integration: propose` always waits for me**, so that trusted/low-risk repos pick auto-landing by choosing the mode (not a second knob), and everything else stays a human checkpoint.
5. As the maintainer, I want spec review and PR review to be **independently on/off** (complementary, not coupled; either, both, or neither), so that I can adopt them at my own pace per repo.
6. As the maintainer, I want both gates to run the **same review protocol** (the angle sequence + destination check) from ONE `review` skill, and to optionally use a per-repo `review` model override, so the methodology lives in one place and the verdict can be de-correlated from the producer.
7. As the maintainer, I want `verify` to stay the **non-skippable deterministic floor** and the model review to be an explicit **judgement** gate on top (never silently replacing `verify` for code), so the trust boundary (§8) is preserved.

## Implementation Decisions

(From the idea file + the 2026-06-06 discussion — do not relitigate.)

- **Two complementary gates, one role.** Spec review and PR/code review are distinct gates (different determinism properties, different visibility), each independently toggled, sharing one `review` skill + the §13 role. NOT "one mechanism with two defaults."
- **Protocol = skill; running it + posting/merging = command/runner.** The angle sequence + destination check is a runner-agnostic `review` skill (adopt=skill). Invoking it at a gate, posting the PR comment via the provider seam, and the auto-merge decision are execution (the runner/command).
- **PR review is the final arbiter in `--propose`, and more visible** (posted on the PR). `verify` runs first; review layers on top; neither replaces the other.
- **Auto-land is the `integration` MODE, not a separate `autoMerge` knob (Model P).** `merge` lands an `approve` automatically; `propose` always leaves the merge to a human. Only an `approve` lands under `merge`; any other verdict never does.
- **Verdict routing reuses the existing seam** (blocking → `needsAnswers` / needs-attention). No new surfacing mechanism, no labels (ADR §12).
- **Determinism boundary explicit (§8):** review is a judgement gate ON TOP of `verify`; `verify` stays the non-skippable model-free floor for code. For slicing there is no `verify`, so the model IS the gate — acceptable because the output is prose and there is no deterministic alternative.
- **Uses the provider seam, never `gh` directly** for posting reviews/comments and merging — same discipline as the harness/integration seams (GitHub adapter first).

## Testing Decisions

- **Stub the review role/agent and the provider seam** (no network, no real model, no real GitHub). Test the GATE WIRING + verdict routing as pure logic: an `approve` lets slices land / lands a resolved `merge` (a `propose` stays a human checkpoint); a blocking verdict sets `needsAnswers` / routes to needs-attention and NEVER merges.
- Test the two toggles are **independent** (spec-on/PR-off, PR-on/spec-off, both, neither) and that `integration` (`merge` vs `propose`) resolution follows flag > env > per-repo > global > default.
- Test that PR review is posted via the seam's review/comment method and that a non-GitHub arbiter **degrades cleanly** (review still runs; just no PR comment / no auto-merge) — mirroring the integration seam's `none` degradation.
- Test the **iteration bound** (`reviewMaxRounds`): a revise↔review loop can never run forever; on exhaustion it forces needs-attention.
- Assert `verify` is still run and is **never replaced** by the model review for code (the deterministic floor is intact).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** this PRD puts a model in the merge/quality decision (the trust boundary, §8) — security/judgement-sensitive surface a human must drive the SLICING of. Per-slice gates: the pure verdict-routing + toggle-resolution + "post via seam" wiring is agent-buildable; anything that touches the §8 determinism boundary leans `humanOnly`.
- **`needsAnswers`: CLEARED 2026-06-06 (batch-qa round 2) — all four resolved:**
  - **Context isolation — RESOLVED.** A **fresh-context** reviewer is the floor (a cold read; the `review` skill already insists on this) — enough for now. No different model is MANDATED by default, BUT the `review` step's model is **configurable specifically for reviews** (a per-repo `review` model override, already staged in `execution-substrate-decisions.md` §13) for opt-in stronger de-correlation. So: fresh context + adversarial reframe always; review-model override available per repo.
  - **Role vs grilling — RESOLVED: SAME STEP.** One `review` role/skill; "grilling" is review with the adversarial reframe dialed up, NOT a second role/seam.
  - **Iteration bound — RESOLVED.** `reviewMaxRounds` per-repo (resolved flag > per-repo > global > built-in default); on exhaustion **ERROR OUT** and force `needs-attention/` (never silently merge or loop) — matches the Testing Decisions `reviewMaxRounds` bullet.
  - **Auto-land trust model — RESOLVED (round 2; re-resolved 2026-06-15 to Model P).** Auto-land is the `integration` MODE: a repo picks `integration: merge` (resolved flag > env > per-repo > global > default) and on an `approve` the work lands; `integration: propose` always leaves the merge to a human. (Historically this was a separate per-repo `autoMerge` knob; that knob is DELETED — see the RESOLVED banner at the top.) Any non-approve verdict never lands. **Author-trust is OUT OF SCOPE for the `do`/review gate** — on the `do` path the author IS the operator who ran the command, so there is no untrusted author to gate on. The author-association / request-channel trust resolver is a **CI / issue-front-door concern only** (it exists because an untrusted _issue author_ can trigger work) and stays specced in `issue-intake`, NOT here. The earlier "SAME shared primitive as issue-intake" coupling is **withdrawn** (2026-06-06): they are different concerns — `review`'s merge = repo policy; `issue-intake`'s author-trust = how CI surfaces an untrusted trigger. Decoupled.

### Slice-readiness notes (resolved 2026-06-06, batch-qa round 2)

- **DEPENDENCY DIRECTION CORRECTED — `review` does NOT depend on `runner-in-ci`; CI depends on `review`.** The review GATE lives on **`do`** (the per-repo in-place worker, which exists and runs on the laptop today): `do` runs `verify` then the review step, and routes a `block` through the SAME needs-attention surface seam the gate-fail path already uses. **CI is merely a CALLER of `do`** (`runner-in-ci` wires `do` into GitHub Actions), so CI INHERITS the review gate by invoking `do` — review must NOT wait on CI. The stale `sliceAfter: runner-in-ci` (which implied the reverse) has been **dropped**; `runner-in-ci`, when sliced, should `blockedBy` the review-gate slice, not the other way round.
- **`review` is slice-ready NOW** (its `sliceAfter` deps `auto-slice` ✓ and `review-skill` ✓ are both sliced; the `review` skill itself is built).
- **Scope for the FIRST slice = Gate 2 (PR/code review) on the local `do` `--propose`/`--merge` path** — that is the gate guarding `--merge`, the unlock for `do -n <N> --merge` on a `review`-configured repo. **Gate 1 (spec/slice review after auto-slicing) is DEFERRED** — it guards the `autoslice-*` chain, not the build-backlog drain, so it is a later slice.

### PARTIALLY SLICED 2026-06-06 (NOT fully sliced — no `sliced:` marker yet)

The Gate-2 slice has been emitted: **`work/backlog/review-gate-pr.md`** (the PR/code review gate on the `do`/`complete` pipeline — run review after `verify`, approve→integrate, block→needs-attention, per-repo `review`/`autoMerge`/ `reviewModel`/`reviewMaxRounds`). A supporting slice was also emitted: **`work/backlog/harness-agent-output.md`** — the harness seam had no channel for an agent invocation's OUTPUT (only `ok`/liveness/`stderr`), so Gate 2 could not read the review verdict live. Resolved as **Option C** (2026-06-06, after a pi-vs-opencode research pass): each adapter extracts the final assistant message at launch and returns it in `LaunchResult.output` (pi from its `.jsonl`, opencode from its stdout-stream). `review-gate-pr` FUNCTIONS live (real `review: on`) only once `harness-agent-output` lands — though it does not formally `blockedBy` it (the gate is correct in isolation; the output-read is the activation). See also `work/observations/pi-harness-jsonl-reliance.md` (the `.jsonl`-scraping debt).

**The SECOND set is now being sliced (2026-06-06):** the **slicer EDIT LOOP** (insertion point A, Shape 2) on the `do prd:<slug>` path — emitted as **`work/backlog/slicer-review-edit-loop.md`** (built next, to dogfood slicing the not-yet-sliced PRDs). See the RESOLVED DESIGN section.

> **AT REST 2026-06-12 — this PRD now resides in `work/prd-sliced/` (its sliced resting state).** Its CORE is built: the slicer edit loop (A, `done/slicer-review-edit-loop.md`), Gate 2 PR review (C, `done/review-gate-pr.md`), the PR-comment audit trail (`done/review-gate-pr-comment.md` + its blocker `done/propose-pr-body.md`), run coverage (D, `done/run-through-integration-core.md`), and the intake variant (`done/intake-lone-slice-bounded-internal-review.md`). `autoslice-confidence` was folded in + deleted. The remaining named follow-ups have each been CARRIED to a durable owner, so this PRD no longer needs to be held open for them:

- **pre-build slice check (B)** — CARRIED to `work/ideas/pre-build-slice-review-gate.md` (a speculative insertion point, parked with its YAGNI rationale + promote trigger; it is NOT owned by this PRD's resting).
- **run coverage (D)** — BUILT: `work/done/run-through-integration-core.md` threaded the review gate into `run` and converged it on `performIntegration`. No longer pending.
- **issue-thread surface (E)** — CARRIED to `work/prd/runner-in-ci.md` (its rightful owner: an issue-front-door delivery surface that reuses this PRD's review machinery). Sliced when `runner-in-ci` is sliced.
- **remove `reviewMaxRounds` from the Gate-2 path** (the orphan rounds loop in `integration-core.ts`; the slicer loop owns `slicerLoopMax`) — ON MAINTAINER HOLD, recorded in `work/observations/reviewmaxrounds-on-wrong-concept.md` (re-verified live): remove it only when a real builder-revise step is designed/built (a MOVE + reframe, never a deletion-in-isolation). That standing observation, not this PRD, holds the signal.

## Out of Scope

- The auto-slicer itself (that is `auto-slice`; this PRD adds the review STEP that gates its output).
- The CI packaging that runs these gates headless (that is `runner-in-ci`'s `install-ci`; this PRD defines the gate, not its CI wiring).
- Replacing `verify` (never — review is ON TOP of the deterministic floor, §8).
- Issue-front-door author-trust policy (that is `issue-intake`). **DECOUPLED 2026-06-06:** the earlier "the two SHARE a trust primitive" is WITHDRAWN — `review`'s `autoMerge` keys on per-repo policy only; author-association / request-channel trust is a CI / issue-front-door concern, specced in `issue-intake`, not shared with the `do`/review gate.
- Non-GitHub review providers (GitHub adapter first; the seam allows others later).

## Further Notes

- The review PROTOCOL (the ordered angles + the destination check) and the empirical case for multiple INDEPENDENT passes (M×N: N angle-passes within one context, M fresh-context reviewers) live in `work/ideas/review-gate-default-for-autoslicing.md`. Carry that protocol into the `review` skill verbatim; do not re-derive it here.
- SUPERSEDES the former `autoslice-confidence` (the slicer's SELF-confidence check): the slicer edit loop is the INDEPENDENT second opinion a self-check cannot be, and it FOLDS IN that slice's needsAnswers / needs-attention routing (decision B, 2026-06-06). `autoslice-confidence` is deleted; `slicer-review-edit-loop` owns it.
- ~~The PR-review/auto-merge author-trust question is deliberately shared with `issue-to-slices`~~ — **WITHDRAWN 2026-06-06.** On the `do` path the author is the operator who ran the command (no untrusted author), so `autoMerge` is repo-policy-only. Author-trust matters solely where an untrusted issue author can trigger work — a CI/`issue-intake` concern, decoupled from this gate.

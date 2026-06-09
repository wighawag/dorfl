---
title: advance — a question/answer protocol + a generalized "advance any work/ item one lifecycle rung" capability, driven one-shot (do/CI) AND looped (run), human-or-agent per repo-config
slug: advance-loop
sliceAfter: [auto-slice, slicing-coherence]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.
> (The technical-detail sections below are trimmed by `to-slices` once the work
> is sliced — they move into slices/ADRs and this PRD settles to its durable
> framing: Problem / Solution / User Stories / Out of Scope.)
>
> Source: `work/ideas/advance-loop-question-answer-protocol.md` (hardened
> 2026-06-07 by a full grilling pass — every major seam RESOLVED). This PRD is
> the launch snapshot of that idea, written to be **dogfooded by `auto-slice`
> once it lands** — hence non-`humanOnly` (see Autonomy notes). Names (`advance`,
> `obs:`, the repo-config keys) are taken as proposed; the slicer/ADRs may finalise.
>
> **PRECURSOR NOTE (2026-06-08).** A new precursor PRD `work/prd/slicing-coherence.md`
> now owns the slicing-path coherence work this PRD was implicitly assuming: slice
> output integrating through `performIntegration` (so `do prd:` honors
> `--propose`/`--merge` — needed for US #27's propose-mode PR matrix), the slice
> review model mirroring build (improver loop with a whole-SET prompt + a
> fresh-context acceptance gate), and the PRD folder lifecycle
> `prd/`→`slicing/`→`prd-sliced/` (folder = source of truth; `sliced:` demoted to a
> derived copy then removed). `sliceAfter` now includes `slicing-coherence`: it must
> be sliced + built FIRST so this PRD's slice rung is just "call the shared `do prd:`
> machinery" over the integrate back-half it assumes. Confirmed there: the slicing
> LOCK stays on `main` (visibility ledger) and `advancing/` stays a FOLDER borrow
> (US #19) — do NOT move either to a branch ref. See
> `work/observations/slice-output-bypasses-integration-vs-build.md` and the
> `## DECIDED 2026-06-08` section of
> `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`.
>
> **PRECURSOR-LANDED UPDATE (2026-06-09, planted by an `orchestrate` sitting —
> SUPERSEDES the "must be sliced + built FIRST" framing of the PRECURSOR NOTE
> above for the slicer's purposes).** `slicing-coherence` is now DONE: it RESIDES in
> `work/prd-sliced/` (the very folder lifecycle it created) and ALL its slices are in
> `work/done/`. So this PRD's `sliceAfter: [auto-slice, slicing-coherence]` is
> SATISFIED — the slicer must treat the entire slicing-coherence substrate as PRESENT
> code on `main`, NOT as pending precursor work. Concretely verified on `main`
> (2026-06-09):
> - **`do prd:<slug>` now routes slice output through `performIntegration`** (the
>   keystone `slice-output-through-integration`, `work/done/`): `do prd:` honors
>   `--propose`/`--merge` with arg parity by construction (`do.ts` resolves the
>   integrate-time args ONCE in the shared core). US #27's propose-mode PR matrix is
>   buildable on this TODAY — the slice rung is just "call the shared `do prd:`
>   machinery," exactly as this PRD assumed.
> - **The slice-path review model mirrors build**: the one-shot fresh-context
>   acceptance gate (`slice-acceptance-gate`, slice-SET prompt, NO rounds —
>   does NOT inherit `--review-max-rounds`) AND the `--slicer-loop*` improver-loop
>   family (`slicer-loop-flag-family`: `--slicer-loop`/`--no-slicer-loop`/
>   `--slicer-loop-max`/`--slicer-loop-model`) with the named whole-SET review lens
>   (`slicer-loop-set-lens-prompt`) — all in `work/done/`, all live in
>   `do.ts`/`repo-config.ts`/`integration-core.ts`.
> - **The PRD folder lifecycle `prd/` → `slicing/` → `prd-sliced/` is REAL and the
>   `sliced:` marker is GONE** (`prd-sliced-folder-step-a` + `remove-sliced-marker-step-b`,
>   `work/done/`): folder residence is the SOLE source of truth (`frontmatter.ts`,
>   `select-priority.ts` resolve `sliceAfter` against `prd-sliced/` residence). The
>   tick's PRD slice rung lands the PRD in `prd-sliced/` via the runner-owned release
>   commit — there is no marker to write.
> - **The failure-handling TRIO has LANDED** (`work/done/`, merged 2026-06-09):
>   `failure-cause-classification-model-vs-git-vs-agent` (a stuck item's CAUSE is now
>   classified transient-infra / agent-misbehaved / gate-failed / config-wiring, and
>   `do`+`run` classify the SAME error the SAME way), `needs-attention-routing-resilient-honest-requeue-safe`
>   (needs-attention routing retries pushes with bounded backoff, never crashes the
>   failure handler, reports exactly what landed — surface / branch / PR — and refuses
>   a keep+continue requeue when the work branch is not on the arbiter), and
>   `gate-nit-triage-text-skill-agnostic` (the Gate-2 review-nits generator no longer
>   hardcodes a retiring skill name). The advance tick's "a STOP/failure is a
>   surface-a-question signal, not a build failure" posture should COMPOSE this
>   classified-cause + honest-reporting substrate (a transient-infra cause is a retry/
>   idle, not a needs-design; a gate-failed/agent-misbehaved cause is the surface
>   signal) rather than re-deriving failure classification.
>
> **SUBSTRATE-READINESS NOTE (2026-06-08, planted by an `orchestrate` sitting — read
> before slicing; the 2026-06-09 UPDATE above is the current truth where they differ).**
> The three pieces this PRD declares it REUSES have now LANDED on
> `main`, so the slicer should treat them as PRESENT substrate, not pending work:
> - **The `do`/`run` integrate-path convergence** is DONE — both slices of
>   `run-do-integrate-convergence` (`extract-integration-core`,
>   `run-through-integration-core`) are in `work/done/`; the shared gate→integrate
>   back-half is `src/integration-core.ts` (`performIntegration`). The tick's
>   "execute the build/slice rung" reuses THIS, not `run.ts`/`complete.ts` copies.
> - **The isolation-strategy seam** now has ALL THREE consumers on the one
>   `IsolatedTree` handle: `run` + `do --remote` (already) and in-place `do` (slice
>   `do-run-share-isolation-seam`, built 2026-06-08, in review at PR #37). The tick's
>   "isolation falls out of the seam" claim (User Story 26) is now literally true —
>   the handle-driven post-claim pipeline IS the unit the tick wraps. (If PR #37 has
>   not merged when this PRD is sliced, the in-place consumer may still be a hair
>   behind — confirm `selectIsolationStrategy`/`inPlaceStrategy` has a production
>   consumer in `do.ts` before relying on it.)
> - **The build-agent → runner REPORTING CHANNEL** (slice `agent-stop-signal`,
>   merged 2026-06-08, PR #36) now exists: a hard STOP sentinel routes a drifted item
>   to needs-attention BEFORE the gate, and a soft `## Decisions` block surfaces
>   in-scope decisions for ratification. The advance tick's "never invent an answer /
>   surface judgement" posture should COMPOSE this channel — a rung whose agent
>   STOPs is a surface-a-question signal, not a build failure; the `## Decisions`
>   block is a natural feed into the sidecar's ratification entries. Worth the slicer
>   considering as a reuse, not just the batch-qa rungs.
>   - **EXTEND this channel to agent-authored CAPTURED NOTES (routed here 2026-06-08).**
>     The reporting channel must also cover the runner SCOOPING + REPORTING
>     agent-authored capture-bucket files (`work/observations/*`, `work/findings/*`)
>     the agent writes during a rung — today the `do prd:` runner commits only
>     `work/backlog/*` and DROPS such notes (left untracked), making the autonomous
>     path lossier than a human slicer (see
>     `work/observations/runner-drops-agent-authored-captured-notes-on-slicing-commit.md`).
>     Fix it ONCE here as part of this channel (NOT a standalone slice — that would
>     fork the channel): extend Rule B (the runner scoops + reports the notes) while
>     keeping Rule A (the agent does no git), on BOTH the slice path (`do prd:`) and
>     the build path (`do <slice>`). A captured note is just another thing the agent
>     EMITS that the runner must ROUTE, exactly like the `## Decisions` block.
>
> Note also: this PRD's `advance` is the AUTONOMOUS, file-mediated sibling of the
> `orchestrate` skill (the human-in-the-loop conductor) and the `drive-backlog` skill
> (the build loop). They are designed to converge on the SAME tick contract — keep
> the tick shape here aligned with what those skills actually do by hand.
>
> **FOLD-IN: the mirror-side pool scan (from `do-remote-no-arg-and-remote-autopick`
> part (b), routed here 2026-06-08).** A separate observation requested two
> `do --remote` affordances for an isolated conductor: (a) `do --remote <slug>` with
> no url (isolate-in-place) — sliced standalone as
> `work/backlog/do-isolated-in-place.md` (the maintainer chose `do --isolated`, a
> boolean flag orthogonal to `--remote <url>`, over overloading `--remote`); and
> (b) remote/mirror-side
> AUTO-PICK / `-n` over a hub-mirror pool — DEFERRED HERE on purpose. (b) needs a
> **mirror-side eligible-pool scan**: enumerate eligible slices + sliceable PRDs from
> the BARE hub mirror's `main` (not an in-place checkout), the isolated counterpart
> to `do-autopick`'s in-place pool scan. This PRD's `run` driver ALREADY does
> isolated + parallel auto-pick over exactly such a pool, and its one-shot/CI
> `advance` driver (User Stories 7, 25, 27) wants isolated + SEQUENTIAL selection
> over the SAME pool (`advance --remote -n <x>` / the CI matrix). So the slicer should
> design the **mirror-side pool scan as ONE reusable unit** that BOTH the `run` loop
> driver and the one-shot/CI `advance` driver consume — do NOT let it be invented
> twice (once in a standalone `do --remote -n` slice and again in the advance
> drivers). Concretely: when slicing this PRD, ensure the slice that builds the
> mirror-side eligible-pool enumeration is shared substrate the `-n`/auto-pick rungs
> (both `do` and `advance`, both `run`-loop and one-shot) all call; a standalone
> `do --remote -n` then falls out as a thin caller, not a separate scan. (Note the
> existing inline `-n`×`--remote` REFUSAL in `cli.ts` — it is the placeholder this
> work replaces; the refusal was an un-surfaced decision, now caught by the
> `agent-stop-signal` Decisions channel.)

## Problem Statement

Today the maintainer is the **serialisation point** of the whole `work/` lifecycle.
Three autonomous capabilities already exist independently — the `batch-qa`
step-function (the lifecycle rungs), the `run`/`do` execution machinery (one-shot
tick + loop + isolation + the claim CAS), and the `auto-slice` family (`do prd:<slug>`
generalized `do` beyond building) — but nothing UNIFIES them into a single loop that
drains a populated `work/` toward "all slices built" while keeping the human's only
job "answer questions on my own time."

Concretely, a maintainer with a set of PRDs wants the system to do **every
autonomous rung it can** — triage observations, apply answers, slice ready PRDs,
build ready slices — and to **stop and ask** (never invent an answer) only at the
genuine judgement residue, surfacing those questions as files the human answers
whenever they like. The manual precursor (`batch-qa`) does this by hand in one
sitting; there is no engine that runs the loop autonomously, file-mediated, and safe
under concurrency (a `run` daemon, a CI cron, a human all advancing the same pool).

## Solution

A new lifecycle verb, **`advance`**, that ADVANCES a `work/` item toward "ready" —
doing the autonomous part of each rung and **emitting question files** when it hits
judgement it cannot resolve, then **consuming a human's answers** from those files on
later passes. It is **`batch-qa`'s one-step invariant made autonomous and
file-mediated**, productizing the manual orchestration the way `do`/`run` productized
`ar-run.sh`.

From the user's perspective:

- **`ls work/questions/`** is the live "what needs me?" dashboard — one **sidecar**
  file per item with open questions, in a strict machine-owned format. The human
  answers in-file on their own time; a later `advance` pass applies the answers and
  surfaces the next batch. Throughput = the human's answer rate; everything else is
  autonomous.
- **The command surface** keeps the existing `prefix:arg` slug-namespaces and adds
  `advance` as a **sibling top-level verb** (NOT a `do` subcommand), reusing the same
  shared resolver:

  ```
  do <slug>          # build a ready slice          (bare slug = slice; UNCHANGED)
  do prd:<slug>      # slice a PRD                   (UNCHANGED, existing path)
  advance <slug>         # advance a slice one rung
  advance prd:<slug>     # advance a PRD (apply answers, then the slice rung)
  advance obs:<slug>     # triage an observation
  advance                # advance the eligible set  (like bare `do` autopicks)
  ```

- **`advance` ORCHESTRATES `do`-class rungs** — for a "build this slice" or "slice
  this PRD" rung it invokes the existing `do`/`do prd:` machinery; it does the
  non-agent rungs (triage, answer-apply, surface-question) itself. It is a driver
  layered ON TOP, never a peer that duplicates build/slice.
- **One substrate-agnostic TICK, two drivers.** `advance` is a PURE one-item tick
  (classify → lock → execute, winner-only, never invents an answer). A **one-shot**
  driver (human `do`-style or a CI invocation) runs the tick over named item(s)
  **sequentially**; a **loop** driver (`run` daemon) loops the tick over the eligible
  set with genuine parallelism, each item lock-guarded. `run` ≡ CI, differing only in
  substrate; the tick is the contract.
- **Repo-config gates the autonomy per-action** (not one master knob): the existing
  `allowAgents` (build) and `autoSlice` (slice) plus a new `autoTriage`
  (auto-disposition an observation). Surfacing a question and applying a human's
  answer are ALWAYS allowed. A repo with every flag off still gets the QUESTION LOOP
  (surface + apply) but no autonomous build/slice/triage.
- **No human-answer is ever invented.** The agent surfaces questions and applies the
  human's answers — nothing more. We are not automating answer creation.

This is almost entirely REUSE: the tick/loop split (the `do`/`run` convergence), the
CAS lock kinds + one new `advancing` borrow, the slug-namespace resolver, the
isolation-strategy seam, and the `batch-qa` rungs. The one genuinely-new piece is the
**question/answer sidecar contract**.

## User Stories

1. As the maintainer, I want a single `advance` verb that pushes any `work/` item one
   lifecycle rung toward "ready/built", so that the whole pool drains autonomously
   and my only job is answering questions.
2. As the maintainer, I want `ls work/questions/` to be the always-current "what
   needs me?" dashboard, so that I can see and answer all open judgement on my own
   time without opening each item.
3. As the maintainer, I want the agent to do every autonomous rung it can (triage,
   apply-answers, slice a ready PRD, build a ready slice) and **stop and ask** only at
   genuine judgement, so that I am kept strictly in the judgement loop and nowhere
   else.
4. As the maintainer, I want the agent to **NEVER invent an answer** — only surface
   questions and apply the answers I authored — so that no judgement is ever faked.
5. As the maintainer, I want `advance` to be a **sibling top-level verb** reusing the
   existing `prefix:arg` resolver (`advance <slug>` / `advance prd:` / `advance obs:`
   / bare `advance`), so that the surface stays coherent with `do`/`do prd:` and the
   "bare slug = slice" ergonomic is preserved (no `do` subcommands, no standalone
   `slice` verb).
6. As the maintainer, I want `advance` to **orchestrate** the existing `do`/`do prd:`
   machinery for build/slice rungs (not duplicate them) and to perform the non-agent
   rungs itself, so that there is one build path and one slice path.
7. As the maintainer, I want one substrate-agnostic **tick** that both a one-shot
   driver and a loop driver wrap, so that `run`, CI, and a human one-shot all share
   the exact same contract with no new execution model.
8. As the maintainer, I want a **per-item SIDECAR file** (`work/questions/<type>-<slug>.md`)
   in a strict machine-owned format carrying per-entry answered-state, so that the
   tooling fully owns the Q&A artifact (no fragile round-trip parse of human prose in
   the item body).
9. As the maintainer, I want the sidecar **type-encoded and identity-keyed**
   (`<type>-<slug>`), so that same-slug items across namespaces never collide and the
   sidecar survives the item's `git mv`s between lifecycle folders without a lock-step
   move.
10. As the maintainer, I want the sidecar to be **deleted atomically when the item
    reaches a terminal state** (done / deleted), so that there are no orphan question
    files.
11. As the maintainer, I want applying an answer to mutate the item body AND
    update/remove the sidecar entry in **one commit**, so that I never see "answer
    applied but sidecar still open" (a re-ask) or the reverse.
12. As the maintainer, I want the tick's next action decided by exactly **two
    signals** — the `needsAnswers` flag and the sidecar's answered-state — with no
    third state store, so that classification is deterministic and cheap.
13. As the maintainer, I want a **pending (not-all-answered) sidecar to make the tick
    a clean NO-OP**, so that a `run` daemon never spins hot re-surfacing the same
    question.
14. As the maintainer, I want a **subset of answered entries to SKIP** (I answer all
    before re-analysis), so that the loop never thrashes on a half-answered item.
15. As the maintainer, I want newly-discovered questions **APPENDED** to the sidecar
    (never overwriting answered entries), so that the sidecar becomes the item's full
    Q&A history — the human sees the thread and the machine never re-asks and can
    reason from prior answers.
16. As the maintainer, I want **observation triage question-gated by default** (the
    agent surfaces a promote/keep/delete question and waits), so that "is this worth
    building?" is never decided autonomously.
17. As the maintainer, I want a **conservative auto-disposition exception** (option c,
    high bar — only when a human would not plausibly disagree, e.g. exact-duplicate →
    suggest delete, or unambiguous map onto an existing item), gated by `autoTriage`,
    so that no-question cases don't cost me a needless glance — while the agent NEVER
    auto-deletes a non-duplicate signal and NEVER auto-promotes a judgement call.
18. As the maintainer, I want the tick to **classify cheaply (read-only, no model, no
    lock), THEN take the CAS lock for the classified rung, THEN execute (the expensive
    agent/model work) winner-only**, so that a CAS loser (e.g. a second CI runner)
    backs off having spent ~nothing.
19. As the maintainer, I want **one lock PRIMITIVE** (the existing CAS ledger-write
    seam) with the lock-FOLDER encoding the ACTION and the entry name encoding the
    item IDENTITY, and ONE new action-folder `work/advancing/` for the
    surface/apply/triage borrow (a short borrow shaped like `slicing`, not `claim`),
    so that no new lock semantics are introduced.
20. As the maintainer, I want lock entries **type-encoded** (`<type>-<slug>`, the same
    identity scheme as the sidecar), so that a slice, a PRD, and an observation
    sharing a slug never collide on the CAS ref — and so a PRD may hold an `advancing`
    borrow and later a `slicing` borrow (different actions, different refs, never
    co-held).
21. As the maintainer, I want `needsAnswers` to be the PURE answer-required axis (NOT
    a lock), with the human edit-handshake moving to **taking the `advancing` lock via
    CAS**, so that a human and the autonomous driver contend honestly on the SAME lock
    (superseding the old "flip `needsAnswers` to claim an edit-lock" framing).
22. As the maintainer, I want the lock to be **mandatory for the autonomous driver and
    a no-op formality for a solo human** (no contender), with the per-repo "agents may
    advance here" policy being my signal that a contender may be active, so that the
    common solo case stays simple.
23. As the maintainer, I want every advance rung to **RESPECT the existing per-action
    gates** (build obeys `allowAgents`, slice obeys `autoSlice`, auto-triage obeys
    `autoTriage`; surface + apply always allowed), so that `advance` never bypasses an
    autonomy decision I made.
24. As the maintainer, I want **new-item creation (e.g. observation→promote drafting a
    new backlog slice) routed THROUGH the CAS** keyed on the new item's identity, so
    that the (unlikely) same-slug new-item race is handled with no special case (loser
    fails the CAS and backs off).
25. As the maintainer, I want **`-n x` to be ALWAYS SEQUENTIAL** (a dumb "run the tick
    N times" loop) for both `do -n` and `advance -n`, so that parallelism is NEVER a
    property of `-n` — it comes only from `run` (the concurrent loop) or the CI
    substrate (a matrix of independent jobs).
26. As the maintainer, I want **isolation and chaining to fall out of what exists** —
    isolation = the `isolation-strategy-seam` (worktree locally / fresh CI checkout),
    chaining = the existing rebase-before-integrate (ADR §10) — so that no new
    isolation or chaining machinery is built; a chain conflict routes to
    needs-attention as today.
27. As the maintainer, I want the **GitHub-Actions shape** to be: `propose` mode → a
    MATRIX of independent jobs (one per item, each opens a PR, true parallelism, `-n`
    not even needed); `merge` mode → a SINGLE SEQUENTIAL job (because merge-mode items
    chain via rebase and parallel merge jobs would thrash the main-CAS), so that each
    mode uses the right CI shape.
28. As the maintainer, I want a separate **CI-integration deliverable** (a GitHub
    Actions workflow template, the `install-ci` notion) wiring "on cron /
    on-answer-committed → run the right shape", so that CI adoption is one step and not
    entangled with the tick.
29. As the maintainer, I want an answer to be able to **disposition an item to ANY
    terminal state** (advance-toward-build; out-of-scope → `out-of-scope/`;
    needs-attention → the existing bounce; observation keep/delete), so that no item
    loops forever — it is always progressing, terminal, or idle-pending.
30. As the maintainer, I want a **"keep" / "don't promote" answer recorded as an
    answered entry + a marker on the item** (`triaged:keep`), so that a settled
    observation drops out of the candidate pool and is never re-asked.
31. As the maintainer, I want the loop to **provably drain** (every tick advances
    toward a terminal, surfaces+idles, or no-ops on pending; the candidate pool shrinks
    monotonically as answers arrive and is STABLE when there are none), so that the
    system is calm at rest and converges as I answer.
32. As the maintainer, I want `batch-qa` refocused into **`surface-questions`**
    (GATHER-only, PERSIST-NEVER) — its question-formulation JUDGEMENT survives as a
    skill that EMITS questions and writes nothing (mirroring `review`), while its
    BOUND/APPLY/ITERATE/one-file orchestration is absorbed by the advance engine — so
    that there is ONE question/answer contract and an engine-loaded agent and a
    human-invoked agent behave identically.
33. As the maintainer, I want the advance engine's surface-question rung to spawn a
    fresh-context agent with `surface-questions` loaded, get the questions, and ITSELF
    write them to the sidecar (CAS-atomic), exactly as the review gate uses `review`,
    so that the skill judges and the engine persists.
34. As the maintainer, I want `surface-questions` to remain **human-invokable** for the
    no-runner / by-hand path (persist via `do advance`, or hand-writing the documented
    sidecar format), with **no separate write-skill** added unless hand-writing proves
    annoying, so that the by-hand path stays simple.
35. As the maintainer, I want `to-slices`/`review` to remain **composed BY the rungs**
    (surface/slice) UNCHANGED, so that only `batch-qa`'s orchestration is absorbed and
    the producer/reviewer skills stay the single sources.
36. As the maintainer, I want the **`allowAgents` → `autoBuild` rename SEQUENCED LAST**
    (a clean isolated breaking config migration with an alias/deprecation window, after
    the advance family lands), so that the gate family becomes symmetric
    (`autoBuild`/`autoSlice`/`autoTriage`) without entangling the rename with the
    feature.

### Autonomy notes (the two gate axes)

- **`humanOnly`: OMITTED (DECIDED).** This PRD is **non-`humanOnly`** deliberately:
  it is **intended to be dogfooded by `auto-slice`** once that lands, and a
  `humanOnly` PRD cannot be auto-sliced. This is also HONEST, not merely
  goal-driven: the source idea was hardened by a full grilling pass with **every
  major seam RESOLVED** (command surface, tick/two-driver split, the sidecar keystone
  + its four properties, the deterministic state machine, observation-triage option-c,
  the lock model + the new `advancing` borrow, classify→lock→execute, the per-type
  transitions, the flat per-action gate family, the batch-qa→surface-questions
  refactor, the CI shape, termination). There is no residual judgement requiring a
  human to drive the SLICING — so non-`humanOnly` is correct, not a compromise. (Per
  the contract, the PRD-level flag is disjoint from the emitted slices' gates; the
  slicer judges each slice's gate from its own build-nature. The `autoBuild` rename
  slice in particular is a breaking-config migration the slicer may legitimately mark
  `humanOnly` on its own merits — that is the slicer's call, not this PRD's.)
- **`needsAnswers`: OMITTED (RESOLVED).** The source flagged exactly ONE residual
  PRD-time detail — the **sidecar FORMAT bytes** — and explicitly called it "not a
  design fork" (only the concrete bytes were deferred; the SHAPE was resolved). This
  PRD **RESOLVES that detail concretely** in "Implementation Decisions → The sidecar
  format" below (frontmatter + per-entry fields + the item↔sidecar pointer
  convention), so there is no open question blocking auto-slicing. The slicer/an ADR
  may refine the exact bytes, but a complete, sliceable spec exists. No other
  questions are open.

## Implementation Decisions

> Trimmed at slice-time: this detail moves into the slices (what to build) and,
> where it is durable rationale, into an ADR. It is here only to seed the slicing.

### MAINTAINER-RESOLVED SLICE-TIME DECISIONS (2026-06-09 — read FIRST; these close the last open forks so the slicer does NOT re-ask or guess)

An `orchestrate` sitting surfaced the four genuine slice-time forks to the
maintainer; all four are now RESOLVED. The slicer must treat them as DECIDED spec
(not open questions — do NOT emit `needsAnswers` for these):

1. **Sidecar answered predicate (was the one deferred byte-detail): a non-empty
   `answer:` ⇒ ANSWERED, with an explicit `answered:` line as an OVERRIDE.** The
   human writes the LEAST (just `answer:`); the serialiser normalises `answered:
   true` on the next write; an explicit `answered: false` overrides a non-empty
   answer. (Supersedes the "slicer picks one" note in Out of Scope.)
2. **The `batch-qa` → `surface-questions` refactor (US #32–35) is a NEW skill, not an
   in-place rename.** Author a NEW `surface-questions` skill (GATHER-only,
   PERSIST-NEVER — mirrors `review`): it EMITS questions and writes nothing; the
   engine spawns it fresh-context and ITSELF writes the sidecar (CAS-atomic). The OLD
   `batch-qa` skill is RETIRED — its question-formulation judgement survives in
   `surface-questions`, its BOUND/APPLY/ITERATE/one-file orchestration is absorbed by
   the advance engine, and its human-batching role is replaced by `orchestrate` +
   `surface-questions`. `surface-questions` STAYS human-invokable for the no-runner
   path (US #34). So this PRD's slice set should emit BOTH the new `surface-questions`
   skill AND the retirement of the `batch-qa` skill (the gate-nit text was already
   made skill-agnostic in `gate-nit-triage-text-skill-agnostic`, so no live generator
   re-mints the dead name). `to-slices`/`review` stay composed UNCHANGED (US #35).
3. **The `allowAgents` → `autoBuild` rename (US #36) IS emitted as a slice IN THIS
   SET — the FINAL, last-sequenced slice, `blockedBy` the rest of the advance family,
   and NOT `humanOnly`.** (The maintainer overrides the earlier "slicer may mark it
   humanOnly" latitude: it is a clean, well-specified, agent-buildable breaking-config
   migration with an alias/deprecation window — precedent `rename-reviewpr-to-review`,
   `remove-sliced-marker-step-b`. Keep it in-set; do not spin it into a separate PRD.)
4. **Set granularity + sequencing (DECIDED): slice the FULL family in this set** —
   the sidecar contract → the tick classifier + state machine → the `advancing/` lock
   borrow → the `advance` verb + resolver → the rungs (surface / apply / triage) →
   the agent→runner reporting channel (incl. the captured-notes fold-in) → the two
   drivers (one-shot + loop) + `-n` (always sequential) + the per-action gates → the
   `install-ci` workflow-template (as an in-set slice, sequenced AFTER the tick/driver,
   NOT a separate PRD) → the `autoBuild` rename (last). DEFERRED / OUT (do NOT slice):
   the round-counter/churn-limiter (already DEFERRED below) and the chat-driven
   frontend (its own idea, out of scope). The keystone ordering below already encodes
   most of this; the slicer applies it.

### The advance TICK (the contract both drivers wrap)

`classify (cheap, read-only, NO model, no lock)` → `take the CAS lock for the
classified rung` → `execute the rung (may be expensive: agent/model) — WINNER ONLY` →
`release`. NEVER invents an answer. The expensive phase is ALWAYS post-lock so a CAS
loser never starts model work (TOCTOU between classify and CAS is harmless — only the
free classification is wasted; the CAS catches it and the tick retries).

### The per-item state machine (the deterministic trigger — two signals only)

```
needsAnswers: true?
├─ NO  → ANALYSE (state-appropriate rung: build a ready slice / slice a ready PRD /
│        triage an untriaged observation). Analysis MAY advance the item, OR SURFACE
│        questions (atomically set needsAnswers:true + write the sidecar).
└─ YES → sidecar exists?
         ├─ NO  → ANALYSE (first pass: generate questions → write the sidecar)
         │        [transitional — surfacing normally writes the sidecar atomically]
         └─ YES → all entries answered?
                  ├─ YES → ANALYSE: apply the answers + advance. May APPEND new Qs
                  │        (→ stays needsAnswers:true, re-pauses) OR resolve fully
                  │        (→ clear needsAnswers + delete the sidecar, ATOMICALLY).
                  └─ NO  → NO-OP (awaiting human).
```

Two invariants: (1) `needsAnswers:false` ⟺ NO active sidecar (clear-flag and
delete-sidecar are the SAME atomic step); (2) a pending sidecar makes the tick a clean
NO-OP. "ANALYSE" ≠ "always advance" — surface-and-pause is itself a rung. Subset of
answers → SKIP. Append, never overwrite (the sidecar is the full Q&A history; "all
answered?" flips back to false when new entries appear). Declined/keep is an answer (a
recorded marker; the item drops out of the pool). Churn is visible, not auto-managed
(a round-counter → needs-design is a DEFERRED optional refinement).

### The sidecar (the keystone — Option B)

A per-item SIDECAR file, flat, `work/questions/<type>-<slug>.md` (e.g.
`work/questions/prd-autoslice.md`, `slice-foo.md`, `obs-bar.md`). Chosen over an
in-item block (Option A) because A would need a fragile round-trip parse over
human-authored prose; B is a file the tooling FULLY OWNS in a strict, testable format,
decouples the contention surface, gives human+machine visibility (`ls work/questions/`),
and carries strict machine-readable answered-vs-open. Four properties:

1. **Type-encoded flat name `<type>-<slug>`** (slugs collide across namespaces) —
   derived deterministically from the item's NAMESPACED identity (the resolver stays
   the single source of truth; `:`→`-` for filenames).
2. **Identity-keyed, NOT folder-keyed** — survives the item's `git mv`s between folders
   with no lock-step move.
3. **Terminal cleanup** — deleted by the advance tick when the item reaches a terminal
   state (one owner, one deletion point).
4. **Atomic apply** — mutate the item body AND update/remove the sidecar entry in ONE
   commit.

### The sidecar FORMAT (RESOLVED here — the one PRD-time detail)

A strict, tooling-owned Markdown file: YAML frontmatter for identity + the answered
predicate, then one fenced/structured entry per question. Concrete decided shape (the
slicer/an ADR may finalise exact byte details, but THIS is the spec to build to):

```
---
item: prd:autoslice          # the NAMESPACED identity (resolver is source of truth)
type: prd                    # prd | slice | observation  (redundant w/ filename; explicit for the parser)
slug: autoslice
allAnswered: false           # DERIVED convenience mirror (entries are the source of truth)
---

## Q1
id: q1                       # stable per-entry id (q1, q2, … monotonic; never reused)
question: |
  <the question, verbatim>
context: |
  <inline context so the human need not open the item>
default: |                  # optional suggested default (the surface-questions humility aid)
  <suggested default, if any>
answered: false             # the per-entry source of truth
answer: |                   # filled by the HUMAN; empty/absent while unanswered
disposition:                # optional, for triage entries: promote-slice | promote-adr | keep | delete | out-of-scope | needs-attention

## Q2
id: q2
...
```

Decided rules for the format:

- **`answered: bool` per entry is the source of truth**; `allAnswered` in frontmatter
  is a DERIVED mirror the classifier MAY read but must not trust over the entries (it
  is a convenience for cheap scanning; recompute from entries on apply).
- **Entry ids are stable + monotonic** (`q1`, `q2`, …), never reused — so APPEND adds
  `qN+1` and the history is unambiguous; the agent keys "already asked/answered" off
  the id.
- **The human authors only `answer:` (and flips `answered: true`)** — or, friendlier,
  the apply rung treats a non-empty `answer:` as answered and normalises `answered:
  true` on apply. (Decide one at slice-time; both are testable. Recommended: a
  non-empty `answer:` ⇒ answered, with `answered:` as an explicit override, so the
  human writes the least.)
- **The item↔sidecar pointer convention:** the sidecar is found PURELY from the item's
  namespaced identity (`work/questions/<type>-<slug>.md`) — there is NO back-pointer
  field needed in the item body (deriving the path from identity keeps the item body
  free of tooling cruft and avoids a second thing to keep in sync). The ONLY signal in
  the item body is the existing `needsAnswers` flag.
- **`disposition` is present only on triage/terminal-routing entries** and carries the
  answered routing (promote-slice / promote-adr / keep / delete / out-of-scope /
  needs-attention) the apply rung executes.

### The lock model

ONE lock PRIMITIVE — the CAS ledger-write seam (a transition published by moving the
item into a lock-FOLDER via a force-with-lease micro-commit on a distinct branch ref).
The lock-FOLDER encodes the ACTION; the entry name (`<type>-<slug>`) encodes the
IDENTITY. Action-folders: `work/in-progress/` (build claim, long-held, one-way),
`work/slicing/` (PRD slice borrow), and the NEW `work/advancing/` (the
surface/apply/triage borrow — a SHORT borrow shaped like `slicing`, on its own branch
ref/folder for namespace hygiene so an advancing-borrow never collides with a
slicing-borrow or build-claim on the same slug). A PRD may hold `advancing` then later
`slicing` (never co-held). `needsAnswers` is the PURE answer-required axis, NOT a lock;
the human edit-handshake is "take the `advancing` lock via CAS" (supersedes
`folder-taxonomy-and-prd-edit-handshake.md`, which should be updated to point here).
Lock discipline: MANDATORY for the autonomous driver, no-op formality for a solo human.

### Classify → lock → execute, and new-item creation

The expensive (agent/model) work is always POST-lock, winner-only (the proven
claim→work flow). New-item creation (observation→promote drafting a new
`work/backlog/<new-slug>.md`) goes THROUGH the CAS too, keyed on the NEW item's
identity, so the (unlikely) same-slug new-item race needs no special case.

### Per-item-type transitions

SLICE: surface (→ sidecar, stays backlog) / pending NO-OP / apply (append-or-clear) /
ready → claim → in-progress → BUILD → done. PRD: surface / pending NO-OP / apply /
ready → slicing → SLICE → back to prd/ + `sliced:` marker (emits backlog slices,
usually `needsAnswers:true`). OBSERVATION: triage → auto-disposition (high bar) OR
surface a disposition question / pending NO-OP / answered "promote" → CAS-create a new
backlog stub + record triage + delete sidecar / answered "keep" → `triaged:keep`
marker, drops out / answered "delete" → recommend deletion (human deletes per
contract).

### Repo-config: a FLAT per-action gate family

| action | gate | default |
|---|---|---|
| build a ready slice | `allowAgents` (→ rename `autoBuild`, LAST) | off |
| slice a ready PRD | `autoSlice` | off |
| auto-disposition an observation (no-question triage) | **`autoTriage` (NEW)** | off |
| SURFACE a question (write sidecar) | none — ALWAYS allowed | — |
| APPLY a human's answer | none — ALWAYS allowed | — |

Resolved like the existing gates: `flag > AGENT_RUNNER_* env > .agent-runner.json >
global > default false`. Advance RESPECTS these; it never bypasses them.

### batch-qa → surface-questions

Refocus the `batch-qa` skill into **`surface-questions`**: GATHER-only (formulate
questions by composing `review` for slice/PRD/code + the native triage question for
observations + collect pre-existing `needsAnswers`/`## Open questions`; inline context
+ suggested defaults; the humility rule — surface the residue, NEVER invent an answer)
and **PERSIST-NEVER** (EMIT questions, write nothing — mirroring `review`). The engine
spawns a fresh-context agent with `surface-questions` loaded and ITSELF writes the
sidecar (CAS-atomic). Human-invokable for the no-runner path; no separate write-skill
unless hand-writing proves annoying. `to-slices`/`review` stay composed by the rungs,
unchanged.

### Two drivers + `-n` + CI

`-n x` is ALWAYS SEQUENTIAL (dumb "run the tick N times" loop) for both `do` and
`advance`. Parallelism comes from `run` (concurrent loop) or the CI substrate (matrix).
Isolation = the `isolation-strategy-seam`; chaining = rebase-before-integrate (ADR §10);
a chain conflict → needs-attention. CI shape: `propose` → a matrix of independent jobs
(each opens a PR); `merge` → a single sequential job (rebase-chains; parallel would
thrash the main-CAS). A separate `install-ci` workflow-template deliverable wires "on
cron / on-answer-committed → the right shape".

### The `allowAgents` → `autoBuild` rename (SEQUENCED LAST)

A clean, isolated, breaking config migration (touches `.agent-runner.json`,
`config.ts`/`env-config.ts`/`repo-config.ts`, docs, WORK-CONTRACT) with an
alias/deprecation window — DONE AFTER the advance family lands, so the family is
symmetric (`autoBuild`/`autoSlice`/`autoTriage`). Precedent: `rename-reviewpr-to-review`.
Build the advance work with `allowAgents` named as-is; rename alone afterwards.

## Testing Decisions

> Also trimmed at slice-time (moves into slices' acceptance criteria / an ADR).

- **The tick is the seam.** Test `advance` as the pure one-item tick: given an item +
  `needsAnswers` + sidecar-state + type, assert the CLASSIFIED rung (no model needed —
  classification is pure file inspection). This is the highest-value, cheapest seam and
  mirrors the existing `categorise.ts`/`eligibility.ts` tests.
- **State-machine table tests** — drive every cell of the per-type transition tables
  (surface / pending-NO-OP / subset-SKIP / all-answered-apply / append-re-pause /
  clear+delete / terminal-cleanup) and assert the two invariants
  (`needsAnswers:false ⟺ no sidecar`; pending ⇒ NO-OP) hold.
- **Sidecar parse/serialise** — round-trip the strict format; assert stable monotonic
  ids, append-never-overwrite, derived `allAnswered`, and atomic apply (one commit
  mutating body + sidecar) using a throwaway git repo (the existing test pattern).
- **Lock/CAS** — reuse the existing CAS-seam test harness: two concurrent ticks on the
  same `<type>-<slug>` advancing-ref → exactly one winner, loser exit-2 backs off;
  advancing-borrow vs slicing-borrow vs build-claim on the same slug do NOT collide
  (distinct refs); new-item creation race → loser fails CAS.
- **Gate composition** — assert each rung obeys its gate (`allowAgents`/`autoSlice`/
  `autoTriage`) and that surface/apply are always allowed even with all flags off (the
  "question loop with zero autonomy" case).
- **Convergence/no-op** — a pending-sidecar pool is STABLE (the loop drains
  monotonically as answers arrive; idles, never thrashes, when there are none).
- **surface-questions = PERSIST-NEVER** — the skill is doc-shaped (like `review`); its
  acceptance is that it emits questions and writes nothing, and the engine (with tests)
  owns persistence.

## Out of Scope

- **Automating ANSWER creation — REJECTED by design.** The agent surfaces questions and
  applies HUMAN-authored answers; it never invents an answer. (The human is the clock;
  that is the design goal, not a flaw.)
- **`do` subcommands (`do slice <slug>` / `do prd <slug>`) — REJECTED.** They break the
  "bare slug = slice" ergonomic, fork the resolver, and reopen sliced/partially-built
  work. Keep `prefix:arg`.
- **A standalone `slice <prd>` command — REJECTED.** `do prd:` already slices and
  `advance prd:` drives the PRD slice rung; a separate verb is redundant.
- **Parallelism as a property of `-n` — REJECTED.** `-n` is always sequential;
  parallelism is `run` or the CI matrix.
- **New isolation / chaining machinery — NOT BUILT.** Reuse the isolation-strategy seam
  and rebase-before-integrate.
- **A round-counter that flips a churning item to needs-design after N round-trips —
  DEFERRED** (optional refinement, mirroring `reviewMaxRounds`; the manual escape exists
  today — a human answers "take this to needs-attention").
- **The exact `answer:`-vs-`answered:` authoring micro-decision** — RESOLVED
  (2026-06-09): a non-empty `answer:` ⇒ answered, with an explicit `answered:` line as
  an OVERRIDE. See "MAINTAINER-RESOLVED SLICE-TIME DECISIONS" §1. (No longer the
  slicer's pick.)
- **A dedicated `record-questions` write-skill — DEFERRED** unless hand-writing the
  sidecar proves annoying (mirrors the optional setup-convenience command).
- **The `auto-slice` / `run-daemon-reframe` / ledger-CAS work this builds ON** — those
  are their own PRDs/landed work; this PRD REUSES them (`sliceAfter: [auto-slice]`).

## Further Notes

- **The product vision (north star):** *advance is the ultimate mechanism to transform
  a set of PRDs into a final product without any human work except answering questions.*
  Everything (the verb, the tick, the question protocol, the locks) serves this one
  goal: for a human it is steady progress; in CI it lets one invocation constrain
  exactly what gets done.
- **The human is the clock (state honestly):** the system autonomously does ALL the
  non-judgement work and idles on judgement; throughput = the human's answer rate.
  Item-classes do NOT advance equally autonomously — slices/PRDs advance a lot
  (build/slice when ready); observations advance mostly via a human triage answer (with
  conservative auto-disposition reserved for the no-question cases). That is correct,
  not a gap.
- **Almost everything is REUSE:** the tick/loop split (the `do`/`run` convergence), the
  CAS lock kinds + the new `advancing` borrow, the slug-namespace resolver (ADR §3a),
  the isolation-strategy seam (ADR §3), rebase-before-integrate (ADR §10), and the
  `batch-qa` rungs. The one genuinely-new piece is the **question/answer sidecar
  contract**.
- **Supersedes** `work/ideas/folder-taxonomy-and-prd-edit-handshake.md` (the
  edit-handshake moves to taking the `advancing` lock via CAS) — update that idea to
  point here.
- **`run` ≡ CI**, differing only in substrate; the tick is the contract, `run`/CI are
  loops/invocations over it. No new execution model.
- **Sequencing:** builds on **auto-slice** (land FIRST — `advance` reuses the `do prd:`
  rung + the slicing lock + the two-axis gate), ideally **`run-daemon-reframe`** (the
  real concurrent loop) for the looped driver, and the ledger CAS seam (already exists).
  `sliceAfter: [auto-slice]` is set so this PRD's slices can reference auto-slice's
  slugs in `blockedBy`.

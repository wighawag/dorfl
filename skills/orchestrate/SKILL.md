---
name: orchestrate
description: "The human-in-the-loop META conductor over a whole work/ tree: survey EVERYTHING (observations, ideas, PRDs, slices, needs-attention) in one pass, advance every autonomous rung it can (triage observations, slice ready PRDs, build ready slices), and — at the genuine judgement residue — ASK the human conversationally, regrouped into efficient batches, filling the gaps until NEW slices are READY, then build them by calling the `drive-backlog` skill (often as a sub-agent). Use when asked to 'orchestrate the project', 'figure out what to work on and drive it', 'advance the work/ tree', 'review everything and tell me what needs me', or to drain a populated work/ toward 'all ready slices built' while keeping the human's only job 'answer the questions'. Composes `review`, `to-slices`, `to-prd`, and `drive-backlog`; it asks rather than guesses, and NEVER invents an answer to an open question."
---

# orchestrate

**The conductor of conductors.** `drive-backlog` builds the *ready slices*.
`orchestrate` is the layer above THAT: it looks at the **entire** `work/` tree —
observations, ideas, PRDs, slices, needs-attention — works out **what can advance
and what is stuck on a human**, does every autonomous rung it can, and turns the
human into nothing but an **answerer of well-batched questions**, looping until the
backlog of ready slices is drained.

It is a **methodology skill** (prose you follow), like `to-slices` / `review` —
NOT a runner command. It composes:

- **`drive-backlog`** (`skills/drive-backlog/`) — to BUILD the ready slices (it may
  dispatch this as a **sub-agent in autonomous posture** and surface the returned
  questions itself).
- **`review`** (`skills/review/`) — to judge any artifact (slice / PRD / observation / code).
- **`to-slices`** (`skills/to-slices/`) — to slice a ready PRD into backlog slices
  (or drive `agent-runner do prd:<slug>`).
- **`to-prd`** (`skills/to-prd/`) — when an idea/observation has matured enough to
  become a PRD.

## When to use vs. not

- **Use** when you have a populated `work/` and want the system to do *everything it
  can autonomously* and then *ask you only at the real judgement residue* — in one
  interactive sitting, with full visibility and agency; to answer "what needs me?"
  across the whole tree; as the human-driven alternative to the autonomous `advance`
  loop when you want to watch and steer.
- **Don't** use it just to build already-ready slices (that's `drive-backlog`
  directly), just to slice one PRD (`to-slices`), or just to review one artifact
  (`review`). Don't use it as the unattended daemon (`run`/`advance`). It is
  **always main-session and conversational** — its defining job is the live Q&A.

## Interactive vs autonomous draining (read once)

`orchestrate` is the **interactive, human-in-the-loop** way to drain a `work/` tree:
it asks its questions conversationally, in the session, and you answer live. Its
autonomous, file-mediated counterpart is the `advance` capability (the `advance-loop`
PRD), driven by `run`/CI with `work/questions/` sidecars the human answers whenever
they like. Same lifecycle drain, different mode: reach for `orchestrate` when the
human is present and wants visibility + agency; the autonomous engine is for
unattended draining. They converge on the same rung contract.

## Core invariant

**Advance every rung you can; for everything else, ASK — never invent an answer.**
Each `work/` item has autonomous rungs (triage, slice, build, apply-answer,
surface-question) and a judgement residue (ambiguity, design forks, `needsAnswers`,
stale premises). Do the autonomous part; surface the residue as batched questions;
apply the answers; repeat. The human's throughput is the only limit; everything
else is automatic.

## The loop

### 1. SURVEY the whole tree (one read pass)

Read across ALL buckets and build a single picture of state + what each item needs
to advance ONE rung:

- **`work/observations/`** — untriaged signals. Each wants: promote to a
  slice/PRD/ADR? keep as a note? delete? (a judgement rung — compose `review`).
- **`work/ideas/`** — incubating. Any matured enough to become a PRD (`to-prd`)? Most
  are left alone (no readiness to force) — note them, don't push.
- **`work/prd/`** — for each PRD: is it `sliced:` already? `humanOnly`/`needsAnswers`?
  `sliceAfter:` satisfied? → **sliceable now**, **blocked on a dep**, or **blocked on
  a human answer**.
- **`work/backlog/`** — the slice dependency graph (READY / BLOCKED / GATED), AND each
  ready slice's **freshness** (drifted vs current `done/`+code — same check
  `drive-backlog` step 1 does).
- **`work/needs-attention/`** — stuck items + their recorded reason; each wants a
  human decision (requeue-continue / requeue-reset / re-scope / drop).

Produce a short **state map**: what's ready to build, what's sliceable, what's
triageable, and what's parked on a human.

### 2. ADVANCE everything autonomous (no human needed)

In leverage order (do the rung that unlocks the most downstream work first):

- **Ready slices** → hand to **`drive-backlog`** (see step 4). (You may batch this to
  the end so all the conversational gap-filling happens first — your call per session.)
- **Sliceable PRDs** → slice them via **`agent-runner do prd:<slug>`** (harness/model/
  gate from agent-runner config — don't hardcode), or the `to-slices` skill for a
  human-path slice; then **review the produced slices** (compose `review`; the
  slicer's own review→edit loop also runs on the `do prd:` path).
- **Clearly-dispositionable observations** → triage them (route/keep/delete) where the
  disposition is obvious; the ambiguous ones become questions (step 3).
- **Apply any human answers** you already have from earlier in the session → flip the
  relevant `needsAnswers`, fill the slice/PRD gap, which may make new items advanceable
  (re-run step 1's classification for them).

Each autonomous action records into the tree and is COMMITTED as it goes: triaged
observations, planted forward-notes, and the runner-owned slice/PRD transitions
(`do prd:` commits its own slicing transition). Commit contract-native moves +
your own `work/` notes; do NOT sweep in unrelated source changes. Report everything
you committed in the final summary so the human sees it in `git log`. (Slices that
get BUILT are committed/merged by `drive-backlog` via the normal PR flow.)

### 3. ASK the residue — batched, conversational, never invented

Everything that needs judgement becomes a **question**. Do NOT ask one at a time and
do NOT guess: **regroup all open questions into one efficient batch** (the discipline
this skill is named for), each with:

- the item + the SPECIFIC question, inline context to answer without opening files,
  the consequence of each option, and a **suggested default** where you have a view.
- grouped/ordered by leverage (answer-unblocks-the-most first).

Present the batch, take the human's answers, then **apply them** (back to step 2 for
the now-unblocked items). Iterate steps 1–3 until the only thing left is *building
ready slices*. Questions the human defers stay parked; you proceed with the rest.

> If the human prefers to answer later / asynchronously rather than inline, offer to
> persist the batch as a question file under `work/questions/<date>-batch.md` (the
> file-mediated fallback the autonomous `advance` engine also reads). Default is
> conversational.

### 4. BUILD the ready slices via `drive-backlog`

Once gap-filling has produced a set of READY slices, build them by invoking
**`drive-backlog`** — hand it the whole ready set; it re-runs its own freshness check
and dependency ordering, so you do NOT need to pre-filter or pre-order beyond what
your survey already established. Two ways:

- **In-session (you watch/steer)** — run `drive-backlog` INTERACTIVE yourself. Best
  when the human wants to see each build/Gate-3/merge (as in the original session).
- **Delegated (heavy lifting off your context)** — dispatch `drive-backlog` to a
  **sub-agent in AUTONOMOUS posture**. The sub-agent builds everything it can,
  never asks, and **returns its report + a stuck-set of questions**. You (in-session)
  then **voice that stuck-set to the human as a batch** (step 3) — this is how
  questions surface from a headless loop: the sub-agent returns them as data; you
  speak them. Resolve, then re-dispatch for the newly-unblocked slices.

> A sub-agent CANNOT ask the human mid-run. That's exactly why `drive-backlog`'s
> autonomous posture is "advance all you can, accumulate the rest, return it" — and
> why `orchestrate` (always in-session) owns the asking. Keep the asking here; push
> the building down.

### 5. LOOP until drained, then SUMMARISE

Repeat 1→4 until no rung can advance without a human answer you don't have. Then give
the meta report:

- **Advanced autonomously** — observations triaged, PRDs sliced, slices built+merged
  (with PR numbers, via `drive-backlog`'s own report).
- **What's now unlocked** — new ready slices, newly-sliceable PRDs, capabilities
  landed (the whole-tree view only this skill has).
- **Parked on the human** — the questions still unanswered / deferred, and exactly
  what each unblocks when answered.
- **Still stuck** — needs-attention items + the decision each awaits.
- **Suggested next sitting** — the smallest set of human answers that would unblock
  the most work.

## Pitfalls

- **Don't invent answers.** The one unforgivable move. A confident wrong answer to a
  judgement question produces drifted slices that cost far more than asking. Ask.
- **Don't over-ask either.** Resolve from the code/ADRs what is genuinely a small
  certain factual gap; only the real judgement residue becomes a question (same
  discipline `drive-backlog`/the build agents use for slices).
- **Sub-agents return questions; they don't ask them.** Always voice a delegated
  loop's stuck-set yourself, batched — never assume the sub-agent reached the human.
- **Commit your tree changes; report them.** Triaged observations, planted
  forward-notes, and the runner-owned slice/PRD transitions are committed as you go
  (contract-native, append-only) and listed in the summary — don't leave them
  dangling. Don't sweep in unrelated source changes.
- **Building mechanics live in `drive-backlog`.** When you build (step 4), the
  long-running `do` process, the interrupt footgun (an abort does NOT kill the
  spawned agent), generous timeouts, flaky-gate retries, and Gate-3 discipline are
  all `drive-backlog`'s — follow that skill for them; don't re-derive them here.
- **Ideas are incubating.** Don't force `work/ideas/` toward readiness; surface the
  ripe ones, leave the rest.

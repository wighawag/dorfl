---
title: issue-intake — one command (intake <N>) that transforms an issue into a slice OR a PRD via a question/answer loop on the issue thread (clear+small → slice, clear+big → PRD, unclear → ask, unrelated → bounce)
slug: issue-intake
humanOnly: true
sliceAfter: [auto-slice]
---

> **Launch snapshot, not maintained** (source for slicing; detail moves into slices /
> `docs/adr/` once sliced). Provenance + history at the BOTTOM (Further Notes); the
> spec leads.

## Problem Statement

agent-runner has no front-of-funnel: work originates from a PRD a human writes
(`to-prd`) and slices (`to-slices`). But real work often starts as a **GitHub issue**
filed by anyone — sometimes a crisp small bug, sometimes a fuzzy big feature. Nothing
takes an issue and turns it into the right `work/` artifact, clarifying it first when
it is not clear enough to act on.

**The goal, in one line: given an issue, transform it into a slice OR a PRD, via a
question/answer step.** This PRD specs exactly ONE job — that transformation ENGINE.
It is the SAME command a maintainer runs locally one-shot AND that CI schedules; CI's
concerns (trigger, auth, autonomy policy, issue-closing) are a SEPARATE PRD
(`runner-in-ci`) — see "Scope: the engine only".

## Solution

A standalone command, **`intake <N>`**, behind an **issue seam**, that reads the issue
+ its comment thread and resolves to ONE of four outcomes. The decision is **agent
judgement driven by a PROMPT** (exactly like `do`'s build prompt or the review gate's
prompt): the prompt produces a VERDICT, and a deterministic runner DISPATCHES on it.

### The decision (the canonical rule — everything else references THIS)

The prompt classifies the issue (given its body + full thread) into one verdict:

| Verdict | When (the criteria the prompt applies) | The runner then… |
|---|---|---|
| **ASK** | The ask is **not clear enough to act on** — a material requirement, scope, or acceptance question is unanswered (the same "would I build the wrong thing if I guessed?" bar `to-slices` uses for `needsAnswers`). | `postComment` the next clarifying question; emit NOTHING; STOP. (A later run resumes from the updated thread.) |
| **SLICE** | Clear, AND the ask **fits ONE slice** — a single tracer-bullet vertical slice by `to-slices`' criterion (one buildable end-to-end path). | Emit one `work/backlog/<slug>.md` (`covers: []`, no `prd:` — its own source of truth), carrying `Fixes #N`. |
| **PRD** | Clear, AND the ask is **coherent but needs >1 slice** — it cannot be one slice (splits for scope/architecture). >1 slice ⟺ a shared vision worth recording ⟺ a PRD. **INCLUDES a coupled-but-SMALL pair: if two asks are genuinely related, they get a (light) PRD — they are NEVER bounced** (bounce is only for UNRELATED asks). | Emit one `work/prd/<slug>.md` with `issue: N`; STOP (slicing is the separate `do prd:` step). |
| **BOUNCE** | The ask is really **multiple UNRELATED concerns** wearing one issue — the prompt cannot articulate a single shared vision tying them together. | `postComment` "please file separate issues", emit NOTHING, leave the issue open. |

Decision aids the prompt must encode, stated once here:
- **"clear?" bar** = the `to-slices`/`needsAnswers` bar: would acting now risk building
  the wrong thing? If yes → ASK. (Do NOT guess a spec from a vague issue.)
- **"one slice?" bar** = `to-slices`' tracer-bullet test: one thin end-to-end path,
  demoable on its own. Fits → SLICE; needs splitting → PRD.
- **PRD vs BOUNCE** turns on a **shared vision**: coupled (even if small) → PRD;
  unrelated → BOUNCE. The size of a coupled pair never forces a bounce — only
  unrelatedness does. (This guard prevents over-bouncing a small coupled pair.)

### The engine shape (the testable seam)

`intake` is **a prompt + a deterministic dispatcher**, mirroring the review gate
(prompt → `approve|block` → dispatch) and the slicer loop:

1. **acquire the `processing` lock** (below) — winner only.
2. **read** the issue + thread via the seam.
3. **prompt → VERDICT** — the model returns one of `{ask, slice, prd, bounce}` PLUS,
   for `slice`/`prd`, the DRAFTED artifact content (and, for `ask`/`bounce`, the
   comment text). The agent only DRAFTS / decides; it does NO git, no label ops, no
   posting — it returns a verdict object.
4. **dispatch (the runner, deterministic + testable):**
   - `ask`/`bounce` → `postComment` the text; emit no artifact.
   - `slice` → write `work/backlog/<slug>.md` (+ `Fixes #N`) and integrate it via
     `performIntegration` in the slice mode (below).
   - `prd` → write `work/prd/<slug>.md` (+ `issue: N`) and integrate it via
     `performIntegration` in the prd mode (below).
   - surface the artifact's own gate axes (`humanOnly`/`needsAnswers`) as the prompt
     judged them.
5. **release the lock.**

The seam between (3) and (4) is the unit tests target: a STUBBED verdict drives the
dispatcher with no model/network. The prompt's JUDGEMENT is not unit-tested (like the
review prompt's judgement is not) — only the dispatch is.

The loop re-runs on a new comment OR an issue-body edit (re-evaluate the whole thread;
edit-vs-reply changes only the comment's framing, not the control path). Editing a
buried PRIOR comment is IGNORED (not a new turn — re-triggering invites loops). A
content-derived slug is proposed (never a counter). The runner owns every commit; the
agent only drafts (the in-band git boundary).

### The issue seam (CI-independent, provider-pluggable)

A provider interface (GitHub adapter via `gh` first); the core never imports `gh`,
only the adapter shells out (same discipline as the harness/integration seams). The
methods the ENGINE needs:

- `getIssue`, `listComments` — read the issue + thread (the conversation context).
- `postComment` — the ASK / BOUNCE / outcome message on the thread.
- label ops `addLabel`/`removeLabel`/`getLabels` — the `processing` lock.
- (`closeIssue` is the SEAM's, but used only by CI's close-job — see Scope.)

### The `processing` LOCK (provider-native, not the CAS)

Two concurrent runs on issue N serialise on a single provider-native LOCK label (e.g.
`agent-runner:processing`): added on start, removed on finish. NOT a `work/`-file CAS —
the contended thing is the ISSUE (a system with its own arbiter), and the output slug
is unknown pre-run. It is a transient CONCURRENCY mutex carrying NO `work/` state — NOT
a whitesmith-style label STATE-MACHINE (ADR §12 forbids modelling `work/` lifecycle in
labels; this is not that). A non-label provider degrades to best-effort (CI's per-issue
concurrency group is then the only serialiser).

### Per-outcome integration mode (the KNOBS; the policy is CI's)

`intake` decides the artifact TYPE at runtime, so a single `--merge`/`--propose` cannot
express a type-conditional policy ("merge a PRD but propose a slice"). `intake` exposes
**per-outcome mode flags**; the produced artifact integrates through `performIntegration`:

- **granular:** `--merge-prd`/`--propose-prd` (if the outcome is a PRD);
  `--merge-slice`/`--propose-slice` (if a slice).
- **aggregates:** `--merge` = both-merge; `--propose` = both-propose.
- **resolution:** GRANULAR OVERRIDES AGGREGATE (`--merge --propose-slice` = merge a
  PRD, propose a slice). Same type + both modes (`--merge-prd --propose-prd`) = usage
  ERROR.
- **default:** unset ⇒ propose for both (conservative, matches `do`).
- ask/bounce emit no artifact → the flags are no-ops for them.

`intake` provides the KNOBS only (it is gate-free — see Scope). WHICH knobs CI sets
(from gate state + author-trust) is CI's POLICY, in `runner-in-ci`. A local operator
passes whatever they want (default propose).

## Scope: the engine ONLY (the boundary that makes this sliceable)

**THIS PRD's slices build the ENGINE** — all `sliceAfter: [auto-slice]`-eligible NOW,
no `runner-in-ci` dependency:

1. the **issue seam** (read methods + `postComment` + label ops; GitHub adapter; core
   never imports `gh`);
2. the **`processing` lock** (acquire/release on the label) + best-effort degrade;
3. the **decision prompt** (`{ask,slice,prd,bounce}` + drafted content) — a prompt
   asset, like the build/slicer/review prompts;
4. the **deterministic dispatcher** (verdict → postComment / write+integrate);
5. the **`intake <N>` verb** + per-outcome mode resolution through `performIntegration`;
6. the **"is this PRD complete?" core query** (read-only: ≥1 slice with `prd:<slug>`
   AND all in `work/done/`) — pure `work/`-folder logic the CI close-job consumes
   (verified 2026-06-06 it does not exist yet; re-check `work/done/` at slice time).

**NOT built here — these are `runner-in-ci`'s slices** (the CI scheduler/policy PRD):
trigger policy (`command`/`every-issue`, maintainer/anyone); the author-trust resolver;
the autonomous **merge-vs-propose POLICY** (which per-outcome flags to pass, derived
from gate state); `install-ci` + the label-driven schedule + per-issue concurrency
group; the **merge-to-main close JOB** (calls the "PRD complete?" query + `closeIssue`).
`intake` is **gate-free** — an explicit invocation is its own authorization (exactly as
the `do`/explicit path is not gated by `autoSlice`/`autoBuild`; slice
`explicit-do-prd-not-gated-by-autoslice`); the per-repo config gates apply only to the
AUTONOMOUS/auto-pick path, which is CI.

## Loop closure (the linkage this engine emits; the JOB is CI's)

The engine EMITS the linkage; CI ACTS on it:
- a lone **slice**'s PR carries **`Fixes #N`** → its merge closes the issue directly
  (one PR, safe);
- a **PRD** fans out to N slices = N PRs → those PRs carry **`Refs #N`** (NOT
  `Fixes #N`, which would close on the first of N merges); the issue is closed by CI's
  merge-to-main job running the core "PRD complete?" query + `closeIssue`. Slices
  resolve the issue via `slice → prd: → PRD issue:` (the number lives ONLY on the PRD).
- Degrades cleanly on a non-GitHub arbiter (no close, no breakage).

## User Stories

1. As a user, I want to file an issue (bug, small improvement, or big feature) and have
   `intake <N>` turn it into the right `work/` artifact, so I do not hand-write a spec.
2. As a maintainer, I want `intake` to ASK on the thread when the issue is unclear and
   continue until it is clear, so a fuzzy issue becomes a clean artifact via
   conversation, never a guess.
3. As a maintainer, I want the **decision** (ask / slice / PRD / bounce) made by a
   PROMPT-driven verdict the runner dispatches on (per the decision table), so the
   judgement is tunable like every other agent-runner prompt and the dispatch is
   deterministic + testable.
4. As a maintainer, I want a clear small ask → ONE slice and a clear big ask (>1 slice)
   → a PRD, with a coupled-but-small pair getting a light PRD (NEVER a bounce), so the
   artifact matches the work and small coupled work is not wrongly rejected.
5. As a maintainer, I want an issue of genuinely UNRELATED asks BOUNCED ("file separate
   issues"), so unrelated work is not smuggled under one issue.
6. As a maintainer, I want `intake` to run LOCALLY one-shot AND be the SAME command CI
   schedules, so the transformation is built once and I can test it with no CI.
7. As a maintainer, I want `intake` GATE-FREE (my explicit invocation authorizes it,
   like `do`), so per-repo `autoSlice`/`autoBuild` config never blocks an explicit run.
8. As a maintainer, I want the emitted artifact to carry its issue link (`Fixes #N` on a
   lone slice; `issue: N` on a PRD) + its own gate axes, so it hands cleanly to the
   slice/build engine and to CI's closure.
9. As a maintainer, I want PER-OUTCOME integration modes (granular + aggregates,
   granular-overrides-aggregate, default propose), so CI can apply a type-conditional
   merge-vs-propose policy over a command whose output type is decided at runtime.
10. As a maintainer, I want two concurrent runs on one issue serialised by a
    provider-native `processing` LOCK label (not a `work/` CAS), so concurrency is
    handled where the issue lives.
11. As a maintainer, I want the issue seam provider-pluggable (GitHub via `gh` first),
    core never importing `gh`, so other providers can follow and CI reuses the seam.

## Testing Decisions

- **Dispatcher with a STUBBED verdict** (no model/network): each verdict
  (`ask`/`slice`/`prd`/`bounce`) drives the right action — postComment-and-emit-nothing
  vs write-`backlog/`-slice-`Fixes #N` vs commit-`prd/`-PRD-`issue:N`-and-stop vs
  split-comment-and-emit-nothing. The prompt's JUDGEMENT is not unit-tested (like the
  review prompt's is not); only the dispatch is.
- **Per-outcome mode resolution** as pure logic: granular routes per type; aggregates
  expand; granular overrides aggregate; same-type-both errors; unset ⇒ propose.
- **`processing` lock**: a second run while the label is present backs off; label
  added-on-start / removed-on-finish; non-label provider degrades.
- **"PRD complete?" query** over fixture `work/` trees: complete iff ≥1 `prd:<slug>`
  slice AND all in `done/`. (The CI close-JOB that consumes it is `runner-in-ci`'s.)
- **Event-classification** (new-comment / issue-body-edited → re-evaluate;
  comment-edits ignored) as pure logic.
- Stub the seam + `gh` throughout (no network, no real GitHub).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** reads (possibly untrusted) issues, posts
  under the project identity, can make work CLAIMABLE — a human should drive the
  SLICING of this PRD. Per-slice (WORK-CONTRACT §3b): the dispatcher, the mode
  resolution, the "PRD complete?" query, and event-classification are agent-buildable;
  the issue-seam ADAPTER (shells out under repo identity) leans `humanOnly`; the
  decision PROMPT is a prose asset a human likely tunes.
- **`needsAnswers`: NONE open.** Author-trust + the merge-vs-propose POLICY moved to
  `runner-in-ci` (this command is gate-free), so no open question blocks the engine
  slices. The decision table, the four outcomes, the lock, the per-outcome KNOBS,
  slug/`issue:` linkage, and the "PRD complete?" query are all decided.

## Out of Scope

- **Everything CI** — trigger policy, author-trust, the merge-vs-propose POLICY,
  `install-ci`/the schedule/concurrency group, the merge-to-main close JOB — is
  `runner-in-ci`'s (see "Scope: the engine only"). `intake` is gate-free and exposes
  only the per-outcome mode KNOBS CI sets.
- **Auto-slicing the emitted PRD / building the emitted slice** — the existing
  `do prd:` / `do <slice>` engine, triggered separately.
- **A slice-level `issue:` field** — not needed (the only multi-slice case is the PRD,
  tracked by `prd:`; unrelated multi is bounced).
- **Any issue-label STATE-MACHINE / issue lifecycle in core (ADR §12)** — only the
  single transient `processing` concurrency lock label is in scope.
- **Non-GitHub issue providers** — GitHub adapter first; the seam allows others later.

## Further Notes (provenance + reuse)

- **Absorbs the former `work/prd/issue-to-prd.md`** (deleted 2026-06-09). History: two
  PRDs once split this — `issue-to-prd` (every issue → a PRD) + `issue-intake` (a
  slices-first front-door on top). They collapsed into one once the capability became
  ONE command whose conversation ends in EITHER artifact: PRD and slice are two
  branches of one advance/ask loop sharing one seam / lock / trigger. The PRD
  conversation, the issue seam, slug + `issue: N` linkage, and option-(iii) loop
  closure came from `issue-to-prd` and live here.
- **Reuse, don't reinvent:** `to-slices`/`to-prd` for the slice/PRD shapes (and their
  "clear?"/"one slice?" criteria the decision prompt anchors to); `performIntegration`
  (`src/integration-core.ts`) for output; the review-gate's prompt→verdict→dispatch
  pattern for the engine shape; the slug-namespace resolver pattern for the verb.
  Genuinely-new: the issue SEAM (read + postComment + label ops), the decision PROMPT +
  dispatcher, the per-outcome mode resolution, and the "PRD complete?" query.
- **whitesmith** (`~/dev/github/wighawag/whitesmith`) is the reference for the issue
  provider/seam, author-association checks, the slash-command/event workflow, and the
  PROVEN label + per-issue-concurrency pattern. Reuse the SEAM + concurrency pattern;
  do NOT reuse its label STATE-MACHINE or 1-PR-per-issue model (agent-runner is
  1-PR-per-slice + folder-native closure + a single transient lock label).
- **CI is just one caller:** `runner-in-ci` schedules `intake` and computes the
  per-outcome modes from its policy. No second transformation engine.

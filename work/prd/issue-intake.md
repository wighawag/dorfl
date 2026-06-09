---
title: issue-intake — one command (intake <N>) that transforms an issue into a slice OR a PRD via a question/answer loop on the issue thread; clear+small → slice, clear+big → PRD, unclear → ask, unrelated → bounce
slug: issue-intake
humanOnly: true
sliceAfter: [auto-slice]
---

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`);
> once sliced, technical detail moves into the slices and durable rationale into
> `docs/adr/`.
>
> **MERGED 2026-06-09 (this PRD absorbs the former `work/prd/issue-to-prd.md`).** A
> grilling pass collapsed two PRDs into one. The old split — `issue-to-prd` (every
> issue → a PRD via an in-thread conversation) + `issue-intake` (a slices-first
> front-door layered on top) — was an artifact of history, not design: once the
> capability is ONE command whose conversation can end in EITHER a slice or a PRD,
> "emit a PRD" and "emit a slice" are just two branches of the same advance/ask loop,
> sharing one issue seam, one conversation, one lock, one trigger. Two PRDs with an
> identical seam was a fork. So `issue-to-prd` is DELETED and folded in here; this is
> the single capability. (The PRD-conversation machinery, the issue seam, slug +
> `issue: N` linkage, and loop-closure all came from `issue-to-prd` and survive here.)
>
> **The command IS the engine; CI is just a scheduler (reshape 2026-06-09).** The
> transformation is a STANDALONE `agent-runner` command — working name **`intake <N>`**
> — that a maintainer runs LOCALLY one-shot AND that CI invokes; the SAME binary, CI
> only adds the scheduler (a label-driven trigger + a per-issue concurrency group).
> It is its OWN command, NOT a `do` namespace: (a) NO review GATE (it is a
> transformation; the OUTPUT slice/PRD is reviewed later when it is built/sliced —
> `do`'s defining verify+Gate-2 do not apply); (b) its LOCK is a provider-native
> GitHub `processing` LABEL, not the `work/` CAS (the contended thing is the ISSUE,
> and the output slug is unknown until the agent reads it); (c) its question surface
> is the ISSUE THREAD (`postComment`), not the `work/` tree / the advance-loop sidecar.
>
> **It is GATE-FREE like `do` (reshape 2026-06-09).** An explicitly-invoked command is
> authorized BY THE INVOCATION — the per-repo config gates (`autoSlice`/`autoBuild`/
> `allowAgents`) DO NOT apply to it (exactly as the `do`/explicit path is not gated by
> them; slice `explicit-do-prd-not-gated-by-autoslice`). The autonomy POLICY — when CI
> runs this autonomously over UNTRUSTED-author issues, what is safe to merge vs PR, and
> author-trust — lives ENTIRELY in the CI PRD (`work/prd/runner-in-ci.md`), NOT here.
> This PRD is purely the transformation engine + the issue seam + the Q&A loop + the
> per-outcome integration knobs CI sets.

## Problem Statement

agent-runner has no front-of-funnel: work originates from a PRD a human writes
(`to-prd`) and slices (`to-slices`). But real work often starts as a **GitHub issue**
filed by anyone — sometimes a crisp small bug, sometimes a fuzzy big feature. There
is no capability that takes an issue and turns it into the right `work/` artifact,
clarifying it first when it is not clear enough to act on.

The goal, in one line: **given an issue, transform it into a slice OR a PRD, via a
question/answer step.** Concretely:

- **clear & small → a SLICE** (the common case; one buildable ask, no PRD ceremony);
- **clear & big → a PRD** (a coherent ask that needs >1 slice ⟺ a shared vision worth
  recording);
- **not clear → ASK** a question on the issue thread, and continue the conversation
  until the issue IS clear, then emit the slice or PRD;
- **unrelated multi-asks → BOUNCE** ("file separate issues") — work wearing one issue.

This makes "slice vs PRD" decidable by the agent at runtime (can the clarified ask be
ONE slice? if not, it is a PRD) — and it means the artifact TYPE is not known until
the agent has read the issue + thread. That runtime decision shapes the command's
integration-mode surface (see Implementation Decisions → per-outcome modes).

## Solution

A standalone command, **`intake <N>`**, behind an **issue seam**, that conducts a
clarifying conversation in the issue's comments and resolves to ONE of four outcomes:
ask / slice / PRD / bounce. Runnable locally one-shot; CI invokes the same command.

### The issue seam (CI-independent, provider-pluggable)

A provider interface (GitHub adapter via `gh` first); the core never imports `gh`,
only the adapter shells out — same discipline as the harness/integration seams. The
methods this capability needs:

- `getIssue`, `listComments` — read the issue + its thread (the conversation context).
- `postComment` — ask a clarifying question / report the outcome on the thread.
- label ops `addLabel`/`removeLabel`/`getLabels` — the `processing` LOCK (below).
- `closeIssue` — used only by the CI loop-closure job (not the one-shot transform).

### The Q&A conversation loop (the unified rule)

Read the issue + whole thread and do **exactly one of**:
- **ASK** — the spec is not yet clear: `postComment` the next clarifying question and
  STOP (the human answers on the thread; a later run resumes from the updated thread).
- **EMIT a SLICE** — clear & fits one slice → a `work/backlog/<slug>.md`
  (`covers: []`, no `prd:`, its own source of truth; compose `to-slices`' slice shape),
  carrying `Fixes #N` (a lone slice = one PR = clean close on merge).
- **EMIT a PRD** — clear & needs >1 slice → a `work/prd/<slug>.md` with `issue: N`
  (compose `to-prd`'s framing), then STOP (slicing is the separate `do prd:`/`to-slices`
  step; the clean cut at the committed PRD).
- **BOUNCE** — would-be multi-slice set with no shared vision → `postComment` "file
  separate issues", emit nothing, leave the issue open. (Distinct from the PRD case:
  the PRD case is coupled work WITH a vision; bounce is unrelated work.)

The loop is the same on a new comment OR an issue-body edit (re-evaluate the whole
thread; edit-vs-reply changes only the framing of the agent's comment, not the control
path). Comment-edits (editing a buried prior comment) are IGNORED (not a new turn —
re-triggering invites loops). A content-derived slug is proposed (never a counter); for
the PRD outcome `issue: N` lives ONLY on the PRD (slices resolve the issue via
`slice → prd: → PRD issue:`). The runner owns every commit; the agent only DRAFTS the
slice/PRD content (the in-band git boundary). The agent surfaces the two gate axes
(`humanOnly`/`needsAnswers`) on the emitted artifact as it judges.

### The `processing` LOCK (provider-native, not the CAS)

Two concurrent runs on issue N serialise on a single provider-native LOCK label (e.g.
`agent-runner:processing`): added on start, removed on finish. NOT a `work/`-file CAS
(the contended thing is the ISSUE, which lives in a system with its own arbiter; the
output slug is unknown pre-run). MINIMAL: one concurrency lock label; the OUTCOME is
tracked by the emitted artifact (a lone slice's `Fixes #N`, a PRD's `issue: N`) — NOT
a whitesmith-style label STATE-MACHINE (ADR §12 forbids modelling `work/` lifecycle in
labels; a transient concurrency lock label is not that — it carries no `work/` state).
A non-label provider degrades to best-effort (the CI per-issue concurrency group is
then the only serialiser).

### Per-outcome integration mode (the knobs; the POLICY is CI's)

Because `intake` decides the artifact TYPE at runtime (slice vs PRD), a single
`--merge`/`--propose` cannot express a type-conditional policy ("merge a PRD but
propose a slice"). So `intake` exposes **per-outcome mode flags**, and the produced
artifact integrates through the existing shared core (`performIntegration`):

- **granular:** `--merge-prd` / `--propose-prd` (mode if the outcome is a PRD);
  `--merge-slice` / `--propose-slice` (mode if the outcome is a slice).
- **aggregates (convenience):** `--merge` = `--merge-prd --merge-slice`;
  `--propose` = `--propose-prd --propose-slice`.
- **resolution:** GRANULAR OVERRIDES AGGREGATE (most-specific wins) — so
  `--merge --propose-slice` = "merge a PRD, propose a slice". `--merge-prd
  --propose-prd` (same type, both modes) is a mutually-exclusive usage ERROR.
- **default:** unset ⇒ `--propose` for both (conservative, matches `do`).
- The bounce/ask outcomes have no artifact, so the mode flags are no-ops for them.

`intake` provides the conditional KNOBS; it does NOT decide which to set from config
(it is gate-free). The CI driver (`runner-in-ci`) COMPUTES which flags to pass from
the gate state + author-trust (its policy — see that PRD). A local operator just
passes `--merge`/`--propose`/granular as they wish (default propose).

### Loop closure (CI glue, NOT core; from the merged-in `issue-to-prd`)

- A lone slice's PR carries `Fixes #N` → merge closes the issue directly (one PR).
- A PRD fans out to N slices = N PRs → those PRs carry `Refs #N` (NOT `Fixes #N`); a
  read-only **"is this PRD complete?"** query in core (a PRD is complete iff ≥1 slice
  with `prd: <slug>` exists and ALL are in `work/done/`) drives a merge-to-main CI job
  that `closeIssue`s `issue: N` at set completion. Provider-portable; no state labels;
  no issue lifecycle in core (ADR §12). The "PRD complete?" query is a core deliverable
  of this PRD's slices (it does not exist today); the close JOB is CI glue.

## User Stories

1. As a user, I want to file an issue (a bug, a small improvement, or a big feature)
   and have `intake <N>` turn it into the right `work/` artifact, so that I do not
   hand-write a spec.
2. As a maintainer, I want `intake` to ASK clarifying questions on the issue thread
   when the issue is not clear, and continue until it is, so that a fuzzy issue becomes
   a clean artifact through conversation rather than a guess.
3. As a maintainer, I want a clear & small ask to become ONE slice (no PRD) and a
   clear & big ask (needs >1 slice) to become a PRD, decided by the agent at runtime,
   so that the artifact matches the work's size.
4. As a maintainer, I want an issue whose would-be slices are UNRELATED to be bounced
   with a "file separate issues" comment, so unrelated work is not smuggled under one
   issue.
5. As a maintainer, I want `intake` to run LOCALLY one-shot AND be the SAME command CI
   invokes (CI only schedules it), so the transformation is built once and I can test
   it from my machine with no CI.
6. As a maintainer, I want `intake` to be GATE-FREE (my explicit invocation is the
   authorization, like `do`), so the per-repo `autoSlice`/`autoBuild` config does not
   block an explicit run.
7. As a maintainer, I want the conversation to commit a content-derived-slug artifact
   with the issue link (`Fixes #N` on a lone slice; `issue: N` on a PRD), so it hands
   cleanly to the existing slice/build engine and to loop-closure.
8. As a maintainer, I want PER-OUTCOME integration modes (`--merge-prd`/`--propose-slice`
   etc., aggregates `--merge`/`--propose`, granular-overrides-aggregate, default
   propose), so CI can apply a type-conditional merge-vs-propose policy (e.g. merge a
   PRD but propose a slice) over a command whose output type is decided at runtime.
9. As a maintainer, I want two concurrent runs on one issue to serialise on a
   provider-native `processing` LOCK label (+ CI concurrency group), not a `work/` CAS,
   so concurrency is handled where the issue lives.
10. As a maintainer, I want the issue auto-closed correctly — a lone slice via
    `Fixes #N`; a PRD via `Refs #N` + the folder-native "PRD complete?" query — by CI
    glue and the seam, never by per-PR `Fixes` on a fan-out and never by labels/issue
    lifecycle in core (ADR §12).
11. As a maintainer, I want the issue seam provider-pluggable (GitHub via `gh` first),
    the core never importing `gh`, so other providers can follow and CI reuses the seam.

## Implementation Decisions

(From the 2026-06-06 + 2026-06-09 discussions — do not relitigate.)

- **One command, two callers.** `intake <N>` is standalone (local one-shot) AND what
  CI schedules (same binary; CI adds the trigger + per-issue concurrency group).
- **Its own command, NOT a `do` namespace** — no review gate; provider-native label
  lock; questions to the issue thread. Gate-free (explicit invocation = authorization).
- **Four outcomes** via one advance/ask loop: ASK (postComment, stop) / SLICE
  (`backlog/`, `Fixes #N`) / PRD (`prd/`, `issue: N`, stop) / BOUNCE (comment, emit
  nothing). Slices-first sizing: one slice if it fits, else a PRD; >1 slice ⟺ shared
  vision ⟺ PRD; unrelated ⟺ bounce.
- **Issue seam, GitHub adapter first** (`getIssue`/`listComments`/`postComment`/label
  ops/`closeIssue`; event classification). Core never imports `gh`.
- **`processing` LOCK label** (concurrency mutex, not the CAS; minimal, not a state
  machine). Non-label provider → best-effort (CI concurrency group serialises).
- **Per-outcome integration modes** (`--merge-prd`/`--propose-prd`/`--merge-slice`/
  `--propose-slice` + `--merge`/`--propose` aggregates; granular-overrides-aggregate;
  same-type both-modes = error; default propose). Output rides `performIntegration`.
  `intake` owns the KNOBS; CI owns the POLICY of which to set (`runner-in-ci`).
- **Slug content-derived (never a counter); `issue: N` on the PRD only** (slices via
  `prd:`); lone slice carries `Fixes #N`. Runner commits; agent drafts only.
- **Loop closure = option (iii):** lone slice `Fixes #N`; PRD `Refs #N` + the
  read-only core "PRD complete?" query + a merge-to-main CI close job. No state labels;
  no lifecycle in core.
- **Gate axes surfaced on the emitted artifact** (`humanOnly`/`needsAnswers`) for the
  downstream slicer/builder to consume — `intake` itself stays gate-free.

## Testing Decisions

- **Stub the issue seam + the agent verdict** (no network, no real GitHub/model). Test
  the OUTCOME BRANCH as pure logic: an "ask" verdict posts a comment + emits nothing;
  a "single-slice" verdict emits one `backlog/` slice (no `prd:`, `Fixes #N`); a
  "needs-PRD" verdict commits a PRD (`issue: N`) + STOPS (no slices); an "unrelated"
  verdict posts the split-issues comment + emits nothing.
- Test **per-outcome mode resolution** as pure logic: `--merge-prd --propose-slice`
  routes each outcome to the right mode; aggregates expand; granular overrides
  aggregate; same-type both-modes errors; unset ⇒ propose. The agent does the git via
  `performIntegration`; the agent drafts only.
- Test the **`processing` lock**: a second run while the label is present backs off;
  the label is added on start and removed on finish; non-label provider degrades.
- Test the **"PRD complete?" query** against fixture `work/` trees: complete iff ≥1
  slice and all `prd:<slug>` slices are in `done/`; the close-glue calls `closeIssue`
  exactly once at completion. Assert lone-slice PRs carry `Fixes #N`; PRD PRs carry
  `Refs #N`. Clean degradation on a non-GitHub arbiter.
- **Event-classification** (new-comment / issue-body-edited advance-or-ask;
  comment-edits ignored) as pure logic.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** it reads (possibly untrusted) issues,
  posts under the project identity, and can make work CLAIMABLE. Security-sensitive
  enough that a human should drive the SLICING of this PRD. Per-slice (WORK-CONTRACT
  §3b): the pure outcome-branch + the mode-resolution + the "PRD complete?" query +
  event-classification are agent-buildable; the issue-seam ADAPTER (shells out under
  repo identity) leans `humanOnly`.
- **`needsAnswers`: NONE open (cleared 2026-06-09).** The earlier open question
  (author-trust resolver shape) is no longer THIS PRD's concern — author-trust + the
  merge-vs-propose POLICY moved to `runner-in-ci` (the CI driver), because `intake` is
  gate-free (explicit invocation = authorization). The transformation engine, the
  seam, the four outcomes, the lock, the per-outcome mode KNOBS, slug/`issue:` linkage,
  and loop-closure are all decided. (The PRD stays `humanOnly` for the seam-adapter
  judgement, but has no open answers blocking the engine slices.)

### Slice-readiness notes

- **`sliceAfter: [auto-slice]` only** (already sliced) ⇒ slice-ELIGIBLE NOW. The
  COMMAND/ENGINE slices (issue seam incl. label-ops + `postComment`, the four-outcome
  Q&A loop, the verb, per-outcome modes through `performIntegration`, the "PRD
  complete?" query) are buildable now and need no `runner-in-ci`.
- **Only the CI-DELIVERY pieces sequence behind `runner-in-ci`** — the trigger policy,
  author-trust, the merge-vs-propose POLICY, `install-ci` + the label-driven schedule,
  the merge-to-main close JOB — expressed per-slice via `blockedBy` at slice time, NOT
  a PRD-level wait. (Those policy/auth slices live conceptually with `runner-in-ci`;
  decide at slice time whether they are emitted here `blockedBy` runner-in-ci slugs, or
  authored as part of `runner-in-ci`.)
- **The "PRD complete?" query is a core deliverable of this PRD's slices** (verified
  2026-06-06: no PRD-complete predicate in `packages/agent-runner/src` — re-check
  `work/done/` at slice time). Pure read-only `work/`-folder logic; agent-buildable.

## Out of Scope

- **The autonomy POLICY (merge-vs-propose derivation, author-trust, fully-gateless
  guardrail) — `runner-in-ci`'s**, not here. `intake` is gate-free and only exposes the
  per-outcome mode KNOBS CI sets.
- **Trigger policy + authorization** (`command`/`every-issue`, maintainer/anyone) —
  `runner-in-ci` (the CI scheduler). The one-shot is operator-invoked.
- **Auth / secrets / `install-ci` / the GitHub Actions workflow + the label-driven
  schedule** — `runner-in-ci`.
- **Auto-slicing the emitted PRD / building the emitted slice** — the existing
  `do prd:` / `do <slice>` engine, triggered separately.
- **A slice-level `issue:` grouping field** — not needed (the only multi-slice case is
  the PRD case, which `prd:` already tracks; unrelated multi is bounced).
- **Any issue-label STATE-MACHINE / issue lifecycle in core (ADR §12)** — only the
  single transient `processing` concurrency LOCK label is in scope (not a state
  machine; carries no `work/` state).
- **Non-GitHub issue providers** — GitHub adapter first; the seam allows others later.

## Further Notes

- **Supersedes + absorbs `work/prd/issue-to-prd.md`** (deleted 2026-06-09): the PRD
  conversation, the issue seam, slug + `issue: N` linkage, the unified
  advance/ask rule, and option-(iii) loop-closure all came from there and live here as
  the PRD branch of the one command.
- **Reuse, don't reinvent:** `to-slices`/`to-prd` for the slice/PRD shapes;
  `performIntegration` (`src/integration-core.ts`) for the output (the per-outcome mode
  resolves into it); the slug-namespace resolver pattern for the `intake` verb wiring.
  The genuinely-new pieces: the issue SEAM (read + postComment + label-ops), the
  four-outcome transformation, the per-outcome mode resolution, and the "PRD complete?"
  query.
- **whitesmith** (`~/dev/github/wighawag/whitesmith`) is the reference for the issue
  provider/seam, author-association checks, the slash-command/event workflow, and the
  PROVEN label-as-state pattern (it uses `whitesmith:*` labels + per-issue CI
  concurrency). Reuse the SEAM + the concurrency pattern; do NOT reuse its label
  STATE-MACHINE or its 1-PR-per-issue model (agent-runner is 1-PR-per-slice with
  folder-native closure + a single transient lock label).
- **CI is just one caller:** `runner-in-ci` schedules `intake` (label-driven trigger +
  concurrency group) and computes the per-outcome modes from its policy. No second
  transformation engine.

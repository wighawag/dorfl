---
title: issue-to-prd — turn a GitHub issue conversation into a committed PRD
slug: issue-to-prd
humanOnly: true
sliceAfter: [auto-slice, runner-in-ci]
---

> **Launch snapshot, not maintained.** Source material for slicing; once sliced,
> technical detail moves into the slices and durable rationale into `docs/adr/`.

## Problem Statement

agent-runner has no front-of-funnel: work originates from a PRD a human writes
(`to-prd`) and slices (`to-slices`). But real work often starts as a **fuzzy
GitHub issue** filed by anyone, that is not specific enough to build. I want a
capability that runs in CI and turns an issue + its comment thread into a
**committed `work/prd/<slug>.md` file** — the grilling happens in the issue
comments, and the conversation ends by producing the PRD. This is the **only**
genuinely issue-aware, CI-specific part of the three-way split (`runner-in-ci`,
`auto-slice`, `issue-to-prd`).

The cut is clean: the issue→PRD subsystem's sole output is a committed PRD (and
the existing `auto-slice` capability may then turn it into backlog items). After
the PRD is committed the issue subsystem is **done** — the actual build/claim/
verify/integrate is the existing engine's job, triggered separately, and tracks
status folder-natively (no issue labels, per ADR §12).

## Solution

A CI-installed pipeline (scaffolded by `install-ci`, per-capability) that, behind
an **issue seam**, conducts a clarifying conversation in an issue's comments and
ends by committing a PRD.

- **Issue seam** — a provider-pluggable interface (GitHub adapter via `gh` first),
  with: `getIssue`, `listComments`, `postComment`, `closeIssue`, and event
  classification (new-comment / issue-body-edited / comment-edited). The core
  never imports `gh`; only the adapter shells out. Same seam discipline as the
  existing harness/integration seams.
- **Trigger policy (chosen at `install-ci` time):**
  - `command` (**default**) — a new issue does nothing until an **authorized**
    user posts a trigger comment (a slash command, e.g. `/ar`). Conservative: no
    auto-grabbing every issue, no acting on untrusted strangers' issues.
  - `every-issue` (opt-in flag) — any newly-opened issue starts the pipeline
    automatically.
  - **Authorized** = `maintainer` (**default**, via the seam's author-association
    check — GitHub `OWNER`/`MEMBER`/`COLLABORATOR`) or `anyone` (opt-in).
- **The conversation loop (unified rule):** on **any spec-changing event** (a new
  comment OR an edit of the issue body), the agent re-evaluates the whole thread
  and does exactly one of:
  - **(a) advance** — if the spec is now clear enough, produce the PRD; or
  - **(b) ask** — post the next clarifying question / review.

  Edit-vs-reply changes only the **framing** of the agent's comment (a reply →
  "Thanks, based on that…"; an issue-body edit → "I see you revised the
  description; re-reading it…"), not the control path — both can advance or ask.
  **Comment-edits (editing a prior buried comment) are ignored** (not a new turn;
  re-triggering invites loops). **Per-issue CI concurrency** (latest-wins)
  debounces rapid edits so one editing session does not spawn N runs.
- **PRD creation:** the agent proposes a **content-derived slug** (confirmed in
  the conversation before creation — never a counter), and the PRD records
  **`issue: <N>`** in its frontmatter (the single surviving thread linking PRD →
  issue). The PRD is committed to `work/prd/<slug>.md`. The runner owns the commit;
  the agent only drafts the PRD content (same in-band git boundary). During the
  conversation the agent also surfaces the two PRD gate axes — `humanOnly`
  (a human should drive slicing) and/or `needsAnswers` (open questions remain) —
  which `auto-slice` consumes.
- **Loop closure — option (iii), as CI glue, NOT agent-runner core:**
  - PR bodies use **`Refs #N`** (traceability, does NOT auto-close), never
    `Fixes #N` — because one issue→PRD fans out to N slices = N PRs, and a naive
    `Fixes #N` would close the issue on the first merge.
  - agent-runner **core** exposes a read-only **"is this PRD complete?"** query: a
    PRD is complete iff every slice with `prd: <slug>` is in `work/done/` (and
    there is ≥1). This is pure `work/`-folder logic, fully provider-portable.
  - A **merge-to-main CI job** (installed by this capability, NOT core) runs that
    query; if a merge just completed a PRD, it closes `issue: N` via the seam with
    a comment linking the merged work. Slices resolve the issue number via
    `slice → prd: → PRD issue:` (the number lives ONLY on the PRD, not on slices).
  - Degrades cleanly for non-GitHub arbiters (no close, no breakage; the issue
    simply stays open).

## User Stories

1. As a user, I want to file a fuzzy issue and have an agent grill me in the
   comments until the requirement is clear, so that I do not have to write a spec.
2. As the maintainer, I want the pipeline to start only when an authorized user
   triggers it (default), with an opt-in "every new issue" mode, so that I control
   what the agent acts on.
3. As the agent, I want any new comment or issue-body edit to make me re-evaluate
   and either ask the next question or produce the PRD, so that the conversation
   always makes forward progress when the spec is clear.
4. As the maintainer, I want the conversation to end by committing a
   `work/prd/<slug>.md` with a content-derived slug and an `issue: N` link, so that
   it hands cleanly to the existing slice→build→verify→integrate engine.
5. As the maintainer, I want the original issue to auto-close ONLY when ALL its
   slices are done (folder-native predicate), via CI glue and the seam — not via
   per-PR `Fixes #N` and not via agent-runner core — so that closure is correct
   for fan-out and stays decoupled.
6. As the maintainer, I want the issue subsystem to add NO labels and NO issue
   lifecycle into agent-runner core, so that the folder-native, label-free
   philosophy (ADR §12) is preserved.

## Implementation Decisions

(Made with the maintainer — do not relitigate.)

- **Clean cut at the committed PRD.** The issue subsystem ends when
  `work/prd/<slug>.md` is committed; it does not touch build/claim/integrate.
- **Issue seam, GitHub adapter first** (`getIssue`, `listComments`, `postComment`,
  `closeIssue`, event classification). Core never imports `gh`. `install-ci`
  per-capability, using the seam not `gh` directly.
- **Trigger policy** `command` (default) | `every-issue`; **authorized**
  `maintainer` (default) | `anyone`. Chosen at install time via flags.
- **Unified conversation rule:** any spec change → re-evaluate → advance (PRD) or
  ask. Edit vs reply = framing only. Comment-edits ignored. Per-issue concurrency
  debounces edits.
- **Slug is content-derived (never a counter); `issue: N` lives on the PRD only**
  (slices resolve via `prd:`). The runner commits; the agent only drafts.
- **Loop closure = option (iii):** `Refs #N` (not `Fixes #N`); core exposes a
  read-only "PRD complete?" query (all `prd:<slug>` slices in `work/done/`); a
  merge-to-main CI job closes the issue via the seam. Provider-portable; no labels;
  no lifecycle in core.
- **`humanOnly` / `needsAnswers`** are surfaced in the conversation and written to
  the PRD (the `auto-slice` capability consumes them as its slicing gate).

## Testing Decisions

- **Stub the issue seam and the agent** (no network, no real GitHub, no real
  model). Test the **event-classification + trigger policy** as pure logic: which
  events advance, which are ignored (comment-edits), who is authorized.
- Test the **unified conversation decision** (advance vs ask) given a stubbed
  agent verdict; assert the runner commits the PRD with the right slug + `issue:`
  field and that the agent does no git ops.
- Test the **"PRD complete?" query** against fixture `work/` trees: complete iff
  ≥1 slice and all `prd:<slug>` slices are in `done/`; and the close-glue calls
  the seam's `closeIssue` exactly once at completion.
- Assert PR bodies carry `Refs #N`, never `Fixes #N`.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (this PRD, DECIDED):** this is the only issue-aware,
  externally-triggered subsystem — it reads untrusted issues, posts comments under
  the project's identity, and closes issues. The author-authorization logic, the
  trigger policy, and the loop-closure CI glue are security-sensitive and a human
  should drive their slicing. Per-slice gates: the pure event-classification /
  trigger-policy / "PRD complete?" functions are agent-buildable; the issue-seam
  adapter (shells out under repo identity), the authorization check, and the
  merge-to-main close-glue lean `humanOnly`.
- **`needsAnswers`:** none open at launch — trigger spectrum, the unified
  conversation rule, slug/`issue:` handling, and option-(iii) closure are decided.

## Out of Scope

- Runner-in-CI packaging (that is `runner-in-ci`).
- The slicing capability + lock (that is `auto-slice`; this capability may emit a
  PRD flagged `humanOnly`/`needsAnswers`, or leave it cleanly auto-sliceable).
- Per-slice child issues / GitHub sub-issues (rejected: reintroduces coupling and
  is not provider-portable; option (iii) closure is used instead).
- Any issue-label state-machine or issue lifecycle inside agent-runner core
  (rejected per ADR §12; closure is CI glue + the seam only).
- Non-GitHub issue providers (GitHub first; the seam allows others later).

## Further Notes

- whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the issue
  provider/seam shape, comment handling, author-association checks, the slash
  command + event-driven workflows, and `install-ci`. Reuse the seam patterns;
  do **not** reuse its label state-machine, its issue lifecycle, or its
  1-PR-per-issue model (agent-runner is 1-PR-per-slice with folder-native closure).
- The fresh-context property whitesmith engineered via 1-commit-per-task is
  already provided more strongly by agent-runner's job/worktree isolation — so
  there is deliberately NO 1-PRD-1-PR mode; 1-PR-per-slice is the only model (a
  PRD that slices to exactly one slice naturally yields one PR).
- Sliced AFTER `auto-slice` and `runner-in-ci` (frontmatter `sliceAfter`): it
  builds on their `install-ci`/auth substrate and the two-axis PRD gate +
  PRD→backlog step, so its slices need their slugs to exist to reference them in
  `blockedBy`. (`sliceAfter` resolves against the `sliced:` marker — those PRDs
  must be SLICED first, not necessarily fully built.)

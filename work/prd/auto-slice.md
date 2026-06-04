---
title: auto-slice — slice a PRD file into backlog items as a work/-native capability
slug: auto-slice
humanOnly: true
---

> **Launch snapshot, not maintained.** Source material for slicing; once sliced,
> technical detail moves into the slices and durable rationale into `docs/adr/`.

## Problem Statement

Turning a PRD (`work/prd/<slug>.md`) into independently-grabbable
`work/backlog/<slug>.md` slices is currently a **human-only, manual** step (run
the `to-slices` skill by hand). I want this to be a **first-class agent-runner
capability** — a command that slices a PRD into backlog items — so it can be run
locally OR triggered in CI like any other agent-runner operation. Auto-slicing is
NOT a CI feature; it is a `work/`-native capability for which CI is just one
caller. It must be **human-first by default** (an agent only auto-slices when the
repo explicitly opts in and the PRD does not forbid it), and it must be safe under
concurrency (two CI runs, or a human and CI, must not both slice the same PRD).

One of three decoupled capabilities (`runner-in-ci`, `auto-slice`,
`issue-to-prd`). This one knows nothing about GitHub issues.

## Solution

A new command, `agent-runner slice <prd-slug>`, that drives the slicing of a PRD
into `work/backlog/` items, with an autonomy gate mirroring the existing
two-axis gate (`humanOnly` × `needsAnswers`) + the `allowAgents` precedent, and a
claim-CAS lock so concurrent slicers never collide.

- **The command** delegates the actual slicing to the agent harness using the
  `to-slices` methodology (the slicer skill), then the runner — owning all
  git-state transitions, as everywhere — commits the produced slices + the PRD
  transition. The agent only produces slice files; it does not commit/push/move.
- **Autonomy gate (the two axes, at the PRD level):**
  - PRD frontmatter **`humanOnly: true`** (DECIDED) — a human must drive the
    slicing of this PRD (a judgement call). Omitted ⇒ undeclared. Set by `to-prd`.
  - PRD frontmatter **`needsAnswers: true`** (DISCOVERED) — the PRD has unresolved
    questions (in its body); the auto-slicer refuses to slice until answered.
  - Per-repo policy **`autoSlice`** — may an agent auto-slice undeclared PRDs in
    this repo? Default `false`; resolved like `allowAgents` and `integration`:
    flag > per-repo `.agent-runner.json` > global > default `false`.
  - Agent-sliceable iff `needsAnswers !== true && humanOnly !== true && autoSlice`
    (the same predicate the build gate uses, one level up). **Slicing is
    human-first by default.**
  - **`sliceAfter` (cross-PRD order):** a PRD's `sliceAfter: [other-prd]` lists
    PRDs that must already be SLICED (resolved against the `sliced:` marker, NOT
    `done/`) before the auto-slicer may slice it — so this PRD's emitted slices
    can reference the real slugs of those PRDs' slices in `blockedBy`. Enforced
    for the agent; a human may override.
- **Concurrency lock via the existing claim CAS (status = folder):** the
  auto-slicer atomically races a `git mv work/prd/<slug>.md →
  work/slicing/<slug>.md` micro-commit to the arbiter (the same compare-and-swap
  the build-claim uses), on a **different branch name** so it never collides with
  build-work claims. The winner slices; on success it moves the PRD back to
  `work/prd/<slug>.md` and drops the new slices into `work/backlog/` in the
  completing transition. A loser gets the claim's exit-2 and backs off.
  `work/slicing/` is the in-progress folder for the slicing operation
  (status = folder, consistent with the rest of the contract).
- **Human path needs no lock.** A human slicing locally with no agent running has
  no contention, so they may slice on `main` directly (lock optional for the
  human, mandatory for the agent) — exactly parallel to "the runner never skips
  verify; the human may." The lock exists to serialise *concurrent* slicers.
- **Confidence behaviour (no human present):** when auto-slicing, if any of
  {granularity, dependency order, a gate, a seam} is genuinely unresolved, the
  slicer does NOT emit a guessed slice — it sets `needsAnswers` on the specific
  uncertain slice (questions in the body) or routes the whole PRD to
  `needs-attention/` with the questions. Never a wrongly-cut slice.
- **Skill updates (done in this docs pass):** `to-prd` sets `humanOnly` /
  `needsAnswers` / `sliceAfter` from the conversation; `WORK-CONTRACT.md`
  documents the two-axis PRD gate, the `autoSlice` repo policy, `sliceAfter`, and
  the `work/slicing/` lock folder.

## User Stories

1. As the maintainer, I want `agent-runner slice <prd>` to turn a PRD file into
   `work/backlog/` slices, so that slicing is a real command, not a manual ritual.
2. As the maintainer, I want slicing to be human-first by default and only
   auto-run when I opt in per repo (`autoSlice`), so that I keep control over when
   agents decompose work.
3. As the maintainer, I want a PRD markable `humanOnly: true` (judgement) or
   `needsAnswers: true` (open questions), so that such PRDs are never auto-sliced
   even where `autoSlice` is on — and so the reason an agent skipped it is honest.
4. As the maintainer, I want concurrent slicers (two CI runs, or human + CI) to be
   serialised by the existing claim CAS, so that a PRD is never double-sliced.
5. As the maintainer, I want a human with no agent running to slice on `main`
   directly without a lock dance, so that the safe common case stays simple.
6. As the maintainer, I want the runner (not the agent) to own the slice commits
   and the PRD folder transitions, so that the git boundary stays identical to the
   rest of the system.

## Implementation Decisions

(Made with the maintainer — do not relitigate.)

- **Auto-slice is a capability, not a CI feature.** The command exists for local
  use; CI is one caller (wired by `install-ci` in its own slice, but the
  capability does not depend on CI).
- **Gate mirrors the build gate, one level up:** PRD `humanOnly` (DECIDED) +
  `needsAnswers` (DISCOVERED) + repo `autoSlice` (policy, default false, flag >
  per-repo > global > default). Agent-sliceable iff `needsAnswers !== true &&
  humanOnly !== true && autoSlice`.
- **Lock = the existing claim CAS, different branch name, `work/slicing/` folder.**
  Reuse `claim-cas`/the proven `git mv` micro-commit racing `main`; do NOT invent
  a new lock. The branch name must not collide with the `work/<slug>` build
  branches.
- **Runner owns git-state; agent only produces slice files** — same in-band
  boundary as the build agent. The agent runs the `to-slices` methodology; the
  runner commits the slices + the PRD transition.
- **`to-prd` sets `humanOnly`/`needsAnswers`/`sliceAfter` during the
  conversation** (skill updated in this docs pass); `WORK-CONTRACT.md` documents
  the two-axis PRD gate, the `autoSlice` policy, `sliceAfter`, and the
  `work/slicing/` folder.

## Testing Decisions

- TDD the **gate resolution** (humanOnly × needsAnswers × autoSlice, flag >
  per-repo > global > default) and the **eligibility** decision as pure
  functions; plus `sliceAfter` resolution against the `sliced:` marker.
- Test the **lock** against throwaway git repos + a local `--bare` arbiter (the
  established `claim.sh` pattern): a simultaneous two-slicer race shows exactly one
  winner; the loser gets exit 2; the winner's transition lands `work/slicing/` then
  `work/prd/` + `work/backlog/`.
- Stub the agent harness (no real model) — assert it is invoked with the slicing
  brief and that the runner, not the agent, performs the commits/moves.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (this PRD, DECIDED):** auto-slice changes the autonomy
  model itself (a new gate axis, a lock that races the arbiter, the human-vs-agent
  slicing boundary). That is judgement-heavy substrate a human should drive, so
  the slicing of THIS PRD is human-led. Per-slice gates: the pure gate-resolution
  + `sliceAfter`-resolution functions are ordinary agent-buildable slices; the
  lock/CAS-integration and the confidence/needs-attention routing lean `humanOnly`.
- **`needsAnswers`:** none open at launch — the gate names, predicate, lock
  mechanism, and `sliceAfter` semantics are decided in this conversation +
  WORK-CONTRACT.md.

## Out of Scope

- GitHub issue awareness (that is `issue-to-prd`; this command takes a PRD slug).
- The CI trigger/workflow wiring (covered by `install-ci`; this slice ships the
  capability + lock, not the workflow).
- Rewriting `to-slices` itself — reuse the existing methodology; only add the
  two-axis gate + `sliceAfter` plumbing.

## Further Notes

- Builds on the existing claim CAS (`claim-cas.ts` / `scripts/claim.sh`) and the
  `humanOnly`/`allowAgents` precedent (CONTEXT.md, `docs/adr/methodology-and-skills.md`
  §4) — the new gate is a deliberate mirror of it.
- The `issue-to-prd` capability's loop-closure relies on slices carrying `prd:`
  (which `to-slices` already sets); auto-slice must preserve that link so a
  finished slice resolves back to its PRD (and thence the issue).

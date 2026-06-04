---
title: auto-slice — slice a PRD file into backlog items as a work/-native capability
slug: auto-slice
blocked_by: []
covers: []
created: 2026-06-04
claimed_by:
claimed_at:
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
`humanOnly` / `allowAgents` pair, and a claim-CAS lock so concurrent slicers never
collide.

- **The command** delegates the actual slicing to the agent harness using the
  `to-slices` methodology (the slicer skill), then the runner — owning all
  git-state transitions, as everywhere — commits the produced slices + the PRD
  transition. The agent only produces slice files; it does not commit/push/move.
- **Autonomy gate (mirrors the existing one):**
  - PRD frontmatter **`humanSliceOnly: true`** — this PRD must be sliced by a
    human (a judgement call). Omitted ⇒ undeclared. Set by `to-prd` during the
    conversation that produced the PRD.
  - Per-repo policy **`autoSlice`** — may an agent auto-slice undeclared PRDs in
    this repo? Default `false`; resolved like `allowAgents` and `integration`:
    flag > per-repo `.agent-runner.json` > global > default `false`.
  - Agent-sliceable iff `humanSliceOnly !== true && autoSlice`. **Slicing is
    human-first by default.**
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
- **Skill updates:** `to-prd` learns to set `humanSliceOnly` from the conversation;
  the `work/` contract (`WORK-CONTRACT.md`) documents the `humanSliceOnly` PRD
  field, the `autoSlice` repo policy, and the `work/slicing/` lock folder.

## User Stories

1. As the maintainer, I want `agent-runner slice <prd>` to turn a PRD file into
   `work/backlog/` slices, so that slicing is a real command, not a manual ritual.
2. As the maintainer, I want slicing to be human-first by default and only
   auto-run when I opt in per repo (`autoSlice`), so that I keep control over when
   agents decompose work.
3. As the maintainer, I want a PRD to be markable `humanSliceOnly: true`, so that
   judgement-heavy PRDs are never auto-sliced even where `autoSlice` is on.
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
- **Gate names mirror the existing pair:** PRD `humanSliceOnly` (binary,
  authoritative) + repo `autoSlice` (policy, default false, flag > per-repo >
  global > default). Eligible iff `humanSliceOnly !== true && autoSlice`.
- **Lock = the existing claim CAS, different branch name, `work/slicing/` folder.**
  Reuse `claim-cas`/the proven `git mv` micro-commit racing `main`; do NOT invent
  a new lock. The branch name must not collide with the `work/<slug>` build
  branches.
- **Runner owns git-state; agent only produces slice files** — same in-band
  boundary as the build agent. The agent runs the `to-slices` methodology; the
  runner commits the slices + the PRD transition.
- **`to-prd` sets `humanSliceOnly` during the conversation** (skill update);
  `WORK-CONTRACT.md` documents the new field, policy, and folder.

## Testing Decisions

- TDD the **gate resolution** (humanSliceOnly × autoSlice, flag > per-repo >
  global > default) and the **eligibility** decision as pure functions.
- Test the **lock** against throwaway git repos + a local `--bare` arbiter (the
  established `claim.sh` pattern): a simultaneous two-slicer race shows exactly one
  winner; the loser gets exit 2; the winner's transition lands `work/slicing/` then
  `work/prd/` + `work/backlog/`.
- Stub the agent harness (no real model) — assert it is invoked with the slicing
  brief and that the runner, not the agent, performs the commits/moves.

## Out of Scope

- GitHub issue awareness (that is `issue-to-prd`; this command takes a PRD slug).
- The CI trigger/workflow wiring (covered by `install-ci`; this slice ships the
  capability + lock, not the workflow).
- Rewriting `to-slices` itself — reuse the existing methodology; only add the
  `humanSliceOnly` plumbing.

## Further Notes

- Builds on the existing claim CAS (`claim-cas.ts` / `scripts/claim.sh`) and the
  `humanOnly`/`allowAgents` precedent (CONTEXT.md, `docs/adr/methodology-and-skills.md`
  §4) — the new gate is a deliberate mirror of it.
- The `issue-to-prd` capability's loop-closure relies on slices carrying `prd:`
  (which `to-slices` already sets); auto-slice must preserve that link so a
  finished slice resolves back to its PRD (and thence the issue).

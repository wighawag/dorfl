---
title: advance — EXTEND the agent→runner reporting channel to scoop + report agent-authored CAPTURED NOTES (observations/findings) on BOTH the slice path (`do prd:`) and the build path (`do <slice>`)
slug: runner-scoops-captured-notes
spec: advance-loop
blockedBy: []
covers: []
---

> Self-contained build slice that FOLDS INTO the existing agent→runner reporting channel — it derives from the advance-loop SPEC's reporting-channel fold-in ("EXTEND this channel to agent-authored CAPTURED NOTES") but is its own narrow path through `do`'s commit logic, covering NO SPEC user story directly (`covers: []`). It is sequenced as the SINGLE fix the SPEC demands (NOT a standalone fork of the channel), but it is file-orthogonal to the advance rungs (it touches `do`'s commit path, not the advance engine), so it can be built in parallel.

## What to build

Extend the existing build-agent → runner REPORTING CHANNEL (the `agent-stop`/`## Decisions` channel) so the RUNNER also SCOOPS + REPORTS agent-authored capture-bucket files (`work/observations/*`, `work/findings/*`) the agent writes during a rung — on BOTH the slice path (`do prd:`) and the build path (`do <slice>`). Today the `do prd:` runner commits only `work/backlog/*` and DROPS such notes (left untracked), making the autonomous path LOSSIER than a human slicer (see `work/observations/runner-drops-agent-authored-captured-notes-on-slicing-commit.md`).

Fix it ONCE here: a captured note is just another thing the agent EMITS that the runner must ROUTE — exactly like the `## Decisions` block. Keep Rule A (the agent does NO git) and extend Rule B (the runner scoops + reports the notes).

### Precise scope

- On a `do prd:` slice commit AND a `do <slice>` build integration, the runner INCLUDES any agent-authored `work/observations/*` and `work/findings/*` files in the runner-owned commit (alongside `work/backlog/*` for the slice path) and REPORTS what it scooped (surface / branch / PR), so they are tracked, not dropped.
- Rule A is preserved (the AGENT does no git — it only writes the note files into the worktree); Rule B is extended (the RUNNER scoops + reports).
- Applies to BOTH paths (slice + build) — do NOT fix only one (that would fork the channel). The advance engine's rungs (which also spawn agents) inherit this fixed channel automatically since they orchestrate `do`/`do prd:`.
- Honest reporting: the runner reports exactly what landed (which note files, where), composing the LANDED honest-reporting substrate (the failure-handling trio's "report exactly what landed").

## Acceptance criteria

- [ ] On `do prd:`, agent-authored `work/observations/*` / `work/findings/*` are INCLUDED in the runner-owned slice commit (not dropped/untracked) and REPORTED.
- [ ] On `do <slice>`, the same notes are scooped into the build integration commit and reported.
- [ ] Rule A holds (the agent does NO git — only writes the files); Rule B is extended (the runner scoops + reports).
- [ ] The fix is applied on BOTH paths from ONE shared place (the channel is not forked).
- [ ] Tests: an agent that writes a note during a `do prd:` slice and a `do <slice>` build → the runner commits + reports the note on both paths; an agent that writes none → no change. House throwaway-repo + stubbed-harness style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — file-orthogonal to the advance rungs (touches `do`'s commit path). Build any time; the advance rungs inherit the fixed channel via `do`/`do prd:`.

## Prompt

> Extend the agent→runner reporting channel so the RUNNER scoops + reports agent-authored captured notes (`work/observations/*`, `work/findings/*`) on BOTH `do prd:` (slice) and `do <slice>` (build). Read the SPEC `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/spec/`) (the PRECURSOR-NOTE fold-in "EXTEND this channel to agent-authored CAPTURED NOTES" — fix it ONCE, not a standalone fork) and `work/observations/runner-drops-agent-authored-captured-notes-on-slicing-commit.md`. Today `do prd:` commits only `work/backlog/*` and DROPS such notes. Keep Rule A (the agent does NO git — only writes the files) and extend Rule B (the runner scoops + reports). A captured note is just another thing the agent EMITS that the runner ROUTES — like the `## Decisions` block. Report exactly what landed (compose the landed honest-reporting substrate).
>
> READ FIRST: `packages/dorfl/src/do.ts` (the `do prd:` slice-commit path that commits `work/backlog/*` — extend it to scoop the note buckets), the build integration path (`integration-core.ts`/`integrator.ts`), `agent-stop.ts` (the existing reporting channel / `## Decisions` block to mirror), and the failure-trio's honest-reporting code (SPEC 2026-06-09 UPDATE).
>
> FIRST, check this slice against current reality (drift). The reporting channel + `do prd:`-through-integration are LANDED substrate. If they landed differently, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim runner-scoops-captured-notes --arbiter origin
git fetch origin && git switch -c work/runner-scoops-captured-notes origin/main
git mv work/in-progress/runner-scoops-captured-notes.md work/done/runner-scoops-captured-notes.md
```

---
title: autoslice-command — the `do prd:<slug>` slicing path (harness + runner-owns-git)
slug: autoslice-command
prd: auto-slice
blockedBy: [autoslice-gate, autoslice-lock, do-in-place]
covers: [1, 6]
---

> **RESHAPED 2026-06-05** (`docs/adr/command-surface-and-journeys.md` §3/§3a): there is **no standalone `slice <prd>` command**. Slicing a PRD is the **`do prd:<slug>`** path of the in-place worker. This slice builds that path (the orchestration below), NOT a separate `slice` verb. `do` resolves `prd:<slug>` to a PRD (bare `<slug>` = a slice, erroring on collision; CI uses the explicit `prd:` prefix). Everything else here is unchanged.

## What to build

The **`do prd:<slug>`** slicing path — the orchestration that ties the gate (autoslice-gate) and the lock (autoslice-lock) together and drives the actual slicing of a PRD, with the runner owning every git-state transition. (NOT a standalone `slice` command — it is the PRD branch of `do`.)

**You are FILLING a stub, not adding a new command.** `do-in-place` (a dependency, in `done/`) already built `do`'s argument grammar + the `slug-namespace-resolution` wiring so `do` ACCEPTS `prd:<slug>` and dispatches it to a slicing-path entry point — left as a deliberate "not yet wired" stub for THIS slice to fill. So: find that existing entry point in the `do` command and implement the orchestration BEHIND it; do NOT add a second/parallel `do prd:` parsing or a separate dispatch (that would conflict with what `do-in-place` wired). The slug resolution (`prd:` → PRD, bare → slice, collision → error) already exists — reuse it, don't re-derive it.

End-to-end flow:

1. **Resolve the gate** (autoslice-gate): for the AGENT path, refuse to slice a PRD that is `humanOnly`/`needsAnswers`, or where `autoSlice` is off, or whose `sliceAfter` PRDs aren't yet sliced. The HUMAN path is not bound by the gate.
2. **Acquire the lock** (autoslice-lock, via the seam CAS) for the AGENT path (concurrency serialisation). The HUMAN path with no contention may slice on `main` directly without the lock.
3. **Invoke the agent harness** with the `to-slices` brief for that PRD — the agent runs the slicer methodology and **produces slice files only**; it does NOT commit/push/move (same in-band boundary as the build agent).
4. **The runner commits the transition**: drop the produced `work/backlog/<slug>.md` slices in AND move the PRD back `work/slicing/ → work/prd/` (releasing the lock)
   - mark the PRD `sliced:` — as the runner-owned git transition. The agent never does git.

Reuse the existing harness seam + the runner-owns-git pattern from `do`/`run`; do NOT reimplement claiming/isolation.

> **MUST-FIX-BEFORE-CONSUME (carried forward from the `autoslice-lock` Gate-2 review nits, `work/observations/review-nits-autoslice-lock-2026-06-07.md`) — address these AS PART OF wiring this consumer of the lock primitive:**
>
> 1. **Always pass `lockedBlob` to `releaseSlicingLock`.** This `do prd:` path is the first live caller of the lock; it MUST capture the slicing PRD's blob at acquire-time and pass it back on release so the content-identity stale check actually runs.
> 2. **Make `releaseSlicingLock`'s omitted-`lockedBlob` path REFUSE, not silently overwrite.** Today, when `lockedBlob` is `undefined`, `slicing-lock.ts` SKIPS the stale check entirely and unconditionally restores `slicing/ → prd/`, silently carrying any concurrent edit into `prd/` — exactly the "never silently overwrite the edit" behaviour the lock slice forbids. Change that latent footgun so an omitted `lockedBlob` REFUSES (throws / errors) rather than blindly overwriting. (You are its first consumer; close the footgun now.)
> 3. **Correct the stale "rebase" wording to "content-identity check".** The `releaseAttempt`/`lockedBlob` JSDoc in `slicing-lock.ts` calls the staleness mechanism a "rebase" / "rebase-conflict-only check" — but the code does a blob content-identity check + a leased-CAS restore (stronger; catches the clean rename+edit merge a textual rebase would miss). Align the prose to "content-identity stale check + leased CAS restore" so a future reader isn't misled.

> **DRIFT NOTE (2026-06-07, drift-review pass):** this slice was authored 2026-06-05, BEFORE the run/do convergence (PRs #17/#18) extracted the shared gate→integrate band out of `run.ts`/`complete.ts` into `src/integration-core.ts` (`performIntegration`). So read the CURRENT split: `run.ts` is now HEAD (claim/isolate/agent/failure-save) + TAIL (job record + worktree reap), and `integration-core.ts` owns the shared runner-owns-git band. The slicing transition you build here is DIFFERENT (prd→slicing→prd + emit backlog slices, NOT verify→review→done-move→rebase→integrate), so it will NOT call `performIntegration` — it follows the same "agent edits, runner does all git" DISCIPLINE with its own transition. The `do prd:` STUB you fill is confirmed present: `do.ts`, the `resolved.namespace === 'prd'` branch returning the `prd-not-wired` outcome — fill BEHIND it (the `resolveSlug` resolver already handles `prd:`/`slice:`/bare + collision). See `work/observations/autoslice-command-runner-owns-git-pattern-moved-to-integration-core.md`. The confidence / needs-attention behaviour when no human is present is owned by a SEPARATE later slice (`slicer-review-edit-loop`, the review/edit loop + its needsAnswers / needs-attention verdict routing — this `do prd:` path just produces candidate slices; the loop improves them and routes a low-confidence/maxReview outcome).

**Slug resolution (ADR §3a):** this path is reached via `do prd:<slug>`. `do` must resolve `prd:<slug>` to the PRD, bare `<slug>` to a slice (error if both exist), and `slice:<slug>` to a slice. CI/automation uses the explicit `prd:` prefix. The auto-pick / `run` tick reaches this path for eligible PRDs (slices-first, per-repo toggle).

## Acceptance criteria

- [ ] `dorfl do prd:<slug>` slices that PRD; for the agent path it slices only when the gate passes (gate refusal is honest: names why it skipped). Bare `<slug>` resolves to a SLICE (errors on a slice/PRD collision); `slice:`/`prd:` are explicit. No standalone `slice` verb is added.
- [ ] It acquires the lock (agent path) before slicing and releases it (`work/slicing/ → work/prd/`) as part of the completing transition; the human path may slice on `main` without the lock.
- [ ] The agent harness is invoked with the slicing brief and produces slice files ONLY; the RUNNER performs all commits/moves (agent does no git).
- [ ] On success the produced `work/backlog/` slices are committed AND the PRD is marked `sliced:` in one runner-owned transition.
- [ ] Tests stub the harness (no real model) and assert: gate-refusal paths, the lock is taken/released, slice files land in `work/backlog/`, the PRD is marked `sliced:`, and the runner (not the agent) authored the commits/moves.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `autoslice-gate` — the slicing-eligibility/`sliceAfter`/`autoSlice` resolution the command enforces.
- `autoslice-lock` — the lock acquire/release the command drives (agent path).
- `do-in-place` — this path IS the `do prd:<slug>` branch of the `do` worker; the `do` command, its slug-resolution, AND the not-yet-wired `do prd:` ENTRY-POINT STUB this slice fills must exist first (phase-2 keystone, ADR `command-surface-and-journeys` §3/§3a). Do NOT claim this before `do-in-place` is in `done/`. You FILL its stub — you do not add a parallel `do prd:` path.

## Prompt

> Build the **`do prd:<slug>` slicing path** — the orchestration tying the gate (autoslice-gate) and lock (autoslice-lock) together to slice a PRD, with the runner owning all git. This is the PRD branch of the `do` worker, NOT a separate `slice` command (ADR `command-surface-and-journeys` §3/§3a). Implement the slug resolution: `prd:<slug>` → PRD, bare → slice (error on collision), `slice:` → slice. Read the done files for BOTH dependency slices + their modules, AND the command-surface ADR §3/§3a FIRST.
>
> READ FIRST: `work/prd/auto-slice.md` (the flow + runner-vs-agent git boundary), `src/run.ts` (the harness-seam invocation + runner-owns-every-git-transition pattern to mirror — the agent edits, the runner commits/moves), `src/harness.ts` (the harness seam), the `to-slices` skill (the slicing methodology the harness runs), and the autoslice-gate/autoslice-lock modules.
>
> Implement the flow: resolve gate (agent path refuses humanOnly/needsAnswers/ autoSlice-off/unsliced-sliceAfter; human path unbound) → acquire lock (agent path; human-no-contention may slice on main lock-free) → invoke the harness with the to-slices brief (agent produces slice FILES only, no git) → RUNNER commits the produced backlog slices + releases the lock (work/slicing/ → work/prd/) + marks the PRD sliced:, as ONE runner-owned transition. Do NOT build the no-human confidence/needs-attention routing here (that is the review/edit loop + its verdict routing, owned by `slicer-review-edit-loop`).
>
> TDD with vitest, stubbing the harness (no real model): gate-refusal paths, lock taken/released, slices land in work/backlog/, PRD marked sliced:, runner (not agent) authored the git. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim autoslice-command --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/autoslice-command <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/autoslice-command.md work/done/autoslice-command.md
```

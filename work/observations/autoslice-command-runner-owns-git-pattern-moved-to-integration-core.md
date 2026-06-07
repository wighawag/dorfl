---
title: autoslice-command's "mirror src/run.ts's runner-owns-git pattern" prompt predates the run/do convergence — that pattern now lives in integration-core.ts; the slicing transition won't reuse it directly
date: 2026-06-07
status: open
---

## The signal

`work/backlog/autoslice-command.md` (authored 2026-06-05) tells the implementer to
"reuse the existing harness seam + the runner-owns-git pattern from `do`/`run`" and
its prompt says READ FIRST `src/run.ts` for "the harness-seam invocation + the
runner-owns-every-git-transition pattern to mirror."

Since that slice was authored, the **run/do convergence (PRs #17/#18)** extracted
the shared gate→integrate back-half OUT of `run.ts`/`complete.ts` into
`src/integration-core.ts` (`performIntegration`). So:

- The "runner owns every git transition" band the prompt points at no longer lives
  whole in `run.ts` — `run.ts` is now HEAD (claim/isolate/agent/failure-save) +
  TAIL (job record + worktree reap); the shared band is `performIntegration`.
- An implementer who reads ONLY `run.ts` (per the prompt) will see a thinner file
  than the prompt assumes and may miss where the runner-owns-git discipline + the
  provider/seam resolution actually live now.

## Why it is not a contradiction (just stale pointers)

The slicing transition `autoslice-command` builds is GENUINELY DIFFERENT from the
gate→integrate band:

- it is `prd → work/slicing/` (lock, via `autoslice-lock`) → invoke harness with
  the `to-slices` brief → RUNNER commits the produced `work/backlog/` slices +
  releases the lock (`work/slicing/ → work/prd/`) + marks the PRD `sliced:`.
- That is NOT the verify→review→done-move→rebase→integrate flow `performIntegration`
  owns. So `autoslice-command` will NOT call `performIntegration` — it builds its
  OWN runner-owned transition, just FOLLOWING the same discipline (agent edits, the
  runner does all git).

So the principle the prompt cites is still correct; only the FILE POINTER drifted.

## Disposition

- **Not blocking; a drift-check note for the implementer.** When building
  `autoslice-command`, read the CURRENT split — `run.ts` (HEAD/TAIL),
  `integration-core.ts` (`performIntegration`, the shared band), and `do.ts`
  (`do prd:` dispatch stub at the `resolved.namespace === 'prd'` branch) — rather
  than assuming `run.ts` still owns the whole pattern. The `do prd:` STUB the slice
  fills is confirmed present and accurate (`do.ts`, the `prd-not-wired` outcome).
- A one-line drift note has been added to the slice body so a future claimant sees
  it without needing this observation.

(Captured 2026-06-07 during the auto-slice plan drift-review pass.)

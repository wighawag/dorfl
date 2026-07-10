---
title: Route the complete transition through the ledger write seam
slug: ledger-write-seam-complete
spec: ledger-transition-seam
blockedBy: [ledger-write-seam]
covers: [3, 7, 8, 10]
---

## What to build

Route the **complete** transition (`in-progress → done`, carrying the agent's code) through the write seam established by `ledger-write-seam`. Today completion's integration is hard-wired: `complete.ts` does the done-move + commit, then `integrator.ts` merges/ff's the work branch to `<arbiter>/main` (merge mode) or pushes the branch + requests review (propose mode). Express that as the write seam's **complete** transition so completion is strategy-pluggable later without reworking `complete.ts`/`integrator.ts`.

ONE strategy = current behaviour. Both integration modes (`merge`/`propose`) keep working exactly as today; the rebase-before-integrate (ADR §10), the never-`--force` rule, the propose next-step block, the local-branch deletion predicate — all unchanged. The seam only changes WHERE the "apply the complete transition" call is expressed, not WHAT it does.

## Acceptance criteria

- [ ] The complete transition (done-move + integrate) is dispatched THROUGH the write seam from `ledger-write-seam`, not hard-wired in the call site.
- [ ] Both integration modes (`merge` and `propose`) behave byte-identically: rebase-or-abort, never `--force`, propose pushes the branch + next-step, merge ff's local main, the provably-on-arbiter local-branch deletion.
- [ ] The seam signature stays storage-agnostic (no `main` in the public shape).
- [ ] No `ledgerMode`/mode/config introduced.
- [ ] Behaviour-identical: the existing `complete`/`integrator` tests pass UNCHANGED; a seam-level test asserts complete is dispatched via the seam.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `ledger-write-seam` — needs the write-seam interface + strategy to route through. (Touches `complete.ts` + `integrator.ts`; serialized BEFORE `ledger-write-seam-needs-attention`, which also edits `complete.ts`.)

## Prompt

> Route the **complete** `work/` transition through the ledger write seam (defined in the `ledger-write-seam` slice — read that slice's done file and the seam module it added FIRST). PURE REFACTOR — behaviour byte-identical.
>
> READ FIRST: `docs/adr/claim-ledger-vs-protected-main.md` (the decided seam), `src/complete.ts` (the human finish: gate → done-move → commit → rebase → integrate → switch/delete), `src/integrator.ts` (the `merge`/`propose` modes + provider seam; push is the safety-bearing action; NEVER `--force`), and ADR §6/ §10 in `docs/adr/execution-substrate-decisions.md`.
>
> Express completion's integration as the write seam's COMPLETE transition with the single (current-behaviour) strategy. Keep BOTH modes identical: propose pushes the work branch + the next-step block; merge ff's to `<arbiter>/main` and syncs local main; rebase-before-integrate aborts-and-routes-to-needs-attention on conflict (do not change that path here — it stays as-is, it just lives behind the same seam machinery the needs-attention slice will also use). Do NOT name `main` in the seam's public signature. No `ledgerMode`/mode/config.
>
> TDD with vitest; the existing complete/integrator tests must pass UNEDITED (bar mechanical call-site moves). Add a seam-level test that complete is dispatched through the seam. "Done" = acceptance criteria met and the gate is green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim ledger-write-seam-complete --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/ledger-write-seam-complete <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/ledger-write-seam-complete.md work/done/ledger-write-seam-complete.md
```

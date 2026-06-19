---
title: Route the needs-attention transition through the ledger write seam
slug: ledger-write-seam-needs-attention
prd: ledger-transition-seam
blockedBy: [ledger-write-seam-complete]
covers: [4, 7, 8, 10]
---

## What to build

Route the **needs-attention** transition (`* → needs-attention`, and the `returnToBacklog` re-queue) through the write seam. Today `needs-attention.ts` owns the move helpers directly (append reason → `git mv` in-progress|done → needs-attention → commit → optional push), called from `complete.ts`'s abort paths (red gate, rebase conflict) and the runner's stuck routing in `run.ts`. Express these as the write seam's **needs-attention** transition (with one strategy = current behaviour) so the later `needs-attention-cherry-pick` surfacing is built _against_ the seam rather than bolted onto the move code.

ONE strategy = current behaviour. The reason-block-in-the-body (never a frontmatter field — WORK-CONTRACT rule 3), the bounce-from-whichever-folder logic, the ONE-atomic-commit transition, the optional branch push, and the `returnToBacklog` path all stay byte-identical. The seam only changes how the "apply the needs-attention transition" call is expressed.

## Acceptance criteria

- [ ] needs-attention routing (and `returnToBacklog`) are dispatched THROUGH the write seam, not called as standalone hard-wired helpers.
- [ ] `complete.ts`'s abort paths (gate-failed, rebase-conflict) and the runner's stuck routing (`run.ts`) drive needs-attention via the seam.
- [ ] Reason recorded as body prose (not frontmatter); the move is ONE atomic commit; surface (`status`) still reads the reason — all unchanged.
- [ ] The seam signature stays storage-agnostic (no `main` in the public shape).
- [ ] No `ledgerMode`/mode/config introduced. No cherry-pick-to-main here (that is the separate `needs-attention-cherry-pick` PRD, built later against this).
- [ ] Behaviour-identical: existing needs-attention / complete-abort / run tests pass UNCHANGED; a seam-level test asserts dispatch via the seam.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `ledger-write-seam-complete` — both this slice and the complete slice edit `complete.ts`; serialized to avoid a merge conflict (the runner never auto-resolves — ADR §10 — so we avoid the conflict at slice time). Also transitively needs the seam interface from `ledger-write-seam`.

## Prompt

> Route the **needs-attention** `work/` transition through the ledger write seam (defined in `ledger-write-seam`; the complete transition was wired in `ledger-write-seam-complete` — read both their done files + the seam module FIRST). PURE REFACTOR — behaviour byte-identical.
>
> READ FIRST: `docs/adr/claim-ledger-vs-protected-main.md` (the decided seam), `src/needs-attention.ts` (`routeToNeedsAttention`, `returnToBacklog`, `readNeedsAttentionItems`; reason is BODY prose, never frontmatter — WORK- CONTRACT rule 3; the move is ONE atomic commit), the abort paths in `src/complete.ts` (gate-failed + rebase-conflict call `routeToNeedsAttention`), the runner's stuck routing in `src/run.ts`, and ADR §12.
>
> Express needs-attention routing + the return-to-backlog re-queue as the write seam's NEEDS-ATTENTION transition with the single (current-behaviour) strategy. Keep everything identical: reason-in-the-body, bounce from in-progress OR done, one atomic commit, optional branch push, `status` reading the reason. Do NOT add the cherry-pick-to-main surfacing (that is the later `needs-attention-cherry-pick` work, which will build on THIS seam). Do NOT name `main` in the seam signature. No `ledgerMode`/mode/config.
>
> TDD with vitest; existing needs-attention/complete-abort/run tests pass UNEDITED (bar mechanical call-site moves). Add a seam-level test asserting needs-attention is dispatched through the seam. "Done" = acceptance criteria met and gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim ledger-write-seam-needs-attention --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/ledger-write-seam-needs-attention <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/ledger-write-seam-needs-attention.md work/done/ledger-write-seam-needs-attention.md
```

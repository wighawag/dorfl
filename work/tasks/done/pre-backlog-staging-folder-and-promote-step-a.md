---
title: STEP A — pre-backlog/ staging folder + runner-owned promote (backlog/ stays the pool)
slug: pre-backlog-staging-folder-and-promote-step-a
prd: staging-pool-position-gate-and-trust-model
blockedBy: []
covers: [1, 4, 7, 13, 15]
---

## What to build

The lowest-risk tracer of the staging/pool position gate (PRD US #13, the STEP-A
migration). Introduce a `work/pre-backlog/` STAGING folder while `work/backlog/`
KEEPS meaning "the eligible pool" — so EVERY existing reader (scan, claim,
select-priority, the mirror pool scan) is byte-for-byte unchanged. The only new
behaviour is end-to-end:

1. **Land staged output in `pre-backlog/`.** Wire the runner so the SLICER's
   emitted output (the `do prd:<slug>` slicing path) lands in `work/pre-backlog/`
   instead of `work/backlog/`. SCOPE THIS SLICE TO SLICER OUTPUT ONLY — the
   untrusted-origin and policy-driven placement decisions are a later slice; here
   the placement is the simple fixed "slicer output is born staged." The agent
   still WRITES only into the staging folder; the runner OWNS the move into it
   (the "agent does not move files" rule restated to cover CREATION, PRD US #4 /
   the governing ADR).
2. **Add the runner-owned `pre-backlog → backlog` PROMOTION.** A new
   runner/human-owned ledger move (a durable `main` move, the same category as the
   existing `requeue` `<status>/<slug>.md → work/backlog/<slug>.md` tree-less CAS)
   that promotes a staged item into the pool. An AGENT path CANNOT perform it
   (placement + promotion are structural, runner-owned).

This is a thin path through all layers: a placement decision (where slicer output
is born) + a promotion verb + tests on a bare arbiter. It delivers the
human-pool-control and review-without-PR value immediately (slices land staged and
not eligible; a human promotes the approved ones), with a tiny blast radius
because no existing reader's meaning changes. It does NOT do the STEP-B rename
(`backlog → todo`, `pre-backlog → backlog`) — that is deliberately deferred to the
taxonomy reorg PRD (`folder-taxonomy-reorg-and-rename.md`), which owns the
`work-layout` path module the rename needs. Do NOT introduce that module here.

## Acceptance criteria

- [ ] A `work/pre-backlog/` folder exists as the staging area; the slicing path's
      emitted slice files land there, NOT in `work/backlog/`.
- [ ] `work/backlog/` STILL means the eligible pool: the claim CAS, the build/slice
      selection pool, and the local/mirror state reads continue to read
      `work/backlog/` and behave byte-for-byte as before (a regression check on the
      existing readers, not just the new path).
- [ ] A runner-owned `pre-backlog → backlog` promotion moves one staged file into
      the pool and commits it (a durable `main` move); after promotion the item is
      claimable.
- [ ] The promotion is RUNNER/human-owned: there is no agent code path that can
      perform it, and the agent's emitted output lands where the runner places it
      (in `pre-backlog/`) regardless of where the agent tried to write — proven by a
      test, not asserted in prose.
- [ ] Tests cover the new behaviour on a `--bare file://` arbiter using the house
      pattern (`test/helpers/gitRepo.ts`: `seedRepoWithArbiter`, `gitEnv`,
      `raceClone`, `racerEnv`); shape-reference `test/item-lock-ref.test.ts`.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Implement STEP A of the staging/pool position gate for SLICES: a
> `work/pre-backlog/` staging folder while `work/backlog/` keeps meaning the
> eligible pool. Read `work/prd/staging-pool-position-gate-and-trust-model.md` (US
> #1, #4, #7, #13, #15) and the governing ADR
> `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md`
> first. This is the SMALLEST independent tracer; keep it that way.
>
> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): does it still match the code and the relevant ADRs? In particular
> CONFIRM that the `work-layout` path module referenced by the PRD's STEP B does
> NOT yet exist — it is Phase 0 of the DEFERRED taxonomy PRD
> (`work/prd/folder-taxonomy-reorg-and-rename.md`). You must NOT create that module
> or do the STEP-B rename here; STEP A is purely ADDITIVE. If a dependency landed
> differently than this assumes, route the slice to `needs-attention/` with the
> discrepancy rather than building on a stale premise (WORK-CONTRACT.md "Drift is a
> needs-attention signal").
>
> WHERE TO LOOK (by concept, not brittle paths): the slicing path that already
> routes slicer output through the runner is the `do prd:<slug>` orchestration
> (`src/slicing.ts` — `stageSlicingLifecycle`, which writes + `git add`s the emitted
> `work/backlog/*.md` files, and feeds `performIntegration` in
> `src/integration-core.ts` via the `lifecycle` seam). That stage function is where
> the emitted-file destination is decided — retarget the emitted slice writes to
> `work/pre-backlog/`. The agent-write path is already path-validated/defensive (a
> write outside the staging folder is skipped) in `src/slicing.ts` and
> `src/slicer-review-loop.ts` — update those fences consistently so the agent's
> staging folder is `pre-backlog/`. The pool READERS to leave UNCHANGED: the claim
> CAS (`src/claim-cas.ts`, `work/backlog/${slug}.md`), the local/mirror state read
> seam (`src/ledger-read.ts resolveLocalState` + the mirror tree reads), the
> selection pool (`src/select-priority.ts`, `src/scan.ts`, `src/mirror-pool-scan.ts`).
>
> THE PROMOTION VERB: model it on the existing `requeue` move (`src/ledger-write.ts`,
> the tree-less CAS that moves `work/<status>/<slug>.md → work/backlog/<slug>.md`):
> add a runner/human-owned `work/pre-backlog/<slug>.md → work/backlog/<slug>.md`
> promotion that publishes a durable `main` move. It is RUNNER-owned — do not add
> any agent-facing path that performs it.
>
> SEAMS TO TEST AT: a `--bare file://` arbiter via `test/helpers/gitRepo.ts`
> (`seedRepoWithArbiter`, `gitEnv`, `raceClone`, `racerEnv`); shape-reference
> `test/item-lock-ref.test.ts`. Tests live in `packages/dorfl/test/*.test.ts`.
> Prove: (a) slicer output lands in `pre-backlog/`; (b) `backlog/` readers are
> unchanged and still treat `backlog/` as the pool; (c) the runner-owned promotion
> moves a file into the pool and makes it claimable; (d) the agent cannot self-place
> into the pool nor perform the promotion.
>
> "DONE" means the acceptance criteria above hold and
> `pnpm -r build && pnpm -r test && pnpm format:check` is green. Run `pnpm format`
> (the writer) to fix formatting. Do NOT commit or move files between work/ folders
> — the runner/human owns git transitions.
>
> RECORD non-obvious in-scope decisions (a new placement constant, the promotion
> commit subject shape, whether `pre-backlog/` participates in any duplicate-slug
> ledger guard) as an ADR if they meet the ADR gate, else a brief `## Decisions`
> note in the done record.

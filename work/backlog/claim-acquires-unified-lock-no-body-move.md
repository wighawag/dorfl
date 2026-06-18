---
title: Retarget CLAIM onto the unified lock (no body move; pool stays backlog/)
slug: claim-acquires-unified-lock-no-body-move
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer]
covers: [1, 3, 15, 16]
---

## What to build

Retarget the CLAIM path off the shared-`main` CAS (`git mv backlog→in-progress`)
onto the unified per-item lock. After this slice, claiming an item ACQUIRES its
per-item lock with `action: implement` instead of moving its body, and the body
STAYS at `work/backlog/<slug>.md` on `main` (it never relocates until the durable
promotion). This kills the claim path's false contention (per-item refs never
falsely contend) and lets an agent claim on a protected `main` (claim no longer
writes `main`).

The claimable predicate becomes: **the slug's body is in the pool on `main`
(TODAY `backlog/`) AND no lock is held on its lock ref.** Selection readers that
treat `backlog/` as the clean "unclaimed pool" must now SUBTRACT lock-held slugs
(because the body stays in `backlog/` while held). A loser of the lock CAS is told
`lost` definitively (no retry budget), exactly as today's claim distinguishes
`lost` from contended.

NOTE on the pool name: today the eligible pool IS `backlog/` (the position gate's
STEP-A landed; `pre-backlog/` is staging). The deferred STEP-B rename will make the
pool `todo/`; when it lands, only the folder NOUN read as "the pool" changes, this
predicate's shape is unaffected. Build against `backlog/` now.

## Acceptance criteria

- [ ] `performClaim` acquires the per-item lock (`action: implement`) instead of
      `git mv backlog→in-progress`; the body stays in `work/backlog/<slug>.md`.
- [ ] Claimable predicate = "in `backlog/` on `main` AND no lock held"; the
      selection readers that enumerate the pool subtract lock-held slugs.
- [ ] Race tests on a `--bare file://` arbiter: N claims of DIFFERENT items → ZERO
      `push rejected ... main is contended` (no exit-3); two claims of the SAME item
      → exactly one wins, the other is definitively `lost`.
- [ ] Claim writes NOTHING to `main` (a protected-`main` claim succeeds); the body
      is not relocated.
- [ ] `--resume` reads the body from `backlog/` on `main` plus the lock ref for
      held-ness (no in-progress body to read).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API claim acquires through).

## Prompt

> Retarget the CLAIM path onto the unified per-item lock from
> `unified-item-lock-module-from-tracer`. Today claim is a shared-`main` CAS that
> `git mv`s the body `backlog→in-progress` (`packages/agent-runner/src/claim-cas.ts`,
> `performClaim`), read it first. The new behaviour: claim ACQUIRES the per-item lock
> (`action: implement`) and does NOT move the body; the body stays at
> `work/backlog/<slug>.md`. PRD `work/prd/ledger-status-per-item-lock-refs.md` (US #1,
> #3, #15, #16); ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`; the trail's
> Amendment 5 (the claimable-pool retarget) and Amendment 3 (protected-main).
>
> CRITICAL, on pool vocabulary: the eligible pool TODAY is `work/backlog/` (read the
> PRD's VOCABULARY CORRECTION banner, the position gate's STEP-A landed; `todo/` is
> the DEFERRED STEP-B rename, NOT this work). So the claimable predicate is "body in
> `backlog/` on `main` AND no lock held on the lock ref", and every reader that treats
> `backlog/` as the clean unclaimed pool (`scan.ts`, `select-priority.ts`,
> `mirror-pool-scan.ts`, the claimability check in `claim-cas.ts`) must SUBTRACT
> lock-held slugs (enumerate held locks via the lock module's `list`, exclude them).
> Do NOT introduce `todo/`.
>
> The exclusion is the lock CAS itself (one winner, no retry budget), a loser is
> `lost`, not contended. Verify `--resume` (`readSliceOnArbiter` in `ledger-read.ts`)
> reads the body from `backlog/` and checks the lock ref for held-ness, since there is
> no `in-progress/` body anymore. Test on a `--bare file://` arbiter
> (`test/helpers/gitRepo.ts`): high fan-out different-item claims = zero exit-3;
> same-item = exactly one winner; claim writes nothing to `main`. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. This is the load-bearing claim invariant; record non-obvious
> in-scope decisions per the slice template.

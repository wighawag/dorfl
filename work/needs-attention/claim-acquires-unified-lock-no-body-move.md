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

## Needs attention

This slice cannot be built green in isolation: its mandated behaviour deletes a product (`work/in-progress/<slug>.md` on `main` + the `claim:<slug>` commit) that multiple OTHER commands still consume by folder, and the slices that retarget those consumers are declared `blockedBy` THIS slice (an inverted, unbuildable order).

FALSE/UNRESOLVED PREMISE — the interim cross-command contract is unspecified. The slice mandates (acceptance criteria, verbatim): `performClaim` acquires the per-item lock instead of `git mv backlog→in-progress`; the body stays in `work/backlog/<slug>.md`; "Claim writes NOTHING to `main`"; and "`--resume` ... no in-progress body to read". All four remove the `in-progress/`-on-`main` artifact. But these consumers, NONE listed in this slice and NONE lock-aware today, still depend on that artifact:
- `src/complete.ts` — `git mv work/in-progress/<slug>.md → work/done/<slug>.md` (its SOURCE folder is `in-progress/`; lines ~579-651). With no `in-progress/` body, complete cannot find the item.
- `src/start.ts` — dispatches on `folderOnArbiterMain` (`backlog`→claim, `in-progress`→resume, `needs-attention`→resolve). A claimed item now reads as `backlog`, so `start` would RE-claim it.
- `src/needs-attention.ts` — surfaces `in-progress → needs-attention` on `main`.
- `src/do.ts` / `src/run.ts` — onboard the work branch off `claim.claimCommit` (the in-place strategy HARD-FAILS in `isolation.ts` ~L402-413 if that commit is unreachable from `<arbiter>/main`), and bounce via the tree-less `in-progress → needs-attention` surface. With claim writing nothing to `main`, `claimCommit` is undefined and the surface move has no source.
- `test/claim-cas.test.ts` (and ~24 other test files) assert `existsOnArbiterMain(repo,'in-progress',slug)===true`, `backlog===false`, `claimCommit===arbiter/main` with subject `claim:<slug>`, and read `in-progress/` to tell "lost" from "not found". All of these invert under the new behaviour.

INVERTED DEPENDENCY ORDER (verified in the frontmatter): the slices that retarget the above onto lock state are declared downstream of this one:
- `needs-attention-as-stuck-lock-state` (#6): `blockedBy: [lock-entry-state-machine-and-invariants, claim-acquires-unified-lock-no-body-move]`
- `complete-lock-then-durable-main-move-crash-safe` (#7): `blockedBy: [claim-acquires-unified-lock-no-body-move, needs-attention-as-stuck-lock-state]`
- `retire-transient-folders-and-drop-rebase` (#9): `blockedBy: [claim-acquires-unified-lock-no-body-move, slicing-acquires-unified-lock, advancing-acquires-unified-lock, needs-attention-as-stuck-lock-state, complete-lock-then-durable-main-move-crash-safe]`

So #6/#7/#9 (which fix complete/start/needs-attention/do/run + the tests) cannot start until #3 lands, yet #3 as written breaks exactly those commands and tests — `pnpm -r build && pnpm -r test && pnpm format:check` cannot be green at the end of #3. This is a load-bearing, hard-to-reverse design decision (the interim contract for "claimed item whose body is still in `backlog/` on `main`, status only on the lock ref") that the slice leaves unspecified; I will not guess it.

SUGGESTED RE-SCOPE (pick one, human to decide):
1. Keep claim DUAL-WRITING the `in-progress/` body on `main` (today's `git mv`) AS WELL AS acquiring the lock, in this slice, so all downstream folder consumers and tests keep passing; defer the "claim writes NOTHING to `main` / no `in-progress/` body" half and the `--resume`-reads-only-backlog half to the capstone (#9) once complete/start/needs-attention/do are lock-aware. This contradicts this slice's "claim writes NOTHING to `main`" + protected-`main` criteria, so it is really a re-scope, not a silent resolution. OR
2. Re-order: make this slice `blockedBy` (or merge it with) #6/#7/#9 so claim-stops-moving-the-body lands TOGETHER with the complete/needs-attention/do/run/test retargets as one coherent cut-over (a big slice, but a green one). OR
3. Restrict THIS slice to the genuinely back-compatible, additive halves only — (a) acquire the lock at claim time IN ADDITION to today's `backlog→in-progress` move, and (b) make the selection readers (`scan.ts`/`select-priority.ts`/`mirror-pool-scan.ts`/`claim-cas.ts` claimability) SUBTRACT lock-held slugs — and explicitly DEFER "body stays in backlog / no main write / resume-reads-backlog" to the cut-over slice. (Note: with the body still moving to `in-progress/`, lock-subtraction is redundant-but-harmless, so even this needs the human to confirm the intended interim semantics.)

Whichever is chosen, the slice text must state the interim on-`main` claim product and which `in-progress/`-folder consumers (`complete`, `start`, `needs-attention`, `do`, `run`) + tests are in/out of scope, because today it is silent on all of them while mandating their substrate be removed.

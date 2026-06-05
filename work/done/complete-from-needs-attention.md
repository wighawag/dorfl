---
title: complete a good needs-attention item — runner-owned needs-attention → done (re-gate, no manual git)
slug: complete-from-needs-attention
blockedBy: [do-in-place]
covers: []
---

## What to build

> Self-contained feature \u2014 derives from NO PRD (`covers: []`), so per
> WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live (3
> dogfood runs in): recovering a good-but-stuck item required raw git. Delete
> `work/observations/needs-attention-recovery-needs-runner-owned-complete.md` once
> this lands.

A **runner-owned `needs-attention → done` path**: when a `do`/`run` gate failure was
SPURIOUS (the work is actually fine \u2014 e.g. an env-polluted test, a transient flake,
or a cause the human has since fixed), let the runner re-gate the item's branch and,
if green, COMPLETE it \u2014 so the human never does git. Pairs with `requeue`
(`needs-attention → backlog`, the give-up/redo path); this is the "it's fine, finish
it" path.

### Mechanism (DECIDED \u2014 extend `complete`, no new verb, no `resume` dependency)

`complete` (`src/complete.ts`) already does the whole ritual (gate \u2192 done-move \u2192
rebase \u2192 integrate). Its ONLY blocker is that it requires the item in
`work/in-progress/` (the `existsSync(inProgress)` guard at ~L273 refuses otherwise:
"nothing to complete"). So:

- **Make `complete` ALSO accept a `needs-attention/` item.** When
  `work/in-progress/<slug>.md` is absent, fall back to
  `work/needs-attention/<slug>.md`; if found there, treat it as the recovery source.
- **Re-run the GATE (authoritative \u2014 do NOT trust the human blindly).** The recovery
  only completes if the gate is now GREEN. A genuinely-bad item cannot be
  force-completed through this path (the existing human-only `--skip-verify` escape
  hatch remains the deliberate, loud override; the runner still never skips).
- **On green, do the `needs-attention → done` transition** (instead of
  `in-progress → done`): `git mv work/needs-attention/<slug>.md →
  work/done/<slug>.md`, commit, rebase, integrate \u2014 the same runner-owned machinery,
  just a different source folder. The recorded `## Needs attention` reason block in
  the body: leave it as durable history (do NOT silently scrub it) unless trivial to
  decide otherwise \u2014 a completed item keeping its "was stuck because X" note is fine.
- **RECONCILE the on-`main` surfacing commit.** The needs-attention move was
  cherry-picked to `<arbiter>/main` (the autonomous on-`main` surfacing). Completing
  the item must reconcile that so the human does not hit a rebase conflict against
  the surfacing commit (the manual recovery hit EXACTLY this). The runner-owned path
  must handle the reconciliation (the done-move supersedes the surfaced
  needs-attention state on `main`).

### Scope + non-dependencies

- **Do NOT depend on `resume`** \u2014 `human-face-verbs` (which adds `resume`) is NOT
  built yet. This is a `complete` extension, standalone.
- Applies to the in-place `complete` (human) AND is what `do`'s autonomous path uses
  on a retry; keep it consistent with `complete`'s existing merge/propose +
  surfacing semantics.
- This is RECOVERY of an already-claimed item \u2014 NOT a new claim. The item is already
  the operator's (it is in their `needs-attention/`); completing it needs no re-claim.

## Acceptance criteria

- [ ] `complete <slug>` (and the equivalent path `do` uses on retry) accepts a slug
      whose file is in `work/needs-attention/` (falling back when `in-progress/` is
      absent), RE-RUNS the gate, and on GREEN does the `needs-attention → done`
      move + commit + rebase + integrate \u2014 with no manual git from the human.
- [ ] If the re-gate is RED, it does NOT complete (the item stays in
      needs-attention/); the gate stays authoritative (`--skip-verify` remains the
      only, human-only, loud override).
- [ ] The cherry-picked on-`main` surfacing of the needs-attention move is
      reconciled by completion (no leftover/conflicting surfaced state; the
      done-move supersedes it) \u2014 the human does not hit a rebase conflict.
- [ ] The pre-existing `in-progress → done` completion is UNCHANGED (no regression);
      only a `needs-attention/` SOURCE fallback + the surfacing reconciliation are
      added.
- [ ] Tests (throwaway repos + local `--bare` arbiter): a seeded needs-attention
      item with a now-green branch completes to done/ via `complete` (no manual git);
      a still-red one is refused and stays in needs-attention/; the normal
      in-progress completion still works; the surfacing commit is reconciled.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` \u2014 the autonomous `do` path + its needs-attention surfacing (the
  arbiter-passed routing) shipped with the keystone (in `done/`); this recovers
  items that path produces and reuses `complete`'s machinery. Build on it.

## Prompt

> Add a runner-owned `needs-attention → done` recovery path (read
> `work/observations/needs-attention-recovery-needs-runner-owned-complete.md`
> first). A good-but-stuck item (spurious gate failure) must be completable WITHOUT
> the human doing git \u2014 the runner owns the transition, as everywhere.
>
> MECHANISM IS DECIDED: extend `complete` (no new verb; do NOT depend on `resume`,
> which is unbuilt). `complete`'s only blocker is the `existsSync(work/in-progress/
> <slug>.md)` guard (~L273 in `src/complete.ts`, "nothing to complete"). Make it
> FALL BACK to `work/needs-attention/<slug>.md`; when recovering from there, RE-RUN
> the gate (authoritative \u2014 only complete if green; `--skip-verify` stays the
> human-only loud override), then do the `needs-attention → done` move + commit +
> rebase + integrate (same machinery, different source folder). RECONCILE the
> cherry-picked on-`main` surfacing of the needs-attention move so the human does
> not hit a rebase conflict (the done-move supersedes the surfaced state).
>
> READ FIRST: `src/complete.ts` (the `in-progress` guard to extend; the
> gate/done-move/rebase/integrate flow; the `surfaceArbiter` + merge/propose
> semantics), `src/needs-attention.ts` (the `## Needs attention` reason block + the
> move/surfacing helpers; how the surfacing commit was made \u2014 to reconcile it),
> `src/ledger-write.ts` (the transition seam), and the observation above. Keep the
> in-progress→done path unchanged.
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter): a
> needs-attention item with a now-green branch \u2192 `complete` lands it in done/ with
> no manual git; a still-red one \u2192 refused, stays in needs-attention/; the normal
> in-progress completion still works; the surfacing commit is reconciled. "Done" =
> acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim complete-from-needs-attention --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/complete-from-needs-attention <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/complete-from-needs-attention.md work/done/complete-from-needs-attention.md
```

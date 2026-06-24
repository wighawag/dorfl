---
title: do --allow-backlog — flag + resolver + claim predicate + done-move (keystone)
slug: do-allow-backlog-flag-resolver-claim-and-done-move
prd: do-allow-backlog-drive-staged-tasks-without-promotion
blockedBy: []
covers: [1, 2, 3]
---

## What to build

The keystone vertical for `dorfl do task:<slug> --allow-backlog`: a human can
resolve, claim, build, and complete a task that lives in `tasks/backlog/`
(staging) IN PLACE, without first promoting it to `tasks/ready/` — so no CI
`advance` leg or local `run` daemon can claim it out from under them.

End-to-end behaviour (one thin path through every layer):

- **Flag.** Add a `--allow-backlog` boolean flag to `do` (default off), threaded
  `do` CLI → `do` options → the resolution + claim path.
- **Resolution.** When the flag is set, `resolveTask` (the seam used at both `do`
  call sites) ALSO searches `tasks-backlog` — at LOWEST priority, after
  `tasks-ready` (so a slug present in both resolves to the ready copy; see the
  PRD's same-slug decision).
- **Claim predicate.** The claimable predicate (today keyed on the body resting
  in the pool folder) must ALSO accept a `tasks/backlog/`-resident body when the
  flag is set. Claim STAYS a pure per-item-lock acquire: it writes NOTHING to
  `main` and does NOT `git mv` the body (the body stays in `tasks/backlog/`).
  The held lock excludes competitors folder-agnostically (the pool scan already
  subtracts held slugs), so no move is needed for exclusion.
- **Done-move.** On completion, the task moves `tasks/backlog/ → tasks/done/`
  DIRECTLY (the human's explicit `--allow-backlog` drive IS the promotion; it
  never bounces through `tasks/ready/`). Add `tasks-backlog` to the done-move
  `source` union + the local pre-flight detection, AND confirm the arbiter-side
  reconciler (the authority that resolves the actual source folder from the
  arbiter) likewise discovers a `tasks/backlog/`-resident slug.

Claim CAS, per-item lock semantics, the build agent, the acceptance gate, and
Gate-2 are otherwise unchanged — the flag only lets `do` FIND, CLAIM, and
COMPLETE a staged task.

## Acceptance criteria

- [ ] `dorfl do task:<slug> --allow-backlog` resolves a task that exists ONLY in
      `tasks/backlog/`, claims it (per-item lock; nothing written to `main`),
      builds it, and the completed task lands in `tasks/done/` (full
      backlog→done path, not just resolution).
- [ ] WITHOUT the flag, the same staged task fails to resolve (`no task … found`)
      — no silent widening.
- [ ] Claim of a backlog-resident task writes nothing to `main` and does not
      `git mv` the body (the body stays in `tasks/backlog/` until the done-move);
      a protected-`main` repo can still be claimed.
- [ ] A slug present in BOTH `tasks/ready/` and `tasks/backlog/` resolves to the
      `tasks/ready/` copy (precedence: ready before backlog).
- [ ] The arbiter-side done-move reconciler resolves a `tasks/backlog/`-resident
      slug correctly (the move targets the right source folder).
- [ ] Tests cover the new behaviour (throwaway-git-repo pattern, mirroring the
      existing `resolveTask` + `do`/`complete` integration tests).

## Blocked by

- None — can start immediately.

## Prompt

> Goal: implement `dorfl do task:<slug> --allow-backlog` so a human can drive a
> staged (`tasks/backlog/`) task in place without promoting it, per the PRD
> `do-allow-backlog-drive-staged-tasks-without-promotion` (Resolved decisions 1,
> 2, 4, 5).
>
> Where to look (by concept, not brittle paths):
> - `resolveTask` (the task-resolution seam; today its search order is
>   `['in-progress', 'tasks-ready']`) — add `tasks-backlog` (lowest priority)
>   when the flag is set. It is called from the two `do` build/continue sites.
> - the `do` CLI flag parsing + the `do` options type — add `--allow-backlog`,
>   default off.
> - the CLAIMABLE PREDICATE in the claim path (`claim-cas.ts`): today it keys on
>   the body resting in the pool folder. Widen it to ALSO accept a
>   `tasks/backlog/`-resident body under the flag. KEEP claim a pure lock: NO
>   `git mv`, NOTHING written to `main` (the per-item-lock cutover deleted the
>   old claim-time move on purpose; do not revive it). Competitor exclusion is
>   the HELD LOCK (the pool scan subtracts held slugs regardless of folder), not
>   the folder — so no move is needed.
> - the done-move `source` resolution (`complete.ts` — the typed
>   `source: 'tasks-ready' | 'in-progress' | 'needs-attention' | 'done'` union +
>   the `onBacklog`-style pre-flight) AND the arbiter-side authority
>   (`integration-core.ts`'s `reconcileDoneMoveAgainstArbiter`, which resolves
>   the ACTUAL source folder from the arbiter — the local `source` is a
>   fallback, not the authority). Add `tasks-backlog` so a flag-driven build
>   done-moves `tasks/backlog/ → tasks/done/` directly.
>
> CRITICAL — do NOT move the body to `tasks/ready/` on claim. The PRD explicitly
> REJECTED that alternative: it re-couples claim to a `main` write (losing the
> protected-`main` property the per-item-lock cutover, ADR
> `ledger-status-on-per-item-lock-refs`, deleted) and buys nothing (the lock
> already excludes competitors). The body's folder is durable resting STATUS,
> never claimed-ness.
>
> RECORD non-obvious in-scope decisions (e.g. exactly how the claim predicate is
> widened, how the arbiter reconciler learns `tasks-backlog`) in a `## Decisions`
> block on the done record or an ADR if they meet the ADR gate.
>
> Scope: the LEAK-FENCE assertions (that run/auto-pick/advance never set the
> flag), the `resolveTask` doc-comment fix, the drive-tasks skill update, and the
> WORK-CONTRACT principle are SEPARATE tasks — do not do them here, but do not
> regress them either (keep the flag off every autonomous path).

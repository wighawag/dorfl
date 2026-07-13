---
title: A bounce surfaces a question sidecar on main + releases the lock (one crash-safe transition)
slug: bounce-surfaces-stuck-sidecar-and-releases-lock
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: []
covers: [1, 3, 4, 8]
---

## Answered design decisions (2026-07-13 — resolving the build agent's 3 surfaced questions)

The first build attempt correctly STOPPED and surfaced 3 load-bearing questions rather than guessing (the blast radius is bigger than the original prompt implied: **106 `stuckLockOnArbiter(...).toBe(true)` assertions across 30 test files** pin the OLD observable). The maintainer's answers, build to these:

**A1 — the new pinned observable of a landed bounce = the TRIPLE, with two new house-style helpers.** A landed bounce is observed as: (a) `stuckLockOnArbiter(repo, slug).toBe(false)` (lock RELEASED, not amended to stuck), (b) the item's `work/questions/<type>-<slug>.md` sidecar EXISTS on `<arbiter>/main`, (c) the item body's frontmatter on `<arbiter>/main` has `needsAnswers:true`. ADD two asserters to `packages/dorfl/test/helpers/gitRepo.ts` mirroring `stuckLockOnArbiter`'s shape: `sidecarSurfacedOnArbiterMain(repo, slug)` and `needsAnswersOnArbiterMain(repo, slug)` (build on the existing `pathOnArbiterMain` / `existsOnArbiterMain` / `parseFrontmatter`). Migrate the 106 assertions to this triple. ONE house-style observable, not 106 ad-hoc rewrites.

**A2 — interim recovery predicate: NARROW, main-authoritative, on the new path only.** Make the new bounce crash-safe on its own terms: a held per-item lock whose item on `<arbiter>/main` carries `needsAnswers:true` + a matching sidecar is CLEARABLE (main is authoritative, mirroring `complete`'s hold→land→release). But DO NOT rewrite the existing `stuck`-based recovery in `gc --ledger` / `resumeItemLock` / `release-lock` in THIS task — that broad change is the CONTRACT step owned by `retire-stuck-lock-state`. Interim, the new main-authoritative clearable-check and the old `stuck`-based recovery COEXIST. Add only the minimal predicate needed so a crash between step 1 (surface) and step 2 (release) is deterministically resolved.

**A3 — ALL cleanly-surfaced bounce outcomes flip to exit 0 (not just `agent-stopped`).** Per spec decision #1 ("a cleanly-surfaced bounce is GREEN") and user story #8, EVERY outcome that routes through the surface transition — `agent-stopped`, `agent-failed`, `gate-failed`, `needs-attention` (rebase-conflict), tasking-lock-failure, and the empty-diff backstop — becomes `exitCode: 0` WHEN ITS SURFACE TRANSITION SUCCEEDED; only a FAILED surface (sidecar not written / lock not released) stays non-zero. Narrowing to `agent-stopped` alone would be incoherent: a gate-failed leg that cleanly parks its sidecar is in the identical good-tree, human-owes-an-answer state. This is the CI-legibility payoff — the matrix reds only on a genuinely bad tree, greens on every clean park.

**Re-scope into TWO sequential slices (the build agent's sound suggestion, adopted):** land this keystone as (A) the new `bounce-surface` primitive + wire BOTH `applyNeedsAttentionTransition` and `applyTreelessNeedsAttentionTransition` to it + the two new test helpers + FOCUSED new tests (end-to-end surface, tree-less/protected-main, ordering/crash-safety per A2, exit-code semantics per A3); THEN (B) the bulk mechanical migration of the 106 pinned assertions across the 30 files to the A1 triple + the A2 recovery-predicate wiring. Each PR is then reviewable against a single decision and the tree is never half-migrated. Build slice A first; slice B may be its own follow-up if A's PR is already large — use judgement, but do NOT land a half-migrated tree (if A and B are one PR, keep the suite green throughout).

## What to build

Re-point the BOUNCE seam so that when an autonomous leg cannot finish an item (agent-stopped, gate-failed on the rebased tip, rebase-conflict, tasking-lock failure) it SURFACES the item on `main` instead of leaving a `stuck` lock. Concretely, one ORDERED, crash-safe transition:

1. Write/append the item's `work/questions/<type>-<slug>.md` sidecar (a `stuck`-kind sidecar) carrying the bounce REASON + any agent-surfaced questions, AND set `needsAnswers:true` on the item body — as ONE atomic commit, THEN publish it to the arbiter `main`. Reuse the surface rung's FULL two-step pattern, NOT just the local half: `persistSurfacedQuestions` (the local one-commit append-or-create + set `needsAnswers`) FOLLOWED BY the tree-less publish (`pushTreelessResult`, the bounded re-fetch+rebase retry, gated by `TREELESS_RUNGS`). This is LOAD-BEARING: a bounce can happen against a PROTECTED `main` with NO working tree to commit in (that is precisely why the needs-attention→lock-stuck cutover exists — a protected-`main` bounce must succeed tree-lessly). Reusing ONLY `persistSurfacedQuestions` (the working-tree-bound local commit) would regress that protected-`main` case. The `stuck` SidecarKind already exists.
2. THEN release/delete the per-item lock ref.

The item now RESTS as a plain `needsAnswers:true` pool item — human-visible on `main`, and naturally excluded from the build/slice pool (a `needsAnswers:true` item is `eligible:false` by construction). Nothing re-surfaces it automatically; the existing apply rung drains it once answered (a later task adds reset; cancel rides the renamed `dispose`).

CRASH-SAFETY (ordered, `main`-authoritative — reuse `complete`'s hold→land→release rule):
- Order is load-bearing: surface-to-`main` (step 1) FIRST, release lock (step 2) SECOND.
- Crash after 1 before 2 → `main` shows the item surfaced, an orphan lock lingers → recovery reads `main` (authoritative), just releases the orphan lock. Idempotent.
- Crash before 1 → nothing on `main`, lock held with no live holder → recovery clears the lock, item re-eligible, a later tick re-attempts the bounce.
- The reverse order (release then surface) is FORBIDDEN (would leave the lock gone but the item never surfaced).

Also FOLD IN the exit-code consequence (resolved decision #1): a cleanly-surfaced bounce is a BENIGN outcome (`exitCode: 0`, joining `already-triaged`/`vanished`) because the tree is in a good, loop-drained state and the sidecar on `main` is the "a human owes an answer" signal. GREEN IFF THE SURFACE TRANSITION SUCCEEDED — if the surface/release fails, the item is NOT cleanly parked, so that stays non-zero. This retires the raw exit-1 `agent-stopped` dead-end; update the pinned exit-code assertions accordingly.

## Acceptance criteria

- [ ] A bounce writes a `stuck`-kind `work/questions/<type>-<slug>.md` sidecar (reason + any surfaced questions) AND sets `needsAnswers:true` on the item body in ONE commit to `main`, THEN releases the lock — verified end-to-end.
- [ ] After a bounce, NO `stuck` lock remains for the item (the lock is released, not amended to `stuck`); the item is a `needsAnswers:true` pool item that is `eligible:false`.
- [ ] Crash-safety: a simulated crash between step 1 and step 2 (and before step 1) resolves deterministically from `main` — never a dangling `needsAnswers` with no sidecar, never a held lock with an already-surfaced item.
- [ ] A cleanly-surfaced bounce returns `exitCode: 0` (benign, like `already-triaged`); a bounce whose surface transition FAILED returns non-zero. The pinned `agent-stopped` exit-code tests are updated to the new semantics (they previously asserted exit 1).
- [ ] Tests cover the surface-on-bounce transition, the ordering/crash-safety, and the exit-code semantics, mirroring the existing lock/sidecar/ledger-write test style.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: make a BOUNCE (a leg that cannot finish an item) SURFACE the item as a question sidecar on `main` + set `needsAnswers:true` + RELEASE the lock, in one ordered crash-safe transition — instead of leaving a `stuck` lock behind. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (the keystone; user stories 1, 3, 4, 8 and resolved decisions #1 and #4). This does NOT remove the `stuck` state yet (a later task, `retire-stuck-lock-state`, does the contract step once nothing produces it) — this task STOPS PRODUCING it and starts surfacing instead.
>
> FIRST, drift-check: confirm the bounce seam still routes through the needs-attention/mark-stuck lock-amend path, the surface rung still has an atomic "write sidecar + set needsAnswers in one commit" primitive, and a `stuck` SidecarKind exists. If any changed, route to needs-attention with the discrepancy.
>
> Domain vocabulary: a BOUNCE today is a PURE LOCK AMEND — the seam marks the per-item lock `state: stuck` with the reason (and any agent questions) on the lock entry, and it is (for a protected/after-commit item) TREE-LESS (a CAS to the arbiter ref via `applyTreelessNeedsAttentionTransition`, no working-tree commit). The SURFACE rung writes a `work/questions/<type>-<slug>.md` sidecar keyed on item identity (`<type>-<slug>`, not folder path) + sets `needsAnswers:true` ATOMICALLY via `persistSurfacedQuestions` (a LOCAL one-commit primitive in a checkout), and THEN PUBLISHES tree-lessly to the arbiter via `pushTreelessResult` (gated by `TREELESS_RUNGS`, with a bounded re-fetch+rebase retry). You MUST reuse BOTH halves — the local persist AND the tree-less publish — because a bounce reaching `main` cannot assume a writable working tree on protected `main`. The `complete` path supplies the crash-safe ORDERING to reuse ("hold → land durable `main` move → release; `main` authoritative over a stale lock"). A `needsAnswers:true` item is `eligible:false` by construction, so it naturally leaves the build pool.
>
> Where to look (by concept): the bounce/needs-attention transition seam in the ledger-write strategy (the mark-stuck path + BOTH its cwd-bound `applyNeedsAttentionTransition` AND tree-less `applyTreelessNeedsAttentionTransition` variants — the tree-less one is the model for reaching protected `main`) and the needs-attention module that composes the bounce; the surface-rung's `persistSurfacedQuestions` local primitive AND the `pushTreelessResult` / `TREELESS_RUNGS` publish it pairs with (in the advance drivers / isolated driver); the sidecar identity/keying helper; the `complete` crash-safe ordering + the recovery reader that treats `main` as authoritative; the `agent-stopped` outcome and its exit code (the pinned assertions live in the do / do-remote tests). Seams to test at: inject a canned bounce (reason + questions) and assert the surface (local persist + tree-less publish) THEN release; assert it works with NO writable working tree (the protected-`main` / tree-less path); simulate a crash between surface and release and assert `main`-authoritative recovery; assert the exit-code semantics.
>
> Ordering is load-bearing: surface-to-`main` FIRST, release SECOND (so a crash leaves a recoverable state). Do NOT reverse it. RETRY (rebase+re-push on a CAS rejection from a concurrent `main` advance) is orthogonal and still applies for CONTENTION; the ordering is for CRASHES.
>
> Done = a bounce surfaces + releases in the correct order, no `stuck` lock remains after a bounce, crash-safety holds, the exit code is green-on-clean-surface (pinned tests updated), and the acceptance gate is green. RECORD non-obvious in-scope decisions (e.g. the exact recovery predicate, or how the surfaced sidecar's questions are shaped for a reason-only bounce) durably and linked from the done record; if a decision meets the ADR gate, write an ADR.

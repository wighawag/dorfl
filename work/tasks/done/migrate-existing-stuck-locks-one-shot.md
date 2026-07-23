---
title: 'One-shot migration of existing `stuck` locks to surface-on-main + release'
slug: migrate-existing-stuck-locks-one-shot
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-surfaces-stuck-sidecar-and-releases-lock, retire-stuck-lock-state]
covers: [5]
---

## What to build

A ONE-SHOT rollout migration so no PRE-EXISTING `stuck` lock is silently stranded when the `stuck` state is retired.

At rollout, any live `stuck` lock ref (an item bounced under the old model) is converted, once, via the SAME transition the new bounce uses: surface the item on `main` (write its `stuck`-kind sidecar from the lock entry's recorded reason + questions, set `needsAnswers:true`) AND release the lock. After the migration, every previously-stuck item rests as a `needsAnswers:true` pool item with a sidecar — the same resting state a new bounce produces — and no `stuck` lock ref remains.

This is forward-migrating, NOT forward-only-ignore: the point is that items already stuck at rollout are not lost when the state that represented them is removed.

Thin vertical: enumerate the live `stuck` lock refs on the arbiter → for each, run the surface-on-main + release conversion (reusing the keystone transition) → report the converted set. Idempotent (re-running finds no `stuck` locks and is a clean no-op).

## Acceptance criteria

- [ ] The migration enumerates live `stuck` lock refs and converts EACH via the surface-on-main + release transition (sidecar with the lock entry's reason + questions, `needsAnswers:true` on the body, lock released).
- [ ] After the migration no `stuck` lock ref remains; every converted item is a `needsAnswers:true` pool item with a sidecar (the same resting shape a new bounce produces).
- [ ] The migration is IDEMPOTENT: re-running finds no `stuck` locks and is a clean no-op (safe to run more than once).
- [ ] It works on a `--bare file://` arbiter identically to a real remote (a ref is a ref), preserving the provider-agnostic kill-criterion.
- [ ] Tests cover: a repo with N stuck locks migrates to N surfaced items + zero stuck refs; a re-run is a no-op; the lock entry's reason/questions land in the sidecar.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` — provides the surface-on-main + release transition the migration reuses per item.
- `retire-stuck-lock-state` — the migration exists to drain stuck locks AT the retirement; it reads the (about-to-be-removed) `stuck` entries, so it is authored alongside/after the retirement.

## Prompt

> Goal: a ONE-SHOT, idempotent migration that converts any pre-existing `stuck` lock into the new resting shape (surface-on-main + release), so retiring the `stuck` state strands no already-stuck item. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (resolved decision #3, user story 5).
>
> FIRST, drift-check: confirm the surface-on-bounce transition (`bounce-surfaces-stuck-sidecar-and-releases-lock`) and the `stuck`-retirement (`retire-stuck-lock-state`) landed as assumed, and that live `stuck` lock refs still carry a recoverable reason (+ questions) on the entry. If the lock entry shape or the transition changed, route to needs-attention with the discrepancy.
>
> Domain vocabulary: `stuck` lock refs live on `refs/dorfl/lock/<entry>` with the bounce reason (+ any agent questions) recorded on the entry body. The new resting shape is a `needsAnswers:true` item body on `main` + a `stuck`-kind `work/questions/` sidecar. The surface-on-main + release transition is the keystone task's crash-safe ordered transition (surface first, release second). Everything must work on a `--bare file://` arbiter (a ref is a ref) — the provider-agnostic kill-criterion.
>
> Where to look (by concept): the lock-ref enumeration/read path (how held/stuck locks are listed on the arbiter); the keystone surface-on-main + release transition to reuse per item; the sidecar writer. Seams to test at: seed a repo with N `stuck` locks (each with a reason), run the migration, assert N surfaced `needsAnswers` items + zero `stuck` refs; re-run and assert a clean no-op; assert reason/questions round-trip into the sidecar. Use the `gitRepo` test fixtures (with the `rmrf` teardown helper).
>
> Where this runs (a decision to make + record): whether the migration is a dedicated CLI verb, a step folded into `gc --ledger`, or a one-shot script — pick the smallest coherent home and record why. Done = the migration converts + is idempotent + bare-arbiter-safe, tests pass, gate green. RECORD the where-it-runs decision durably, linked from the done record.

## Decisions

### Where-it-runs: dedicated CLI verb `dorfl migrate-stuck-locks` (Advanced/plumbing group)

The migration ships as its own top-level CLI verb, `dorfl migrate-stuck-locks`, registered in the Advanced/plumbing help group — NOT folded into `gc --ledger` and NOT shipped as an out-of-tree one-shot script. The inline source-of-truth for this choice is the JSDoc-style block comment at `packages/dorfl/src/cli.ts:3909-3920` (immediately above the `program.command('migrate-stuck-locks')` registration); this `## Decisions` entry is the durable back-reference the original task prompt required.

Rationale:

- **One-shot rollout event with WRITE semantics on `main`.** The migration exists purely to drain pre-existing `stuck` lock refs at the retirement of the `stuck` lock state (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`, resolved decision #3, user story 5). It writes item bodies + `stuck`-kind sidecars on `<arbiter>/main` and releases lock refs via the SAME surface-first-release-second transition a fresh bounce uses. That is a fundamentally different nature from `gc`, whose surface is report-oriented (`--ledger`) plus terminal-orphan reap; folding a WRITE-on-main rollout migration into `gc` would muddle `gc`'s contract and force its exit-code shape to grow a second meaning.
- **Exit-code contracts stay separate.** `migrate-stuck-locks` exits non-zero only when a surface CAS lost the race or a read/plumbing fault prevented migration; `gc`'s exit-code contract is its own. Keeping them in separate verbs keeps each contract narrow and testable, and lets the migration be removed cleanly once the rollout window closes without perturbing `gc`.
- **Not an out-of-tree script.** A script would not benefit from the in-repo CLI's arbiter/cwd plumbing, help/discovery, or the shared surface-transition code path — and would be harder to invoke uniformly across environments than `dorfl migrate-stuck-locks`.
- **Advanced/plumbing group, not the top-level surface.** Operators run it once at rollout; after that it is a clean no-op (the current lock module never writes `state: stuck`). Advanced/plumbing is the right discoverability tier for a one-shot rollout tool.

Alternatives considered and rejected: (a) `gc --ledger` step — rejected for the contract-muddling + exit-code reasons above; (b) standalone one-shot script — rejected because it duplicates CLI plumbing and is harder to invoke uniformly.

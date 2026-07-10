---
title: spec→spec EXPAND (follow-up) — add spec beside spec in the lock/sidecar identity (SidecarType, item-lock, typeForNamespace)
slug: expand-spec-lock-and-sidecar-namespace
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [expand-spec-frontmatter-and-namespace-aliases]
covers: [1]
---

## What to build

The SECOND expand step (§3a), added because the first expand task (`expand-spec-frontmatter-and-namespace-aliases`) covered the frontmatter/namespace/config/intake surface but MISSED the lock/sidecar identity — so `lockEntryFor('spec:foo')` currently falls through to `task-foo` (silent collision with task-build locks). This task ADDS a `'spec'` member to the lock/sidecar identity BESIDE `'spec'`, so a later batch can emit `spec-<slug>` locks/sidecars safely. Purely additive; removes nothing.

- **`sidecar.ts`:** add `'spec'` to `SidecarType` (`'spec' | 'task' | 'observation' | 'spec'`); add `spec: 'spec'` to `TYPE_TO_NAMESPACE`; add a `spec` case to `typeForNamespace` (a `spec:` prefix / `explicit === 'spec'` → `'spec'`, NOT the `task` fall-through). Keep the `'spec'` member and its mapping intact.
- **`item-lock.ts`:** add the `'spec'` case wherever `'spec'` is switched/listed — the `case 'spec':` around L884 (add a sibling `case 'spec':`) and the `['task', 'spec', 'observation']` prefix loop around L1545 (add `'spec'`), plus `terminalMainPaths`/`itemFromLockEntry` if they enumerate the namespace. Keep `'spec'` working.
- **Tests:** add a test that `lockEntryFor('spec:x') === 'spec-x'` (NOT `task-x`), and that `spec-<slug>` lock entries round-trip through `itemFromLockEntry`. Do NOT change the existing `prd-<slug>` lock assertions (they stay valid until the contract task) — this is additive.

After this, both `prd:` and `spec:` produce their own correctly-namespaced lock/sidecar entries; the migrate batch can then flip the tasking lock's EMIT side to `spec:` while `prd-<slug>` still resolves.

## Acceptance criteria

- [ ] `SidecarType` includes `'spec'`; `TYPE_TO_NAMESPACE`/`typeForNamespace` map `spec` to `'spec'` (not the `task` fall-through); `item-lock.ts` handles `spec` everywhere it handles `spec`.
- [ ] `lockEntryFor('spec:x') === 'spec-x'` (test added); `spec-<slug>` round-trips `itemFromLockEntry`.
- [ ] The existing `prd-<slug>` lock/sidecar behaviour + assertions are UNCHANGED (additive).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] Nothing removed or migrated (that is the migrate + contract tasks).

## Blocked by

- expand-spec-frontmatter-and-namespace-aliases (the first expand step — `SlugNamespace` must already carry `'spec'` so `typeForNamespace` can map an `explicit === 'spec'`).

## Prompt

> Goal: the SECOND expand step of the identity-layer wide refactor (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). Add a `'spec'` member to the LOCK/SIDECAR identity BESIDE `'spec'`, so `spec:<slug>` gets its own `spec-<slug>` lock entry instead of silently falling through to `task-<slug>`. Purely additive — remove/migrate nothing.
>
> Why this exists: the first expand task widened frontmatter/namespace/config/intake but MISSED the sidecar/lock identity. `SidecarType` in `sidecar.ts` is still `'spec' | 'task' | 'observation'` and `typeForNamespace` maps a `spec:` prefix to the `task` fall-through, so `lockEntryFor('spec:foo') === 'task-foo'` — a collision that breaks the per-item lock's isolation invariant. The `do` agent building batch 2 caught this (see work/notes/observations/spec-lock-namespace-not-expanded-migrate-batch2-blocked-2026-07-09.md).
>
> Where to look: `sidecar.ts` (`SidecarType` L72, `TYPE_TO_NAMESPACE` L~182, `typeForNamespace` L~188), `item-lock.ts` (`case 'spec'` ~L884, the `['task','spec','observation']` loop ~L1545, `terminalMainPaths`/`itemFromLockEntry`). Add the `spec` sibling everywhere `spec` is handled. Add a `lockEntryFor('spec:x') === 'spec-x'` test.
>
> Done means: `spec:` produces `spec-<slug>` locks/sidecars, `prd:` still produces `prd-<slug>` (unchanged), full gate green, nothing removed. FIRST check drift: confirm `expand-spec-frontmatter-and-namespace-aliases` landed (`SlugNamespace` carries `'spec'`).

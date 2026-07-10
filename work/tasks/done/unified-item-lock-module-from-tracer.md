---
title: Promote the tracer to the production unified item-lock module
slug: unified-item-lock-module-from-tracer
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: []
covers: [2, 3, 4, 11, 17, 19, 20, 21]
---

## What to build

The first, smallest tracer of the lock substrate: lift the GREEN proof-of-concept
in `item-lock-ref.ts` (per-item hidden ref, atomic create-only acquire, delete-to-
release, parentless lock-entry commit, two-axis `action × state` entry) into a
PRODUCTION lock module the runner can call, WITHOUT retargeting any caller yet. The
end-to-end path is: a runner-callable `acquire(item, action) → acquired|lost`,
`release(item) → released|not-held`, `read(item)`, `list()` API, keyed by the
type-encoded item identity (`<type>-<slug>`) via the SAME addressing seam the
advancing-lock already uses, all proven on a `--bare file://` arbiter.

This is deliberately a no-caller-wired slice so its blast radius is one new module
plus tests. It exists to turn the tracer into the shared primitive the claim /
slice / advance retargets (later slices) build on. Preserve every property the
tracer test already asserts: zero false contention for different items, exactly one
winner for the same item with no retry budget, self-cleaning (release DELETES the
ref), parentless commit (gc-reclaimable), and the entry round-trips.

## Acceptance criteria

- [ ] A production lock module exposes acquire / release / read / list (and the
      entry serialise/parse) as the runner's lock API, generalising the tracer.
- [ ] The lock lives on a hidden `refs/dorfl/*` ref keyed by `<type>-<slug>`;
      acquire is create-only/leased (winner creates the ref; loser is definitively
      `lost`, no retry loop), release DELETES the ref, the lock-entry commit is
      PARENTLESS.
- [ ] The two-axis entry (`action: implement|slice|advance` × `state: active|stuck`,
      + holder/since, `reason` only when stuck) serialises and round-trips.
- [ ] Race tests on a `--bare file://` arbiter: N writers for N DIFFERENT items all
      acquire with ZERO contention failures; two writers for the SAME item → exactly
      one `acquired`, one `lost`; absent ref reads as "no locks".
- [ ] No existing caller (claim/slice/advance) is changed by this slice.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter (the house pattern in
      `test/helpers/gitRepo.ts`); nothing writes outside its own temp fixtures.

## Blocked by

- None. Can start immediately.

## Prompt

> Generalise the GREEN tracer at `packages/dorfl/src/item-lock-ref.ts` (and
> its test `test/item-lock-ref.test.ts`) into the PRODUCTION unified item-lock module
> the runner will call. Read both files first, they already prove the dangerous
> core (per-item hidden ref `refs/dorfl/lock/<entry>`, atomic create-only
> acquire via `--force-with-lease=<ref>:`, delete-to-release, a PARENTLESS lock-entry
> commit built with plumbing, and a two-axis `action × state` entry that round-trips).
> Governing ADR: `docs/adr/ledger-status-on-per-item-lock-refs.md`. SPEC:
> `work/spec/ledger-status-per-item-lock-refs.md` (read its VOCABULARY CORRECTION
> banner: the pool is `backlog/`, the durable terminal is `dropped/`; the `todo/`
> rename is deferred).
>
> SCOPE: turn the tracer into a callable module with a clean API (acquire / release /
> read / list + entry serialise/parse), keyed by the `<type>-<slug>` identity the
> sidecar / `advancing-lock.ts` (`advancingMarkerPath`) already encodes, REUSE that
> addressing seam, do not invent a second identity scheme. Do NOT wire it into
> claim / slicing / advancing yet, those are separate slices that depend on this one.
> Keep ALL the tracer's invariants: zero false contention for different items, exactly
> one winner per same-item race with NO retry budget, release DELETES the ref (never
> empties it), the entry commit is parentless (gc-reclaimable), absent ref = no locks.
>
> Test at the same seam the tracer does: throwaway repos + a `--bare file://` arbiter
> via `test/helpers/gitRepo.ts` (`seedRepoWithArbiter`, `gitEnv`, `raceClone`,
> `racerEnv`). Extend to high fan-out (many different items, zero contention). "Done"
> = the production module exists, the tracer's properties hold on it, no caller is
> touched, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> NOTE: this slice is `humanOnly: true` by a DECIDED choice (not SPEC propagation):
> this is a load-bearing concurrency primitive driven via the `drive-backlog` skill so
> a human reviews each build in turn. RECORD any non-obvious in-scope decision (e.g.
> whether the production module REPLACES `item-lock-ref.ts` or wraps it) per the
> slice-template guidance.

---
title: 'Retire the `stuck` lock state (LockState = active hold only)'
slug: retire-stuck-lock-state
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-migrate-stuck-assertions-and-flip-exit-codes]
covers: [5, 6, 10]
---

## What to build

The CONTRACT step of the expand→migrate→contract sequence: now that a bounce SURFACES + RELEASES (the keystone task) instead of marking `stuck`, remove the `stuck` lock state entirely.

- Collapse `LockState` from `'active' | 'stuck'` to the active-hold only (the lock is held ONLY during live claim/build/advance work — real CAS mutual-exclusion — and is always released at the end of a leg).
- Update every reader of the LOCK STATE `state === 'stuck'` (there are ~16 sites across the lock module, the status/`format` render `entry.state === 'stuck'`, and the `start --resume`/recovery path) to operate on `active`-hold + `main`-`needsAnswers` instead. A parked item is now rendered/detected from its `main` `needsAnswers` state + its sidecar, NOT from a stuck lock.
- **CRITICAL SCOPE FENCE — do NOT touch the `stuck` SidecarKind.** The word `stuck` has TWO DISJOINT meanings: the LOCK STATE `LockState = 'active' | 'stuck'` (which THIS task retires) and the SIDECAR KIND `SidecarKind = 'merge' | 'stuck' | 'triage' | 'spec'` (a mutable dispatch axis in `sidecar.ts`, INDEPENDENT of the lock). The `stuck` SidecarKind is the KIND the surfaced-bounce sidecar is filed under (the keystone task writes it) and it MUST SURVIVE this task — it is NOT a lock-state reader. When retiring the lock state, EXCLUDE `sidecar.ts`'s `SidecarKind` entirely; "no dead `stuck` branch remains" refers ONLY to the LOCK-STATE branches, never the sidecar kind.
- Recovery (`start --resume`, `requeue`, `gc --ledger` stuck-lock report) operates on `active`-held + `main`-`needsAnswers` only. A crash-orphaned `active` lock (the ONLY lock that can now outlive a leg) is resolved by treating `main` as authoritative — simpler than the old stuck-vs-active fork.
- `dorfl status` / `scan` render a parked item from its `main` `needsAnswers` state, not a stuck lock.

This does NOT remove the per-item lock PRIMITIVE — `active` stays as the in-flight CAS. Only the `stuck` STATE is retired. Because the keystone task already stopped PRODUCING `stuck`, no live path should still write it when this lands; this task removes the now-dead state and its readers.

## Acceptance criteria

- [ ] `LockState` no longer admits `stuck` (the lock entry is an active hold; `reason`/`questions`-on-the-lock-entry that only existed for the stuck state are removed or relocated as appropriate).
- [ ] Every former LOCK-STATE `state === 'stuck'` reader is updated: status/`format` render (`entry.state === 'stuck'`), `start --resume`/recovery, the lock module's own branches. No dead LOCK-STATE `stuck` branch remains.
- [ ] The `stuck` SidecarKind (`sidecar.ts` `SidecarKind`) is UNTOUCHED (it survives — it is the surfaced-bounce sidecar's kind, not a lock state). A test or a grep-assert confirms `SidecarKind` still admits `stuck`.
- [ ] `dorfl status`/`scan` render a parked (needs-a-human) item from its `main` `needsAnswers` + sidecar state, not from a lock.
- [ ] Recovery of a crash-orphaned `active` lock treats `main` as authoritative (re-eligible vs already-surfaced), with no stuck-vs-active fork.
- [ ] The in-flight `active` lock's CAS mutual-exclusion is UNCHANGED (a live claim/build/advance still holds it; concurrency safety is not weakened).
- [ ] Tests updated: the `stuck` state is gone from the lock/recovery/status tests; parked-item rendering + crash-orphan recovery are asserted on the new model.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` — must land first: `stuck` cannot be removed until nothing PRODUCES it (the bounce now surfaces + releases instead). This is the contract step of expand→migrate→contract.

## Prompt

> Goal: retire the `stuck` lock state — collapse `LockState` to the active hold only, and update every reader to operate on `active`-hold + `main`-`needsAnswers`. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user stories 5, 6, 10; the CONTRACT step). Keep the lock PRIMITIVE (`active` is the in-flight CAS); retire only the `stuck` STATE.
>
> FIRST, drift-check — this is the CONTRACT step and depends on the keystone: confirm `bounce-surfaces-stuck-sidecar-and-releases-lock` LANDED and that NO live path still marks a lock `stuck` (grep the producers — the mark-stuck path in the ledger-write strategy, needs-attention, tasking-lock). If any producer still writes `stuck`, do NOT remove the state — route to needs-attention (removing a still-produced state would strand items). Also confirm the `state === 'stuck'` reader set is still ~the same shape.
>
> Domain vocabulary: the per-item lock is a two-axis entry `action: implement|task|advance` × `state: active|stuck`, on a hidden `refs/dorfl/lock/<entry>` ref; `active` = in-progress hold, `stuck` = needs-attention (the state being retired). `reason`/`questions` currently ride on a `stuck` lock entry (now they live on the surfaced sidecar on `main`). A parked item is now a `needsAnswers:true` item with a sidecar on `main`. Recovery verbs: `start --resume` (reads stuck today), `requeue` (release the lock), `gc --ledger` (stuck-lock report). `main` is authoritative over a stale/orphan lock (the `complete` crash-safety rule).
>
> Where to look (by concept): the `LockState` type + the lock entry state machine and its invariants (`reason` iff stuck, etc. — those invariants change); every LOCK-STATE `state === 'stuck'` reader (the status/`format` render `entry.state === 'stuck'`, `start`'s resume/resolved path, the lock module's own transitions); the recovery/`requeue`/`gc --ledger` paths. DO NOT touch `sidecar.ts`'s `SidecarKind` — its `stuck` member is a DIFFERENT concept (the surfaced-bounce sidecar's dispatch kind) that MUST survive. Seams to test at: assert the LockState type no longer admits `stuck`; assert `SidecarKind` STILL admits `stuck`; assert status/scan render a parked item from `main` needsAnswers; assert crash-orphan `active`-lock recovery is `main`-authoritative; assert the `active` CAS mutual-exclusion still holds.
>
> Done = `stuck` is gone from the type + every reader, parked items render from `main`, recovery is `main`-authoritative, the `active` CAS is intact, and the gate is green. This is a wide-ish contract change (~16 reader sites) — land it as one coherent task (the keystone already made it safe by removing the producer). RECORD non-obvious in-scope decisions (e.g. what happens to the lock entry's now-orphaned `reason`/`questions` fields) durably; if the lock state-machine change meets the ADR gate, write/UPDATE the ADR (note: a sibling task reconciles the `ledger-status-per-item-lock-refs` spec/ADR — coordinate, don't duplicate).

## Requeue 2026-07-13

Requeued (--reset: the failed run produced no work branch) after the blockedBy fix. Now blocks on bounce-atomic-cutover-retire-stuck-lock (PR-2); stays out of auto-pick until the stuck producers are retired.

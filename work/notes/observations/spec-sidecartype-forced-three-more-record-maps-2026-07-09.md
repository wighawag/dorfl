---
title: Adding 'spec' to SidecarType compiler-forced three MORE Record<SidecarType> maps beyond the task's named list (all mirrored to prd, additive)
date: 2026-07-09
---

## What happened

`expand-spec-lock-and-sidecar-namespace` named `sidecar.ts` + `item-lock.ts` as the sites to add the `'spec'` sibling. But once `'spec'` joined `SidecarType`, TypeScript exhaustiveness surfaced THREE more `Record<SidecarType, …>` maps that were not in the task's list and would not compile without a `spec` member:

- `item-path.ts` `APPLY_LIFECYCLE_FOLDERS` — apply-write-time lifecycle folders per type.
- `advance.ts` `FOLDERS_FOR_TYPE` — frontmatter-source folders per type.
- `advance-classify.ts` `ANALYSE_RUNG_FOR_TYPE` — the ANALYSE tick-rung per type.

## Decision (recorded per the proceed-and-record bar; linked from the done record)

Each new `spec` member MIRRORS the existing `prd` member exactly (same `specs-*` folders; the same `task-prd` analyse rung), because `spec` IS the renamed parent-spec artifact and a `spec:<slug>` item rests in / routes through the identical spec-regime surface as `prd:<slug>`. This is purely additive and behaviour-preserving: `prd` entries are untouched, nothing is removed, and no user-visible default changes. It touches no OTHER command/flag/task — the migrate batches will rename these keys and the contract task drops the `prd` entries alongside the ones the task named. Alternative considered: leave them unmapped and let `spec` fall through — rejected, it does not typecheck (the maps are total over `SidecarType`) and would strand a `spec:` item with no folders/rung.

Why a note and not a STOP: these are the SAME class of definitional site the task already targets (total maps keyed by the renamed token), the mapping choice is forced + certain (mirror prd), and it introduces no new error/refusal. Recording it so a reviewer is not surprised that three sites outside the task's enumerated list changed.

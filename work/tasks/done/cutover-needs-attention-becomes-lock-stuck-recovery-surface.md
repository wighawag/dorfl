---
title: Cut-over 9b — needs-attention becomes the lock stuck state (reason on the entry); retire the folder
slug: cutover-needs-attention-becomes-lock-stuck-recovery-surface
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [cutover-claim-body-stays-and-complete-sources-from-backlog]
covers: [5, 8]
---

> **This is sub-slice 9b of the capstone re-slice (decided conductor + human, 2026-06-18),
> the DESIGN-BEARING one. The fork it rested on is RESOLVED — decision (i+) below —
> so it is buildable, NOT `needsAnswers`.**

## Resolved design decision (i+): stuck-state lives ENTIRELY on the lock entry

`needs-attention-as-stuck-lock-state` (#6) landed the interim dual-write: a bounce
marks the lock `state: stuck` (best-effort) AND still `git mv`s
`in-progress→needs-attention` on `main`, where the moved `.md` body is the
AUTHORITATIVE stuck record (reason prose + agent-surfaced questions). This slice
makes the LOCK the SOLE stuck record and RETIRES the `needs-attention/` folder
move, per decision (i+):

- **The bounce is a PURE lock amend** (`active → stuck`), NO `main` write at all
  (this also delivers a protected-`main` bounce, US #16 extended). The lock entry
  (`lock.md` in the ref tree — already a markdown-frontmatter blob) carries the FULL
  reason prose **and** any agent-surfaced questions, not a one-line `reason:` field.
  Extend the entry body to hold the rich reason/questions; `serialiseLockEntry` /
  `parseLockEntry` round-trip it.
- **The wip is UNCHANGED:** the recoverable work stays on the `work/<slug>` branch
  tip (the lock entry may record the holder/branch, but the branch is the source of
  truth for the work). The item BODY stays in `backlog/` (it never moved on claim,
  per 9a).
- **No on-`main` stuck artifact at all.** This is WHY the folder must go: a
  `needs-attention/<slug>.md` is the one MUTABLE-on-`main` record (it moves again on
  resume/requeue/complete), so a work branch cut from `main` inherits it and hits the
  rename/rename ledger conflict that `drop-bookkeeping-rebase` exists to paper over.
  Removing it is what lets 9d delete that machinery. (Terminal records
  `done`/`dropped`/`prd-sliced` are write-once, so they inherit harmlessly and STAY.)
- **Visibility trade (consciously taken, per the ADR):** a human reads a stuck
  item's reason/questions via `dorfl status` (which renders the lock entry)
  or `git show <lock-ref>:lock.md`, NOT `ls work/needs-attention/`. This is the same
  working-tree-visibility drop the ADR already made for `in-progress`.

> Future (NOT this slice; captured in
> `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`): the
> advance loop can later surface a stuck lock's reason/questions as a
> `work/questions/` sidecar and self-clear the lock on an apply pass. Keep the stuck
> reason/questions on the entry in a shape a surface rung could later render; do NOT
> build that loop here.

## What to build

Retarget the entire stuck-state recovery surface from the `needs-attention/` FOLDER
onto the lock `state: stuck`:

- **Bounce** (red gate / agent failure / conflict / ambiguity): amend the held lock
  `active → stuck` + reason/questions on the entry; NO `git mv`, NO `main` write.
  Replaces `routeToNeedsAttention` / `surfaceToNeedsAttention` /
  `applyNeedsAttentionTransition` / `applyTreelessNeedsAttentionTransition` and the
  integration-core gate-fail/rebase-conflict bounce.
- **Recovery verbs read/write the lock:** `requeue` = `stuck → released` (return to
  pool; body already in `backlog/`); `resume` / `start`-resolve = `stuck → active`;
  `complete --from-needs-attention` = re-gate the kept `work/<slug>` branch, then the
  normal hold → done-move → release. `extractReason` / `readNeedsAttentionItems`
  read the lock entry, not a folder file.
- **In-flight view:** `status` / `scan` already read the lock refs (#6) — extend them
  to render the stuck reason + questions richly (the human's recovery view).
- **Retire the `needs-attention/` folder move** end-to-end: nothing writes or reads
  `work/needs-attention/<slug>.md` anymore. (Removing `needs-attention` from the
  folder SETS `LEDGER_STATUS_FOLDERS`/`WORK_FOLDERS` can land here or in 9c — keep it
  wherever the diff stays green; if any `in-progress`/`slicing`/`advancing` consumer
  still needs the sets intact, defer the set-trim to 9c.)

## Acceptance criteria

- [ ] A bounce amends the held lock `active → stuck` + full reason/questions on the
      entry, with NO `git mv` and NO `main` write (a protected-`main` bounce
      succeeds). The lock entry round-trips the rich reason + questions.
- [ ] `requeue` (`stuck → released`), `resume`/`start`-resolve (`stuck → active`),
      and `complete --from-needs-attention` (re-gate kept branch → done-move →
      release) all operate on the lock state; none read/write `work/needs-attention/`.
- [ ] `status` / `scan` render the stuck reason + questions from the lock entry (the
      human recovery view); eligibility/selection stay offline on `backlog/`.
- [ ] No code writes or reads a `work/needs-attention/<slug>.md` folder file; a work
      branch cut from `main` inherits NO needs-attention record.
- [ ] `done` + `stuck` co-existence (state-machine invariant) still holds.
- [ ] Every existing needs-attention/bounce/requeue/resume/complete-recovery/status/
      scan test passes, retargeted onto the lock stuck state.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `cutover-claim-body-stays-and-complete-sources-from-backlog` (9a — the body rests
  in `backlog/`, which this slice's `requeue`/recovery assume).

## Prompt

> Retarget the stuck-state recovery surface from the `needs-attention/` FOLDER onto
> the lock `state: stuck`, per the RESOLVED decision (i+) in this slice's banner
> (read it — it is the design, not open). `needs-attention-as-stuck-lock-state` (#6)
> landed the interim dual-write (bounce marks the lock stuck AND `git mv`s to
> `needs-attention/`, the folder file being the authoritative record). Make the LOCK
> the SOLE record and retire the folder.
>
> Read `needs-attention.ts` (~1700 lines: `routeToNeedsAttention` /
> `surfaceToNeedsAttention` / `returnToBacklog` / `resolveFromNeedsAttention` /
> `readNeedsAttentionItems` / `extractReason`), `ledger-write.ts`
> (`applyNeedsAttentionTransition` / `applyTreelessNeedsAttentionTransition`,
> `markStuckLockBestEffort`), the integration-core bounce, `complete.ts`
> (`--from-needs-attention` recovery re-gate), `start.ts` (resolve), the `requeue`
> path, and `status.ts`/`scan.ts`. The lock state machine + the rich entry are from
> `lock-entry-state-machine-and-invariants` (`markStuckItemLock` / `resumeItemLock` /
> `requeueItemLock`, `serialiseLockEntry`/`parseLockEntry`). PRD US #5, #8; ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> Decision (i+): the bounce is a PURE lock amend (`active → stuck` + full reason +
> questions on the `lock.md` entry body), NO `main` write. The wip stays on the
> `work/<slug>` branch (unchanged); the body stays in `backlog/`. Recovery verbs read
> the lock: `requeue` = `stuck → released`, `resume`/`start`-resolve = `stuck →
> active`, `complete --from-needs-attention` = re-gate the kept branch then
> done-move/release. `status`/`scan` render the reason/questions from the entry. NO
> code reads or writes `work/needs-attention/<slug>.md` after this slice. Keep the
> `done`+`stuck` co-existence. Extend the lock entry to carry rich reason + questions
> in a shape a future advance surface rung could render (see
> `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`), but do
> NOT build that loop here.
>
> SCOPE FENCE: removing `needs-attention` from the folder SETS may land here or in 9c
> — wherever the gate stays green. Do NOT remove the `slicing`/`advancing` markers
> (9c). Do NOT delete `drop-bookkeeping-rebase` (9d) — but note this slice is what
> MAKES it deletable (no needs-attention move lands on a branch anymore). Register any
> new git-`file://`-CAS race test in `vitest.config.ts` `RACE_SENSITIVE`. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. This is load-bearing + design-heavy; record non-obvious in-scope
> decisions per the slice template.

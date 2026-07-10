---
title: advance surfaces a stuck lock as a question, and an apply pass self-clears it
status: idea
created: 2026-06-18
relatesTo: [ledger-status-per-item-lock-refs, advance-rung-surface, advance-rung-apply, advance-sidecar-contract, surface-questions-skill]
---

## The idea

Once `needs-attention` is the per-item lock `state: stuck` (SPEC
`ledger-status-per-item-lock-refs`, decision (i+): the lock entry carries the full
reason prose + any agent-surfaced questions), make a STUCK lock a first-class INPUT
to the autonomous `advance` loop, so a human's whole interaction with a stuck item
collapses to "answer a question":

- The advance **surface** rung renders a stuck lock's reason + questions into a
  `work/questions/<entry>.md` sidecar (the existing surface-questions mechanism),
  exactly as it already surfaces a `needsAnswers` item. Even a degenerate question
  ("this item is stuck for <reason>; unstick it? resume / requeue / release") is
  enough.
- The human answers the sidecar (the only thing they have to do).
- The advance **apply** rung consumes the answer and performs the LOCK TRANSITION
  automatically: `stuck -> active` (resume), `stuck -> (released)` (requeue /
  release), per the answer. No human runs `resume` / `requeue` / `release-lock` by
  hand; the apply pass clears the lock.

This makes stuck-state not a passive inbox a human must go drain, but a self-
surfacing, self-clearing rung of the loop — the `advance`/`advance-loop` philosophy
(the human's only job is to answer).

## Why it composes cleanly

- The lock `stuck` state + the `reason`/questions on the entry are landed by the
  `ledger-status-per-item-lock-refs` slices (esp. the 9b recovery surface).
- The surface/apply rungs already exist (`advance-rung-surface`,
  `advance-rung-apply`, `advance-sidecar-contract`, `surface-questions-skill` in
  `work/done/`); this EXTENDS them to also read/write the lock `stuck` state, it does
  not invent new machinery.
- The lock transitions it needs (`resumeItemLock` / `requeueItemLock` /
  `releaseItemLock`) are the slice-2 state-machine transitions, already built.

## The one subtlety to get right (so a future slicer does not re-derive it wrong)

The apply rung clearing a stuck lock is a TREE-LESS op (it amends/deletes the lock
ref, no inner `do`), so under the option-(a) advance-tick rule
(`advancing-acquires-unified-lock`) the apply rung legitimately takes the unified
lock for tree-less rungs. BUT the item it operates on is ALREADY lock-held (it is
stuck) — so the apply-on-stuck path is a TRANSITION on the existing held entry
(`stuck -> active` / `stuck -> released` via `resume`/`requeue`/`release`), NOT a
create-only `acquire` (which would lose against the held stuck lock). Use the
existing amend/release transitions, not a fresh acquire.

## The surfacer is a deterministic STATE surfacer (NOT the judgement skill)

The stuck-lock surfacer is a **deterministic STATE surfacer**, NOT the judgement
`surface-questions` skill. The reason (gate-failed / rebase-conflict / prepare-failed
/ timeout / rejected review) is ALREADY recorded on the lock entry — nothing to
"gather", no agent/model needed. It is mechanical enumeration of stuck lock-refs →
one question per stuck item, of the shape:

> `<slug> is stuck: <reason>. requeue? reset-and-retry? drop? hold?`

The surface-questions judgement skill remains the surfacer for `needsAnswers` /
spec-residue cases where an agent has to READ a body and DECIDE what to ask. The
stuck-lock rung sits at a different layer: it fires on lock-state, is model-free,
and its output shape is the same regardless of the reason string.

## Apply dispatches an EXISTING verb (`requeue [--reset]`)

The apply rung invents no new action: it dispatches `requeue` (already the protocol
verb per `CONTEXT.md`: "needs-attention → backlog; the defer-don't-finish verb"),
with an optional `--reset` disposition:

- **default** — continue-from-wip: release the lock, leave the `work/<slug>` branch
  in place so the next claim resumes on top of the saved wip.
- **`--reset`** — discard-wip-and-rebuild-from-clean: release the lock AND drop the
  work branch, so the next claim starts from a clean base.

(This sharpens the existing "stuck→released via requeue/release" line above —
nothing new to build in the transition layer, just spell out the `--reset` axis in
the apply dispatch table.)

## The generalization: surface-state-as-questions across four cases

The stuck-lock rung is one instance of an emerging shape: **surface a thing needing
a human decision → answer → apply dispatches the action via disposition.** Four
cases now share it:

| surface           | input (state)                              | apply action                     |
| ----------------- | ------------------------------------------ | -------------------------------- |
| `merge-questions` | unmerged branches / PRs                    | LANDS                            |
| `needs-attention` | stuck lock-refs + recorded reason          | REQUEUES (optional `--reset`)    |
| `triage` (exists) | observations                               | PROMOTES / DROPS                 |
| `surface` (exists)| spec / judgement residue on a body         | EDITS body                       |

The sidecar question loop is emerging as the UNIVERSAL human-visible-outcome
mechanism for runner state that no longer has a folder. The folder→lock-ref
cutover removed the folder-native surface (there is no `ls work/needs-attention/`
any more); the question loop is the candidate replacement across all four.

## The sidecar-keying architectural resolution (shared gate for the whole shape)

`sidecar.ts` keys sidecars on `<type>-<slug>` (identity resolver), NOT folder path.
That means the two state-surfacer cases sit on OPPOSITE sides of an apply-primitive
gate:

- **needs-attention: sliceable now.** A stuck item's slice body still rests in
  `backlog/` while claimed (only the transient STATUS left the folder in the
  cutover). Because `sidecar.ts` keys on `<type>-<slug>`, the sidecar CAN attach
  to the backlog body. `sidecar-apply.ts` `applyAtomic` finds a body to read/write.
  No apply-primitive change needed — the stuck-clear apply is a lock TRANSITION
  (see the subtlety section below), the body edit is the sidecar-answer being
  recorded on the backlog body.
- **merge-questions: gated.** An unmerged branch may have NO `work/<slug>.md` body
  at all (a landed slice's body has moved to `done/`, or the branch predates the
  body). `sidecar-apply.ts` `applyAtomic` currently REQUIRES `options.itemPath` and
  reads/writes the body there. So the apply primitive must be extended first to
  key to a lock-ref / branch identity with no body-file. **Sequence the
  merge-questions surface AFTER that apply-primitive extension** — do not slice
  it in parallel with the needs-attention rung.

## Do not fold this into land-time-reverify

This is NOT part of the land-time-reverify brief — it is its own signal, its own
brief. (Recorded here so a future planner doesn't collapse them: they share the
"apply dispatches something via disposition" SHAPE, but the input axis is different
— stuck-lock state vs. a landing-time re-verification result.)

## Scope note

NOT part of `retire-transient-folders-and-drop-rebase` (#9 / 9a-9d), which only
finishes the substrate cut-over (stuck = lock state, human-driven recovery verbs,
folders retired, drop-rebase gone). This idea is the NEXT layer: question-driven,
apply-cleared stuck recovery. Promote to a SPEC/slice after the lock substrate
fully lands.

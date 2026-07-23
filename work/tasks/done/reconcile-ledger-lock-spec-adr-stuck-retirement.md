---
title: 'Reconcile the ledger-lock spec + ADR with the retired `stuck` state'
slug: reconcile-ledger-lock-spec-adr-stuck-retirement
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [retire-stuck-lock-state]
covers: [5]
---

## What to build

Reconcile the ratified ledger/lock documents with the retired `stuck` state, so the docs do not lie about the lock model after this spec lands.

The `ledger-status-per-item-lock-refs` spec + its governing ADR DEFINE the two-axis lock as `action × state` where `state: active | stuck` (and state `needs-attention` = lock held stuck). After `retire-stuck-lock-state`, that half is no longer true: the lock state is the active hold only, and "resting, needs a human" is `needsAnswers:true` + a sidecar on `main`.

Update the affected durable docs:

- The governing ADR (in `docs/adr/`) that records the two-axis `active|stuck` lock: amend it to record the retirement of `stuck` and the reason (the surface-stuck-as-questions decision), OR add a superseding ADR that points back to it. Follow `ADR-FORMAT.md`.
- The `ledger-status-per-item-lock-refs` spec's prose where it states the `active|stuck` state machine + the `needs-attention = stuck` equivalence + the `reason iff stuck` invariant — reconcile to the new model (state = active hold; parked = `main` needsAnswers + sidecar).
- Any `CONTEXT.md` glossary entry that describes `stuck` as a lock state (e.g. the `needs-attention` / `claim (CAS)` entries that mention `state: active/stuck`) — update to the new model so the glossary is the accurate source of truth.
- **Pin the two disjoint meanings of `stuck`** so a future author cannot re-muddle them: after this work, `stuck` is NO LONGER a lock state (retired), but it REMAINS a `SidecarKind` (`sidecar.ts` — the dispatch kind the surfaced-bounce sidecar is filed under). Add/adjust a glossary line making explicit that `stuck`-the-lock-state is gone while `stuck`-the-sidecar-kind is kept, so the overload is a documented distinction, not a trap.

This is a docs/coherence task (no engine behaviour), the final reconciliation so the protocol/decision docs match the landed code.

## Acceptance criteria

- [ ] The governing ledger-lock ADR reflects the retired `stuck` state (amended or superseded per `ADR-FORMAT.md`), with the WHY (the surface-stuck-as-questions decision) recorded.
- [ ] The `ledger-status-per-item-lock-refs` spec's `active|stuck` state-machine prose + the `needs-attention = stuck` and `reason iff stuck` statements are reconciled to the new model (active-hold-only; parked = `main` needsAnswers + sidecar).
- [ ] `CONTEXT.md` glossary entries mentioning `stuck` as a lock state are updated so the glossary is accurate.
- [ ] No live doc still asserts a `stuck` LOCK STATE as current truth (grep for `state: stuck` / `active/stuck` in docs + specs + CONTEXT.md returns only historical/superseded references).
- [ ] The glossary PINS the distinction: `stuck`-the-lock-state (retired) vs `stuck`-the-SidecarKind (kept), so the shared word is a documented distinction, not a re-muddle trap.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check` (this is docs-only, so mainly `format:check` + no broken links).

## Blocked by

- `retire-stuck-lock-state` — the docs are reconciled to the LANDED retirement; must follow it so they describe the real end-state.

## Prompt

> Goal: reconcile the ratified ledger/lock docs (the governing ADR, the `ledger-status-per-item-lock-refs` spec, the `CONTEXT.md` glossary) with the retired `stuck` lock state, so no live doc lies about the lock model. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user story 5, the docs/ADR side).
>
> FIRST, drift-check: confirm `retire-stuck-lock-state` LANDED (the code no longer has a `stuck` `LockState`). If it has not, this reconciliation is premature — route to needs-attention. Also re-read the CURRENT ADR/spec text (do not work from memory — the docs may already have been partly updated).
>
> Domain vocabulary: the two-axis per-item lock was `action: implement|task|advance × state: active|stuck`, with `state: stuck` == needs-attention and the invariant `reason iff stuck`. After retirement: the lock is the ACTIVE HOLD only (in-flight CAS mutual-exclusion); "resting, needs a human" is `needsAnswers:true` + a `stuck`-kind sidecar on `main`, drained by the apply rung. `main` is authoritative over a crash-orphaned `active` lock.
>
> Where to look: `docs/adr/` for the governing ledger-lock-on-per-item-refs ADR; `work/specs/tasked/ledger-status-per-item-lock-refs.md` (the state-machine prose + invariants); `CONTEXT.md` glossary (the `needs-attention` / `claim (CAS)` / lock entries mentioning `state: active/stuck`). Follow `work/protocol/ADR-FORMAT.md` for whether to amend-in-place vs write a superseding ADR.
>
> This repo is BOTH a user and the AUTHOR of the dorfl protocol: if any protocol DOC under `skills/setup/protocol/` (the source of truth) mentions the `stuck` lock state, update it there AND mirror into `work/protocol/` (keep them byte-identical) — but the ledger-lock ADR/spec are repo-local `docs/adr/` + `work/specs/`, not protocol docs, so most of this is local. Do NOT edit `work/protocol/` alone.
>
> Done = every live ADR/spec/glossary statement about the lock state matches the landed active-hold-only model, superseded text is clearly marked historical, and the gate is green. RECORD the amend-vs-supersede ADR decision per `ADR-FORMAT.md`.

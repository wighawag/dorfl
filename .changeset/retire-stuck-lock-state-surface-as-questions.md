---
'dorfl': minor
---

Retire the `stuck` lock state in favour of surfacing bounced work as answerable questions on `main`.

A bounced or blocked item no longer parks as a `stuck` lock. Instead it is SURFACED on `main` as a `needsAnswers: true` pool item with a `work/questions/<slug>.md` sidecar, and its lock is released — so the state is visible in `git clone`, `ls work/questions/`, and `dorfl status`, and a human resolves it by answering the sidecar rather than by inspecting a lock ref. `LockState` collapses to a single `active` value (the in-flight hold); the crash-window orphan is the only lock that can outlive a leg, and it is nameable/clearable via `release-lock` (+ an orphan-lock report in `gc --ledger`).

- **Surface-as-questions bounce.** The bounce seams now write the sidecar + flip `needsAnswers` + release the lock atomically, replacing the retired `active -> stuck` lock amend and the `needs-attention/` folder.
- **Answer -> apply dispatch.** Answering a `kind: 'stuck'` sidecar drives a deterministic `keep | reset | cancel` verb (a sibling of the existing `kind: 'merge'` dispatch): `keep` continues from the kept `work/<slug>` branch tip, `reset` discards that branch first (the `requeue --reset` primitive) then continues, and `cancel` disposes the item to its terminal folder.
- **One-shot migration.** A new `dorfl migrate-stuck-locks` verb drains any pre-existing `stuck` lock refs into the new surfaced-question shape, so retiring the state strands no already-stuck item.
- **`requeue --reconcile`.** A non-destructive middle-rung recovery verb (between the default keep+continue and the destructive `--reset`) that re-syncs the mirror and retries the rebase of the kept branch onto latest `main`, pushing the reconciled tip back on success and never deleting the remote branch.
- Docs, ADRs, and protocol contracts (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `REVIEW-PROTOCOL.md`) are reconciled to the active-hold-only model, and the `gc --ledger` report is renamed from "stuck-lock" to "orphan-lock".

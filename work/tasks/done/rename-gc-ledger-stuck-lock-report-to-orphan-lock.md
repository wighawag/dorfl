---
promotedFrom: observation:review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14
needsAnswers: false
---

## What to build

A tiny doc/label rename to avoid a THIRD informal meaning of "stuck" in the protocol.

Background. Since the retire-stuck-lock-state work landed, `CONTEXT.md` pins two meanings of "stuck":

1. the RETIRED lock state (now surfaced as a question sidecar, not a lock), and
2. the SidecarKind `stuck` used for question sidecars on `main`.

The reconcile pass (`reconcile-ledger-lock-spec-adr-stuck-retirement`) left the WORK-CONTRACT resolve/return paragraph describing `gc --ledger`'s crash-orphaned-lock report as a "stuck-lock report", parenthesising "stuck here means crash-orphan, not the retired lock state". That parenthetical is the smell: reusing "stuck" as an informal label for a crash-orphaned lock adds a third shade the reader has to disambiguate. The Gate 2 review flagged this as a non-blocking nit; the observation-answer for `observation:review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14` promoted it to this follow-up.

Rename target. In the resolve/return path prose (both mirrored copies), rename the report from `stuck-lock` to `orphan-lock` and drop the parenthetical (no longer needed once the word "stuck" is out of the label).

Files to touch.

- `skills/setup/protocol/WORK-CONTRACT.md` — the SOURCE OF TRUTH (see root `AGENTS.md`: edit skills/setup/protocol/, then mirror).
- `work/protocol/WORK-CONTRACT.md` — propagated COPY; must stay byte-identical to source apart from `VERSION`. Mirror the same edit.

Exact spot: the needs-attention resolve/return bullet, currently reading (roughly) `... a stuck-lock report in gc --ledger, where "stuck" here means "crash-orphan", not the retired lock state ...`. After: `... an orphan-lock report in gc --ledger ...` (drop the parenthetical clarification since it becomes redundant).

Code audit. `grep -rn "stuck-lock\|stuckLock\|stuck_lock" packages/ src/` currently only surfaces slug references (spec/task/ADR names like `retire-stuck-lock-state`) — those are proper nouns and MUST NOT be renamed. If any RUNTIME string / CLI output / test-fixture uses the label `stuck-lock` for the crash-orphan report, rename it to `orphan-lock` and update the corresponding tests. If no such runtime string exists (very likely — this reconcile pass was doc-only), the code audit is a no-op and this task is purely a doc rename in two mirrored files.

Out of scope.

- Do NOT rename ADR / spec / task slugs that contain "stuck-lock" (e.g. `retire-stuck-lock-state`, `bounce-atomic-cutover-retire-stuck-lock`, `migrate-existing-stuck-locks-one-shot`, `surface-stuck-as-questions-and-retire-stuck-lock-state`). Those are historical proper nouns.
- Do NOT touch `CONTEXT.md`'s pinning of the two meanings; that pin is what motivates this rename.
- Do NOT amend any ADR — this is a small doc coherence fix, not an architectural decision.

Acceptance.

- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- `diff -r skills/setup/protocol work/protocol` clean apart from `VERSION` (the source-of-truth invariant from root `AGENTS.md`).
- `grep -n "stuck-lock report\|stuck-lock\"" skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` returns nothing (the label is gone from the resolve/return prose).
- `grep -n "orphan-lock" skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` returns the new label in each file.

## Prompt

> Rename the `gc --ledger` crash-orphan report label from `stuck-lock` to `orphan-lock` in the WORK-CONTRACT resolve/return prose, so "stuck" is no longer overloaded a third time (CONTEXT.md already pins two meanings: the retired lock state, and the `stuck` SidecarKind).
>
> Edit `skills/setup/protocol/WORK-CONTRACT.md` (SOURCE OF TRUTH) and mirror byte-identically into `work/protocol/WORK-CONTRACT.md`. The target spot is the needs-attention "Resolve / return path" bullet, currently reading roughly `... a stuck-lock report in gc --ledger, where "stuck" here means "crash-orphan", not the retired lock state ...`. After: `... an orphan-lock report in gc --ledger ...`. Drop the parenthetical clarification — it becomes redundant once "stuck" is out of the label.
>
> Then audit runtime code: `grep -rn "stuck-lock\|stuckLock\|stuck_lock" packages/ src/`. Only slug references (proper nouns like `retire-stuck-lock-state`, `bounce-atomic-cutover-retire-stuck-lock`, `migrate-existing-stuck-locks-one-shot`, `surface-stuck-as-questions-and-retire-stuck-lock-state`) may remain — those are historical and MUST NOT be renamed. If any live CLI output / string label / test fixture uses `stuck-lock` for the crash-orphan report, rename to `orphan-lock` and update tests. Otherwise the code audit is a no-op.
>
> Do NOT touch `CONTEXT.md`, do NOT rename any ADR/spec/task slug, do NOT amend any ADR — this is a scoped doc coherence rename.
>
> Acceptance: `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green; `diff -r skills/setup/protocol work/protocol` clean apart from `VERSION`; `grep -n "stuck-lock" skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` empty in the resolve/return prose; `grep -n "orphan-lock" ...` shows the new label in both mirrored files.

## Applied answers 2026-07-14

### q1: 'task:rename-gc-ledger-stuck-lock-report-to-orphan-lock' was bounced — how should we proceed?

Resolve, CONTINUE (keep the work branch). This bounce was NOT a defect in this task: the acceptance gate failed on a PRE-EXISTING `prd->spec` leak-scan failure on `main` (an un-backticked `slice-*/prd-` token in the auto-generated `backfill-where-it-runs-decision-migrate-stuck-locks-done-record` task body, line 20). The agent correctly diagnosed this and left the observation `word-cutover-leak-scan-red-on-backfill-task-2026-07-14`. That leak is now FIXED on main (backticked, leak-scan green). This task's own work is sound and complete: it renames the gc/ledger "stuck-lock report" -> "orphan-lock report" in `WORK-CONTRACT.md` (both protocol mirrors, byte-identical) + one test describe label, matching the task exactly. Keep the branch and re-gate on the now-green main; it should pass cleanly.

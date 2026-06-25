<!-- dorfl-sidecar: item=observation:review-nits-direct-delete-question-cli-helper-2026-06-25 type=observation slug=review-nits-direct-delete-question-cli-helper-2026-06-25 allAnswered=false -->

## Q1

**What should become of nit #1 — the `drop` command declares `-c, --config <path>` (and `DropFlags.config`) but never reads it: delete the dead surface, wire it, promote to a task, or keep as-is?**

> packages/dorfl/src/cli.ts:794 declares `interface DropFlags { config?; cwd?; reason? }` and the `.option('-c, --config ...')` at the drop command (~line 3403) is unread in the action body (lines 3409-3438). `drop` is a pure working-tree primitive (resolves by identity, `git rm`s — no config load), so the flag misleads users. Cosmetic only; nothing breaks. Verifying against current code is recommended before promoting.

_Suggested default: Promote to a small task: remove the unused `-c, --config` option and the `config?` field from `DropFlags` (one-line cleanup, no behaviour change)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify (or revise) the four in-scope decisions the `drop` author made but never wrote into a PR `## Decisions` block — (1) verb name `drop <slug>`; (2) `--reason` optional, empty/whitespace recorded as `(no reason given)` rather than refused; (3) a source that does not resolve by identity is a clean exit-0 no-op (`not-found`), not an error, and an orphaned sidecar in that case is left to the gc sweep; (4) the verb is a local working-tree commit only — it does NOT touch the arbiter / push?**

> Decisions live in `drop-source.ts` docstrings + a `cli.ts` comment, but the commit body is the one-line subject only (`git log -1 --format=%B ac36f4b`) — so no Decisions block surfaced them for ratification. The review found all four reasonable and aligned with the task's intent; the gap is just human acknowledgement.

_Suggested default: Ratify all four as-is — they match the task's intent and the review approved them; no code change needed, just close this nit by recording the ratification here._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**What should become of nit #3 — the COHERENCE concern that the noun `drop`/`dropped` now means two things across the surface (the new direct-delete VERB vs the PRD `prds/dropped/` won't-proceed TERMINAL and the surface `dropped` triage disposition)? Add a CONTEXT.md / glossary line pinning the two meanings apart, rename one side, or accept the small overlap as harmless?**

> WORK-CONTRACT.md:44/63/67 establish `prds/dropped/` as a retain-as-won't-proceed terminal (reason in body). SURFACE-PROTOCOL.md:47/58 use `dropped` as a triage disposition value. The new `drop <slug>` verb instead DELETES (git rm; reason in commit message). The verb's commit subject is `drop: <item> → deleted` (says 'deleted', not 'dropped'), so there is no actual collision today — but the shared English word carries two contradictory load-bearing meanings.

_Suggested default: Promote to a tiny doc task: add a one-line glossary entry (e.g. in CONTEXT.md or WORK-CONTRACT.md) pinning `drop` (the direct-delete verb, → deleted) vs `dropped` (the PRD won't-proceed terminal, retained) so a future author cannot conflate them. No rename._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

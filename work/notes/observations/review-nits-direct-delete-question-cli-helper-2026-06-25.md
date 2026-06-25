---
title: review-gate non-blocking nits for 'direct-delete-question-cli-helper' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: direct-delete-question-cli-helper
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'direct-delete-question-cli-helper' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The `drop` command declares `-c, --config <path>` (and `DropFlags.config`) but its `.action(...)` body never reads `flags.config` — only `flags.cwd` and `flags.reason` are used. The verb is a pure working-tree primitive (it resolves paths by identity and `git rm`s, never loading config), so the flag is dead surface that misleads a user into thinking config influences a drop. Drop the unused option + the `config?` field, or wire it if a reason was intended. Cosmetic only; nothing breaks.
  (packages/dorfl/src/cli.ts:794 (`interface DropFlags { config?; cwd?; reason? }`) and the `.option('-c, --config ...')` at the drop command (~line 3403) with no `flags.config` read in the action body (3409-3438).)
- RATIFY the in-scope decision NOT recorded in a PR `## Decisions` block: the commit body has only the one-line `feat(...); done` subject, so none of the agent's self-made choices were written down anywhere a human can ratify them. The choices made: (1) verb NAME `drop <slug>` (top-level), chosen to avoid colliding with `remote rm`; (2) `--reason` is OPTIONAL and an empty/whitespace reason is recorded as `(no reason given)` rather than refused (the task prompt explicitly invited deciding this — recorded in the source docstring, good, but not surfaced to the human); (3) a source that does not resolve by identity is a clean exit-0 no-op (`not-found`), NOT an error, and an orphaned sidecar in that case is left to the gc sweep rather than removed here; (4) the verb is a LOCAL working-tree commit only — it does NOT touch the arbiter / push (the human integrates the revertible commit themselves). All four are reasonable and match the task's intent, but they live only in code/docstrings, not a PR Decisions block, so they need an explicit human ratification glance.
  (Decisions are documented in `drop-source.ts` docstrings + the `cli.ts` comment, but absent from the commit message / any PR description Decisions block (`git log -1 --format=%B ac36f4b` is the one-line subject).)
- COHERENCE: the new verb is named `drop`, but the system already gives the word a load-bearing, DIFFERENT meaning — `prds/dropped/` is the PRD-regime won't-proceed TERMINAL (a resting folder with the reason in the BODY; WORK-CONTRACT.md), and `dropped` is also a triage disposition value in SURFACE-PROTOCOL.md. The new `drop` verb instead means 'delete the file outright (git rm), git history is the archive' — a different operation (no resting state, reason in the COMMIT MESSAGE not the body). The leak is small in practice: the commit subject is `drop: <item> → deleted` (it says 'deleted', not 'dropped', so it does not claim the `dropped` terminal), and no other `drop` verb exists. But the shared English word now means two things across the surface (a verb that DELETES vs a terminal that RETAINS-as-won't-proceed). Worth a human's eye, and possibly a CONTEXT.md glossary line pinning `drop` (the direct-delete verb) vs `dropped` (the prd terminal) so the next author cannot conflate them. Not blocking: the meanings are kept apart by the `→ deleted` subject and there is no actual collision.
  (WORK-CONTRACT.md:44/63/67 (`prds/dropped/` terminal); SURFACE-PROTOCOL.md:47/58 (`dropped` disposition value); vs the new `drop <slug>` direct-delete verb whose commit subject is `drop: <item> → deleted` (drop-source.ts).)

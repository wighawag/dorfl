<!-- dorfl-sidecar: item=observation:review-nits-direct-delete-question-cli-helper-2026-06-25 type=observation slug=review-nits-direct-delete-question-cli-helper-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this observation (the three non-blocking review nits for the approved 'direct-delete-question-cli-helper' work)? Pick a disposition for the signal as a whole and per-nit below: address now (mint a follow-up task/ADR), keep as a durable note, or drop it.**

> This is an untriaged observation (work/notes/observations/review-nits-direct-delete-question-cli-helper-2026-06-25.md, needsAnswers: true) recording three non-blocking findings the Gate-2 review raised while APPROVING the PR. None block integration; this note is their triage home. The three nits are surfaced individually below. The header asks for promote-to-task / keep / delete.

_Suggested default: Keep as a durable note unless you want nit 1 (dead --config flag) fixed, since that is the only one touching shipped code._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Address nit 1 (dead code) and ratify the rest, then delete the note. Nit 1 (Q2) touches shipped code, so fix it as a small cleanup. Nits 2-3 (Q3/Q4) are ratifications plus a cheap glossary line. Once nit 1 is minted, this note can be deleted.

## Q2

**Nit 1 (cosmetic, code): should the unused `-c, --config <path>` option and the `config?` field on DropFlags be removed from the `drop` verb (or wired up if a config-dependent behaviour was actually intended)?**

> Verified against current code: cli.ts:795 `interface DropFlags { config?; cwd?; reason? }` and the `.option('-c, --config <path>', ...)` declared on the drop command (~line 3403), but the `.action((slug, flags) => …)` body (3409-3438) reads only `flags.cwd` and `flags.reason` — `flags.config` is never read (it does not appear in the flags.config grep results for the drop action). `drop` is a pure working-tree primitive that resolves by identity and git rm's, so the flag is dead surface that misleads a user into thinking config influences a drop. Nothing breaks today.

_Suggested default: Remove the unused `--config` option and the `config?` field (the verb never loads config); a tiny cleanup task or a fix folded into the next touch of cli.ts._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Remove the unused `-c, --config <path>` option and the `config?` field on DropFlags. The `drop` verb is a pure working-tree primitive that never loads config, so the flag is dead surface that misleads users. Mint a tiny cleanup task or fold it into the next touch of cli.ts.

## Q3

**Nit 2 (ratify): do you ratify the four in-scope self-made decisions that were recorded only in code/docstrings and never written to a PR `## Decisions` block? (1) verb NAME `drop <slug>` top-level, chosen to avoid colliding with `remote rm`; (2) `--reason` OPTIONAL with empty/whitespace recorded as `(no reason given)` rather than refused; (3) a source that does not resolve by identity is a clean exit-0 no-op (not an error), leaving any orphaned sidecar to the gc sweep; (4) the verb is a LOCAL working-tree commit only — it does not touch the arbiter/push, the human integrates the revertible commit.**

> The commit body for ac36f4b is only the one-line `feat(...); done` subject, so none of these choices are in a place a human can ratify them — they live in drop-source.ts docstrings + a cli.ts comment. All four are reasonable and match the task's intent (the prompt explicitly invited deciding #2), but they need an explicit human ratification glance.

_Suggested default: Ratify all four as-is (they match the task intent and the code comments document them); no change needed beyond your acknowledgement._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Ratify all four in-scope decisions as-is (verb name `drop`; `--reason` optional with `(no reason given)` fallback; unresolved source is a clean exit-0 no-op leaving orphans to gc; local working-tree commit only, human integrates). They match the task intent and are documented in the code comments.

## Q4

**Nit 3 (coherence): the new verb is named `drop`, but `dropped` already has a load-bearing, DIFFERENT meaning in the system (prds/dropped/ is the won't-proceed TERMINAL that RETAINS the file with the reason in the body; `dropped` is also a triage disposition word in SURFACE-PROTOCOL.md). The new `drop` verb instead DELETES outright (git rm, reason in the commit message). Do you want a CONTEXT.md glossary line pinning `drop` (the direct-delete verb) vs `dropped` (the prd terminal) so a future author cannot conflate them?**

> WORK-CONTRACT.md:44/63/67 (`prds/dropped/` terminal); SURFACE-PROTOCOL.md:47/58 (`dropped` disposition value); vs the new `drop <slug>` direct-delete verb whose commit subject is `drop: <item> → deleted`. The leak is small: the `→ deleted` subject does not claim the `dropped` terminal, and no other `drop` verb exists, so there is no actual collision today — but the shared English word now carries two meanings across the surface.

_Suggested default: Add a one-line CONTEXT.md glossary entry distinguishing the two; cheap insurance against future conflation, but skippable since there is no live collision._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Yes, add a one-line CONTEXT.md glossary entry pinning `drop` (the direct-delete verb: git rm, reason in commit message) vs `dropped` (the prd terminal in prds/dropped/ that RETAINS the file). There is no live collision today, but the shared English word now carries two meanings across the surface and the glossary line is cheap insurance against a future author conflating them. Fold it into the nit-1 cleanup task.

---
title: review-gate non-blocking nits for 'generic-terminal-dropped-folder-generalising-out-of-scope' (Gate 2 approve)
date: 2026-06-17
status: open
reviewOf: generic-terminal-dropped-folder-generalising-out-of-scope
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'generic-terminal-dropped-folder-generalising-out-of-scope' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: drop `work/out-of-scope/` ENTIRELY with no backward-compat alias?
  (The slice prompt asked the agent to record the fold-in decision as a `## Decisions` note (drop vs keep an alias). The commit has no Decisions block. The diff implements "drop entirely": no reader has a fallback for a `work/out-of-scope/<slug>.md` file — such a file would simply be invisible to every pool/lint reader (it is not even in `LEDGER_STATUS_FOLDERS` anymore). The slice notes `work/out-of-scope/` is currently empty so the migration is mechanical, which authorises the choice; please ratify it explicitly so the next agent that finds a stale `out-of-scope/` file in the wild knows the rule is `git mv → dropped/` (manual), not a tolerated alias.)
- Ratify the `reason:` vocabulary enshrined across CONTEXT.md / WORK-CONTRACT / ADR / sidecar.ts as the authoritative set: `out-of-scope` / `superseded by <x>` / `duplicate` / `abandoned`?
  (The slice prompt explicitly asked the agent to record "the reason-vocabulary as a `## Decisions` note or an ADR if it meets the gate." The vocabulary is now stated identically in CONTEXT.md, both WORK-CONTRACT copies, the ledger-status ADR, `sidecar.ts`, `apply-persist.ts`, and `ledger-lint.ts`, making it the de facto schema — yet no validator enforces it (it lives in body prose, as the slice required). Please ratify the set (and the freedom to write it free-form) so future drift is intentional rather than accidental.)
- Should the PR title / commit message carry the `## Decisions` block the slice prompt explicitly asked for?
  (The commit message is a single subject line. The slice's `## Prompt` block ends with "Record the fold-in decision ... + the reason-vocabulary as a `## Decisions` note or an ADR if it meets the gate." Even though the choices are embedded in the diff and ratifiable from it, the missing block is a process drift worth correcting going forward; surfacing here so the human can require the block in the future.)

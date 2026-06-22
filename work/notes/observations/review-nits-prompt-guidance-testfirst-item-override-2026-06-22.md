---
title: review-gate non-blocking nits for 'prompt-guidance-testfirst-item-override' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: prompt-guidance-testfirst-item-override
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prompt-guidance-testfirst-item-override' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Protocol SOURCE-vs-MIRROR drift: `skills/setup/protocol/WORK-CONTRACT.md` and `work/protocol/WORK-CONTRACT.md` are NOT byte-identical — the mirror has one extra blank line after the new section (line 218). `AGENTS.md` explicitly requires `diff -r skills/setup/protocol work/protocol` to be clean apart from files that legitimately live in one place. Should the trailing blank line be removed from the mirror to restore byte-equality?
  (`diff skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` reports `217a218 > ` (a single extra blank line at the end of the new `### promptGuidance.* per-item override` section in the mirror only). Source is canonical; a future `setup` propagation would silently overwrite the mirror, but the invariant is currently violated.)
- The commit/PR message does NOT carry a `## Decisions` block, yet the slice's prompt asked to RECORD non-obvious decisions. Several in-scope design choices were made and only documented inside code comments / WORK-CONTRACT prose. Please RATIFY each: (a) frontmatter key form is the DOTTED scalar `promptGuidance.testFirst: true` (achieved by widening the parser's top-level key regex from `[A-Za-z0-9_]+` to `[A-Za-z0-9_.]+`) rather than nested YAML mapping; (b) brief lookup order is `work/briefs/ready/<slug>.md` first, then `work/briefs/tasked/<slug>.md`; (c) a task with NO `brief:` may still carry the override (chore symmetry with `humanOnly`); (d) a missing brief file is SILENT fall-through to repo policy (not an error/warning); (e) `agent-runner prompt` (CLI) now performs additional file I/O on every invocation (reads the task file again and possibly a brief file) where previously it only invoked `resolveSlice`.
  (frontmatter.ts:306 widens the key regex to include `.`; prompt.ts:`findBriefPath` searches `briefs-ready` then `briefs-tasked`; prompt.ts:`resolvePromptGuidanceForItem` silently returns repo policy when the brief file is absent; renderPrompt at packages/agent-runner/src/prompt.ts re-reads `slice.path` and possibly the brief file. All choices are reasonable; none is load-bearing-and-hard-to-reverse — flagging for human ratification only.)

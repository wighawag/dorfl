---
title: review-gate non-blocking nits for 'f3a-apply-resolves-item-by-identity-at-write-time' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: f3a-apply-resolves-item-by-identity-at-write-time
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'f3a-apply-resolves-item-by-identity-at-write-time' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: should the new `APPLY_LIFECYCLE_FOLDERS` (apply-persist.ts) be unified with `FOLDERS_FOR_TYPE` (advance.ts) instead of forking? The slice prompt asked the agent to 'reuse that resolver's shape rather than inventing a new one' — sidecarPathFor's identity shape was reused, but the lifecycle-folder list is now duplicated in two places with different contents (the new constant includes staging `tasks-backlog`/`briefs-proposed`; advance.ts's does not). The asymmetry is deliberate per the source comment (the apply re-resolver must see a concurrent promote that just moved the item OUT of staging — the F2 staging-surfacing case this prefactor enables), but two lifecycle-folder sets of truth is a coherence smell worth ratifying now rather than diverging silently later.
  (packages/agent-runner/src/apply-persist.ts:30-37 (APPLY_LIFECYCLE_FOLDERS) vs packages/agent-runner/src/advance.ts:376-380 (FOLDERS_FOR_TYPE).)
- Ratify: terminal-only folders (`cancelled`, `briefs-dropped`, `needs-attention`) are deliberately EXCLUDED from the apply re-resolver, which means an item moved to a terminal between capture and write is treated as `vanished` (clean exit, no commit, sidecar UNTOUCHED). That is the recorded design per the code comment, but the slice's acceptance criterion 4 only spoke of 'removed entirely' — extending `vanished` to 'reached a terminal' is a slightly broader interpretation worth confirming. The sidecar-left-untouched test (`VANISHED: ... sidecar UNTOUCHED`) makes the behaviour reversible (a human can rerun), so this looks fine, just worth explicit ratification.
  (packages/agent-runner/src/apply-persist.ts:20-29 + 386-400; test 'VANISHED: ...')
- Process miss: the slice's Prompt explicitly asked the agent to 'RECORD non-obvious in-scope decisions (resolver reuse vs. extension, the gone-item exit code/message, any brief carve-out)' in the done record — but the moved done file is byte-identical to the original task (no `## Decisions` block) and the commit message body is empty. The decisions DO exist in the source as code comments (the `APPLY_LIFECYCLE_FOLDERS` JSDoc, the `vanished` ApplyTerminal docstring, the F3a comment block in applyAnsweredQuestions), so nothing is hidden — but they were not surfaced where reviewers are supposed to ratify them. Not a defect in the code, just a recordkeeping gap.
  (work/tasks/done/f3a-apply-resolves-item-by-identity-at-write-time.md (no Decisions block); commit 67bed45 body empty.)

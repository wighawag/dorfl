---
title: review-gate non-blocking nits for 'templates-mark-transient-open-questions-block' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: templates-mark-transient-open-questions-block
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'templates-mark-transient-open-questions-block' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the autonomy-note placement decision: the agent chose to put the 'Set needsAnswers: true … clear once answered' instruction INSIDE the marker fence AND inside an HTML comment (i.e. doubly-non-rendered + stripped by apply on full resolution), rather than as a template-only comment outside the fence. The slice prompt explicitly asked to record 'whether the autonomy note went into a template comment vs. inside the fenced block, and why' — no Decisions block was added to the commit body or to the done-slice file. Both options were sanctioned by D2 in the brief, so this is a ratification finding only.
  (skills/setup/protocol/{brief,task}-template.md: the `<!-- open-questions -->` fence contains a `<!-- TRANSIENT BLOCK … -->` comment carrying the 3-step authoring instruction, followed by the visible `## Open questions` placeholder, then `<!-- /open-questions -->`. Commit 001dd77 message is a single feat line with no `## Decisions` section.)
- Ratify the cross-slice contract pinned by this template: the marker pair `<!-- open-questions -->` / `<!-- /open-questions -->` is now the load-bearing tag the sibling apply-reconciliation slice MUST match exactly. The brief listed this string only as an example ('e.g. ...'); by landing it in the template the agent has effectively decided the literal marker. This is the right call (matches the brief example and sidecar house style) but it deserves an explicit ratification line because changing the tag later would require coordinated edits in templates + apply code + any already-authored briefs.
  (Diff in skills/setup/protocol/brief-template.md and task-template.md adds the exact tags; brief `apply-reconciles-stale-open-questions.md` line 48 wrote them as an 'e.g.' suggestion (D1).)

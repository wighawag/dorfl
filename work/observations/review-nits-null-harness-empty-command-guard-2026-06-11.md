---
title: review-gate non-blocking nits for 'null-harness-empty-command-guard' (Gate 2 approve)
date: 2026-06-11
status: open
slug: null-harness-empty-command-guard
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'null-harness-empty-command-guard' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the BACKSTOP throw and the up-front NO_AGENT_CMD_MESSAGE are intentionally DIFFERENT strings ('no command to run: the null/shell adapter was launched with an empty agentCmd …' vs 'no harness configured and no agentCmd set — nothing would run. Pass --harness pi …'). The slice asked for distinct voices (config-error seam throw vs CLI up-front refusal), which this honours, but a user could hit either depending on the path. OK to keep two messages, or should the seam throw also name --harness pi explicitly to match the up-front one?
  (harness.ts ~L246 throw vs do-config.ts NO_AGENT_CMD_MESSAGE. Both name agentCmd + the harness:pi/--harness pi escape hatch, so they are coherent; the difference is framing only. Slice explicitly wanted them kept distinct.)
- Ratify the new exported symbol NO_AGENT_CMD_MESSAGE in do-config.ts as the single shared up-front refusal string for do/--remote/run. This is a new module-level export other code/tests can now depend on; the slice implied 'a single shared message if consolidated' but did not name the export. Fine as the canonical refusal string?
  (do-config.ts ~L187; imported at cli.ts L59 and pinned by a do-config.test.ts assertion that it contains '--harness pi'. Cross-site coupling, but exactly the 'one voice' the slice's tidy-up #2/#3 intend.)

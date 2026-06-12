---
title: review-gate non-blocking nits for 'advance-install-ci' (Gate 2 approve)
date: 2026-06-12
status: open
slug: advance-install-ci
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-install-ci' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: install-ci is delivered as a DOCUMENTED TEMPLATE COPY (docs/ci/advance-loop.yml.template + README), not a CLI `install-ci` subcommand. The slice explicitly permits either and asks the lighter be picked and recorded - this is recorded in docs/ci/README.md with a coherence rationale (the `install-ci` CLI verb is left for the separate runner-in-ci PRD to own, so this slice does not pre-claim the name). Looks correct; flagging for the human to ratify.
  (docs/ci/README.md sections 'Why a documented copy, not a CLI install-ci subcommand' and 'Why a .template (no live self-trigger here)'. Slice acceptance criteria 3 and 5 require the choice + the no-self-trigger decision to be recorded; both are.)
- Ratify the vocabulary rename of the dispatch input from `mode` to `integrationMode`. This is the right fix for the prior desync block and aligns with CONTEXT.md:38's 'integration mode' glossary term, but it is a user-visible rename of the workflow_dispatch input name (and the env var ADVANCE_MODE -> INTEGRATION_MODE). Since the template is not yet adopted live anywhere, there is no migration cost; flagging only so the human ratifies the chosen name.
  (docs/ci/advance-loop.yml.template workflow_dispatch input `integrationMode` and env `INTEGRATION_MODE`; the new test 'uses ONE word (integrationMode) ...' asserts it. Matches CONTEXT.md:38 and advance --propose/--merge.)
- Consider adding a direct CLI-level test that `advance --merge` / `advance --propose` resolve to config.integration in the advance action (and that `advance --merge --propose` exits 1). The mechanism is reused verbatim from do/complete and integrationFromFlags itself is unit-tested (complete-integration.test.ts), and the template carries the correct flags (advance-ci-template.test.ts), so coverage is adequate - but the NEW wiring this slice added on the `advance` command specifically has no direct assertion. Not blocking; the reuse is sound.
  (cli.ts advance action: flagMode = integrationFromFlags(flags) -> doFlagOverrides(flags, flagMode) -> resolveRepoConfig -> config.integration -> doOptions.integration. Tested indirectly via complete-integration.test.ts and the template test, but no advance-command CLI test.)

---
title: review-gate non-blocking nits for 'brand-identity-single-source' (Gate 2 approve)
date: 2026-06-07
status: open
slug: brand-identity-single-source
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'brand-identity-single-source' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The diff centralizes two protocol surfaces beyond the four enumerated in the acceptance criteria: the per-job record filename ('.agent-runner-job.json' -> brand.jobRecordFilename in workspace.ts) and the ~/.config/agent-runner config-dir name (brand.configDirName in config.ts defaultConfigPath). Is this intended over-delivery?
  (Both are silent-break-on-rename protocol surfaces fully in the spirit of the slice, and both verified byte-identical against HEAD (workspace.ts:103, config.ts defaultConfigPath/DEFAULT_CONFIG). Beneficial, but a reviewer should know the diff touched config.ts and workspace.ts beyond the literal acceptance-criteria list.)
- env-config.test.ts's description still reads 'prefixes AGENT_RUNNER_ and SCREAMING_SNAKEs the key' after screamingSnake was renamed to constantCase. Update the wording for accuracy?
  (packages/agent-runner/test/env-config.test.ts:5 — purely cosmetic test-name staleness; the assertions still pin the correct env var names and pass.)

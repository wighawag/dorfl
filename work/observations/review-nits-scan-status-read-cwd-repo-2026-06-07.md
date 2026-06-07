---
title: review-gate non-blocking nits for 'scan-status-read-cwd-repo' (Gate 2 approve)
date: 2026-06-07
status: open
slug: scan-status-read-cwd-repo
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'scan-status-read-cwd-repo' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- When the cwd is also-registered and is the only registry repo, the empty-state prints "Registered repos: (none) — nothing registered in the registry yet." — but something IS registered (the cwd, shown above as "(also registered)"). Consider wording like "(only this repo, shown above)" to avoid implying nothing is registered.
  (packages/agent-runner/src/format.ts formatReport, the registryRepos.length === 0 branch with cwdLines.length > 0.)
- The 'behind' divergence direction (arbiter ahead of local main) is implemented and rendered but lacks a dedicated test asserting behind===N. The slice's enumerated tests only required an 'ahead' case and the parsing is symmetric, so this is optional, but a behind-case test would fully cover the divergence line.
  (cwdDivergenceLine handles behind>0 (format.ts); localMainDivergence parses both directions (git.ts); test/cwd-section.test.ts asserts ahead===1 and the in-sync behind===0 only.)

---
title: review-gate non-blocking nits for 'install-ci-document-toolchain-boundary' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: install-ci-document-toolchain-boundary
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-document-toolchain-boundary' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the agent placed the boundary text in TWO surfaces — a YAML comment header inside the generated composite action.yml AND the install-ci completion log. The task wording named 'generated README / completion message'; embedding the boundary as a YAML comment in action.yml (so it travels with the artifact a maintainer opens) is a small in-scope choice the task did not explicitly specify and was not recorded in a ## Decisions block on the commit. OK to keep?
  (packages/dorfl/src/install-ci-core.ts adds a multi-line '# Project-toolchain boundary' comment before 'runs:'; packages/dorfl/src/install-ci.ts emits four log() lines at end of installCI.)
- Ratify: the boundary prose hard-codes the Node pin ('Node 22 for engines.node >=18') in both the YAML comment and the completion log. If the composite action ever bumps its pin, these two free-text strings must be updated in lockstep or the boundary message will drift from the actual setup-node step. Acceptable as written?
  (install-ci-core.ts comment says 'only PINS Node 22 below for its own runtime'; install-ci.ts log says 'Node 22 for engines.node >=18'. The setup-node step uses node-version: '22'.)
- PR description / commit body has no '## Decisions' block, though the two ratification items above are non-obvious in-scope choices the agent made. Consider adding the block convention next time so reviewers do not need to reconstruct.
  (git log -1 --format=%B 36657cc shows only the title line, no Decisions section.)

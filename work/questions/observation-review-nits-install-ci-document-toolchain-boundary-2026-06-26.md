<!-- dorfl-sidecar: item=observation:review-nits-install-ci-document-toolchain-boundary-2026-06-26 type=observation slug=review-nits-install-ci-document-toolchain-boundary-2026-06-26 allAnswered=false -->

## Q1

**Ratify: is placing the toolchain-boundary text in TWO surfaces (a '# Project-toolchain boundary' YAML comment header in the generated composite action.yml AND the install-ci completion log) the intended shape, even though the task wording only named 'generated README / completion message' and no ## Decisions block was recorded on the commit?**

> packages/dorfl/src/install-ci-core.ts:867 injects a multi-line '# Project-toolchain boundary (task install-ci-document-toolchain-boundary):' comment before 'runs:' in action.yml; packages/dorfl/src/install-ci.ts:316-325 emits ~4 log() lines at end of installCI. Nit is non-blocking (Gate 2 approved).

_Suggested default: Keep both surfaces (the YAML comment travels with the artifact a maintainer opens; the log surfaces at install time) and close this nit without a task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Ratify: keep both surfaces (the YAML comment travels with the action.yml a maintainer opens; the completion log surfaces at install time). Close without a task.

## Q2

**Ratify: is it acceptable that the boundary prose hard-codes the Node pin ('Node 22 for engines.node >=18') in two free-text strings that must be kept in lockstep with the setup-node step if the pin is ever bumped, with no single-source guard?**

> install-ci-core.ts:869 says 'only PINS Node 22 below for its own runtime'; install-ci.ts:316 log says 'Node 22 for engines.node >=18'; the setup-node step at install-ci-core.ts:883 uses node-version: '22'. Three places, no shared constant.

_Suggested default: Accept as-is for now (pin bumps are rare and touched-together); if it drifts once, promote to a small task that derives the pin string from a single constant._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Accept as-is (Node-pin duplicated in a couple of free-text strings). Pin bumps are rare and touched together. If it drifts even once, promote a small task to derive the pin string from a single constant. No task now.

## Q3

**Optional: should the repo adopt a lightweight convention of adding a '## Decisions' block to commit bodies for non-obvious in-scope choices (like the two ratifications above), so future reviewers do not have to reconstruct?**

> git log -1 --format=%B 36657cc shows only the title line, no Decisions section, yet the agent made two in-scope choices (dual-surface placement, hard-coded pin string) that were non-obvious from the task wording.

_Suggested default: Note it as guidance for future build agents (prompt-side reminder) rather than minting a task — it is a habit, not a code change._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Guidance, not a task. This is the same recurring decisions-block habit tracked by the standing `decisions-block-convention-repeatedly-skipped` observation (which I answered RELAX: record durably anywhere checkable). Don't duplicate it here. Delete this observation after ratifying Q1/Q2.

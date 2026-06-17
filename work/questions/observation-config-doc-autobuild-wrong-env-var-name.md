---
item: observation:config-doc-autobuild-wrong-env-var-name
type: observation
slug: config-doc-autobuild-wrong-env-var-name
allAnswered: false
---

## Q1
id: q1
question: |
  How should this docblock-typo observation be routed?
context: |
  config.ts:86 documents `autoBuild` precedence citing `AGENT_RUNNER_AUTO_SLICE` where it should cite `AGENT_RUNNER_AUTO_BUILD` (copy-paste slip; CODE is correct, only the human-facing comment is wrong). Severity is low and docs-only. The observation itself suggests folding the one-line fix into any nearby config docs touch-up rather than spinning its own slice, but it could also be promoted to a tiny standalone slice for visibility, or simply kept open until an opportunistic fix lands.
default: |
  keep (await an opportunistic nearby config-docs touch-up; promote to slice only if no such touch-up appears soon)
answered: false
answer: |
disposition: keep

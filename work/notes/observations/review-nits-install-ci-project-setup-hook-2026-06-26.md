---
title: review-gate non-blocking nits for 'install-ci-project-setup-hook' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: install-ci-project-setup-hook
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-project-setup-hook' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the in-scope decisions: (a) config-key shape chosen is the provider-namespaced map `projectSetup: { <provider>: <payload> }`; (b) split of the light structural check — outer-map shape in the CORE (`loadCIConfigFile`), per-payload list-of-mappings shape in the ADAPTER (`validateGithubProjectSetupPayload`); (c) new seam additions on `CIProviderContext` — optional `providerId` field and optional `renderProjectSetup(payload)` method (cross-cutting: every future provider adapter sees these); (d) new exported error class `GithubProjectSetupError`; (e) `--export-config` OMITS `projectSetup` entirely when the map is absent OR `{}` (chosen for round-trip cleanliness); (f) empty / whitespace-only payload string is REJECTED with an error (not silently treated as absent) — task text said `absent/empty ⇒ byte-identical`, agent read `empty` as the map level (`{}` ⇒ baseline) and a string payload as user intent worth surfacing; (g) the validator strips leading/trailing whitespace from the payload before splicing (light normalization, not a transform of step content).
  (The task prompt explicitly asked for a `## Decisions` block in the done record / PR covering at minimum key shape, injection ordering, and where the structural check lives. The done record (work/tasks/done/install-ci-project-setup-hook.md) has no `## Decisions` block; the commit message body is empty; no PR yet. Code: install-ci-core.ts (CIConfigFile.projectSetup, CIProviderContext.providerId/renderProjectSetup, loadCIConfigFile outer-shape check, exportCIConfig omit-when-empty), install-ci-github.ts (validateGithubProjectSetupPayload, GithubProjectSetupError, renderGithubProjectSetupSteps), install-ci.ts (orchestration lookup).)

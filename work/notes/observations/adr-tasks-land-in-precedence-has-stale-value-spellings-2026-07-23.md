# ADR `tasks-land-in-runner-deterministic-precedence` carries stale value spellings

Date: 2026-07-23

Noticed while renaming the `SpecsLandIn` value `pre-proposed → proposed` (task `specs-land-in-proposed-rename`): `docs/adr/tasks-land-in-runner-deterministic-precedence.md` (~line 44-50) still uses several OLD spellings from before later renames — `prdsLandIn` (now `specsLandIn`), `pre-backlog`/`todo` (now `backlog`/`ready`), and `pre-proposed` (now `proposed`). It's a launch-time ADR that was not maintained through the subsequent prd→spec / todo→ready / proposed renames. Left untouched here because it's outside this task's scope (src + tests) and updating only `pre-proposed` while leaving the sibling stale tokens would be inconsistent. If ADR value spellings are meant to track the live vocabulary, this doc needs a broader refresh.

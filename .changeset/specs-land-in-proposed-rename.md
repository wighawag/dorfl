---
'dorfl': minor
---

Rename the `SpecsLandIn` config VALUE `pre-proposed → proposed` (hard cutover, no alias) so the spec-side placement value matches its on-disk folder `specs/proposed/`, exactly as `tasksLandIn: backlog` matches `tasks/backlog/`.

`pre-proposed` was a leftover of the earlier `pre-spec/` staging-folder prefix that survived the `folder-taxonomy-reorg-and-rename` rename. It surfaced in `specsLandIn` / `untrustedSpecsLandIn` (`dorfl.json`), the env `DORFL_SPECS_LAND_IN` / `DORFL_UNTRUSTED_SPECS_LAND_IN`, and the CLI `--specs-land-in`, so the value-vs-folder mismatch was a user-facing papercut. The value is now `proposed`: `DORFL_SPECS_LAND_IN=proposed` and `--specs-land-in proposed` are accepted, and the old `pre-proposed` spelling now FAILS LOUDLY through the existing enum validation (no silent back-compat read), since this repo has no external users yet (matching the `autoTriage → observationTriage` clean-cutover precedent). The on-disk folder `work/specs/proposed/` is unchanged: only the config value spelling changed. `tasksLandIn: 'backlog'` (already consistent) is untouched. Governing spec: `intake-integration-knob-and-specs-land-in-proposed-rename`.

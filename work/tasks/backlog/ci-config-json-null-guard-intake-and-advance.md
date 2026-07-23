---
title: Guard the CI gate derivation against `dorfl config --json` failure / null (intake + advance)
slug: ci-config-json-null-guard-intake-and-advance
blockedBy: []
covers: []
---

## What to build

The intake (and advance) CI workflows derive their gate values with `auto_build=$(dorfl config --json | jq -r .autoBuild)`. If `dorfl config --json` fails (non-zero exit) or `jq` yields `null` (key absent / malformed config), the shell variable becomes the literal string `null`, which is neither `true` nor `false` and silently falls through to the permissive `merge` branch. Add a guard so a failed/absent config resolution FAILS LOUDLY (or falls to the conservative side) instead of silently mis-deriving the mode.

Apply the SAME fix to both `generateIntakeWorkflow` (`intake-trigger-template.ts`) and the equivalent `advance` derivation (`advance-lifecycle-template.ts`) — the reviewer noted advance uses the identical unguarded pattern, so this is a shared hardening, not an intake-only fix. Keep the two byte-consistent where the shell is shared/mirrored, and extend the structural validators to assert the guard is present.

## Acceptance criteria

- [ ] The CI gate derivation detects a `dorfl config --json` non-zero exit and a `jq` `null`/empty result, and does NOT silently coerce to the `merge` branch (either fail the step loudly, or default explicitly to the conservative side with a logged reason).
- [ ] The fix is applied to BOTH the intake and advance workflow generators (consistent shell).
- [ ] The structural validators (`validateIntakeWorkflow` / the advance validator) assert the guard exists, so it cannot regress.
- [ ] Tests cover the generated-workflow assertions (guard present) and, where feasible, the derivation behaviour on a null/failed config.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: harden the CI merge-vs-propose gate derivation so a failed or malformed `dorfl config --json` cannot silently produce the permissive `merge` mode.
>
> Domain: both the intake workflow (`generateIntakeWorkflow` in `intake-trigger-template.ts`) and the advance workflow (`advance-lifecycle-template.ts`) have a `bash` step that runs `config_json=$(dorfl config --json)` then `auto_build=$(echo "$config_json" | jq -r .autoBuild)` (and `.autoTask`). When `dorfl config --json` exits non-zero or the key is absent, `jq -r` prints the string `null`, and the subsequent `[ "$auto_build" = "true" ]` test is false → the code silently takes the merge branch. That is a silent mis-derivation on a broken config.
>
> Where to look: the `steps.policy` (intake) / gate-derivation (advance) bash blocks; grep both template modules for `dorfl config --json` and `jq -r .autoBuild`. Add `set -euo pipefail` discipline where missing, check the `dorfl config --json` exit status, and reject/handle a `null` or empty `jq` result explicitly. Mirror the fix across both generators and extend their dependency-free structural validators (the `require(...)` invariants) to assert the guard text is present.
>
> Test at the workflow-generator/validator seam (the structural assertions these modules already use). This nit came from the Gate-2 review of `intake-ci-gate-resolution` (see `work/notes/observations/review-nits-intake-ci-gate-resolution-2026-07-23.md`). Governing context: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md` (why intake reads resolved config at all) and `docs/adr/ci-config-policy-and-gate-family.md` (the gate family is resolved, CI is not a special policy surface).
>
> Done: both workflows guard against a failed/null config resolution, validators assert it, tests green, gate green.

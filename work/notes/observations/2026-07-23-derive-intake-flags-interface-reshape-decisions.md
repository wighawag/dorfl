---
needsAnswers: true
---

# deriveIntakeFlags trust→placement+stamp rewrite — decisions (2026-07-23)

Task `derive-intake-flags-trust-drives-placement-not-mode` (spec `untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution`, ADR `untrusted-origin-carries-via-stamp-not-forced-staging`). Recorded per the ADR interface-reshape gate; linked from the done record.

## Decision 1 — `IntakeIntegrationFlags` shape kept, `task`/`spec` REPURPOSED (not removed)

`deriveIntakeFlags` still returns `{spec, task, originTrust}`; I did NOT drop the `spec`/`task` fields. What changed is their DERIVATION: `task` is now gate-derived (`autoBuild ? 'propose' : 'merge'`), symmetric with `spec` (`autoTask ? 'propose' : 'merge'`), instead of the old `autoBuild || !authorTrusted ? 'propose' : 'merge'`. The acceptance criterion allows "no trust-driven fields, OR repurposed" — I chose repurposed because the workflow still needs both file-emit modes on the wire (`--merge-task`/`--propose-task`), they are just no longer a function of author-trust. Alternative considered: fold trust out by removing `task` and defaulting intake's task mode from config alone — rejected because the workflow's `steps.policy` already resolves BOTH modes explicitly and the validator (`derives-merge-task`/`derives-propose-task`) asserts both branches exist; keeping the field is the minimal, symmetric change. Touches: only this module + its test; the CLI `--merge-task`/`--propose-task` flags and intake dispatch are unchanged.

## Decision 2 — the workflow passes `--origin-trust` only; placement selection stays inside intake's dispatch

The task prompt phrase "this task makes the WORKFLOW pass [the `--*-land-in` flags] based on trust" is looser than the code. The prior task (`intake-task-placement-symmetry`) wired intake's `dispatchTask`/`dispatchSpec` to select the untrusted-side placement default (`untrusted*LandIn` vs `*LandIn`) BY READING THE `originTrust` STAMP internally (intake.ts ~L1205 / ~L1437), with the CLI feeding all four config-resolved landing values in. So the workflow does NOT emit trust-derived `--*-land-in` flags; passing `--origin-trust=untrusted` is exactly what selects untrusted placement. `--*-land-in` remains the operator's EXPLICIT override (top of the placement precedence), config-resolved otherwise — never trust-derived. This matches the ADR's "the CALLER selects the configured default by reading the stamp" model. No new flag, no new concept introduced.

## Net behaviour change (matches ADR Consequences)

For a repo configuring nothing new, the ONLY change is: an untrusted-author task DOCUMENT now MERGES (gate off) with `originTrust: untrusted` stamped, instead of opening a document PR. Untrusted safety is the carried stamp (forces the BUILD to a code PR) + the placement default (defaults to staging), not a forced document PR. A trusted vs untrusted author now differ ONLY in the stamp + the placement folder, never in whether the document is PR'd.

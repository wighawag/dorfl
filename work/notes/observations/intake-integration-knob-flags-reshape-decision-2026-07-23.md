# Decision: how `IntakeIntegrationFlags` / `deriveIntakeFlags` were reshaped for the `intakeIntegration` knob (2026-07-23)

Recorded from task `intake-integration-knob` (spec `intake-integration-knob-and-specs-land-in-proposed-rename`) so the reviewer + a human can ratify or reverse the in-scope shape choice. Linked from that task's done record.

**What changed.** `deriveIntakeFlags` previously took `{gate: {autoBuild, autoTask}, authorTrusted}` and derived the document mode from the autonomy gates (`spec = autoTask ? propose : merge`, `task = autoBuild ? propose : merge`). It now takes `{intakeIntegration: 'merge' | 'propose', authorTrusted}` and returns both `spec` and `task` set to that SINGLE resolved value. The `IntakeGateState` interface was REMOVED (the gates no longer feed the mode).

**Decisions taken (and the alternatives considered):**

1. **Kept the `IntakeIntegrationFlags` two-axis `{spec, task, originTrust}` shape rather than collapsing to one `mode` field.** Both `spec` and `task` are now ALWAYS the same value (spec Out-of-Scope explicitly rejected a per-type `{task, spec}` split, US #1 chose a single knob). The pair is kept ONLY because `intake`'s CLI consumes `--merge-spec`/`--merge-task` on two independent flag axes (`resolveIntakeIntegrationModes`), so the derivation still emits two axes that happen to agree. Alternative considered: collapse to a single `mode` and let the CLI wiring fan it out — rejected as a larger, riskier change to the CLI flag surface for no behavioural gain. Touches: `intake.ts` `resolveIntakeIntegrationModes`, the workflow bash, the shell-equivalence test.

2. **The workflow bash reads `.intakeIntegration // .integration` in one jq expression** (the shell twin of the CLI's `intakeIntegration ?? integration`). Alternative: read the two keys separately and `??` in bash — rejected as more lines for the same result. A new validator `mode-not-gate-derived` forbids the derivation reading `.autoBuild`/`.autoTask` so the gate-coupling cannot silently regress.

3. **The CLI seam (`cli.ts` intake command) passes `config.intakeIntegration ?? config.integration` as the `resolveIntakeIntegrationModes` default** (was `config.integration`). This is the single place the fallback is applied, mirroring how `do.ts` threads `taskingIntegration ?? integration`. Explicit `--merge-*`/`--propose-*` flags still top the precedence (operator-present).

The durable rationale for decoupling (untrusted safety = stamp + placement, not a document PR) is the ADR `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`; the full JSDoc lives at the choice sites (`config.ts` `intakeIntegration`, `intake-trigger-template.ts` `IntakeIntegrationFlags` / `deriveIntakeFlags`).

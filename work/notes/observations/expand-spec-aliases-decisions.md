# Decisions — expand-spec-frontmatter-and-namespace-aliases (2026-07-09)

Durable record of the design choices made while implementing the EXPAND step of the prd→spec cutover (task `expand-spec-frontmatter-and-namespace-aliases`, prd `prd-to-spec-vocabulary-cutover-and-migration-command`). Each is additive and reversible by the next migrate/contract batch; recorded here so a reviewer/human can ratify or reverse. Link this from the task's done record.

## 1. `parseFrontmatter` precedence when both `spec:` and `prd:` keys are present

Chosen: the canonical `spec:` key WINS (populates both `fm.spec` and `fm.prd`); an empty value on one key never clobbers a non-empty value already read from the other. Ordering-independent (tested both orderings). Alternative considered: `prd:` wins (rejected — the whole cutover direction is prd→spec, so the new name should be authoritative). Touches: `frontmatter.ts` only; no downstream caller distinguishes the two fields yet (both carry the same value).

## 2. `resolveTaskOnlyArg` rejects `spec:` with its own message ("tasks, not specs")

Chosen: a SEPARATE `spec:` rejection branch beside the untouched `prd:` branch, so the legacy `prd:` error message stays byte-identical (an existing test asserts "tasks, not prds"). Alternative considered: fold both into one branch with a shared message (rejected — it changed the `prd:` message and broke an existing test; that is not additive). Touches: `slug-namespace.ts`; the contract task collapses the two branches.

## 3. `spec:<slug>` RESOLVES but `do` does not yet ROUTE it

`parseSlugArg`/`resolveSlug`/`resolveAdvanceArg` now resolve `spec:<slug>` to `{namespace: 'spec'}`, but `do.ts` still branches on `resolved.namespace === 'prd'` for the tasking path, so a hypothetical `do spec:<slug>` would currently fall through to the build-task path. This is DELIBERATE: the task scopes call-site migration (including the `do` dispatcher) to the migrate batches ("NO call site migrated onto `spec` here"); expand only makes the identifier resolve. Nobody types `spec:` yet and no test exercises `do spec:`. The very next migrate batch wires the `do`/tasking dispatch onto `spec`. Touches: `do.ts` (left untouched by design), the migrate batch that owns the `do`/namespace call sites.

## 4. Config: `specsLandIn` is an OPTIONAL Config key; resolver reads `specsLandIn ?? prdsLandIn`

Chosen: `specsLandIn?: SpecsLandIn` (optional, no `DEFAULT_CONFIG` entry, mirroring `verify`) so "unset" means "fall through to the legacy `prdsLandIn` value" — zero behaviour change when only `prdsLandIn` is set. The intake CLI seam reads `config.specsLandIn ?? config.prdsLandIn` (canonical wins), and `--specs-land-in`/`DORFL_SPECS_LAND_IN` sit beside `--prds-land-in`/`DORFL_PRDS_LAND_IN`, specs winning when both are given. The internal `PerformIntakeOptions.prdsLandIn` field and the `explicitPrdsLandIn` rung were NOT renamed (still spelled `prd*`) — only the CLI-facing surface widened; renaming the internal field is a migrate-batch concern. Alternative considered: make `specsLandIn` required with a default (rejected — it would duplicate the default and force every reader to disambiguate, whereas optional makes the fall-through explicit). Touches: `config.ts`, `env-config.ts`, `repo-config.ts` (allowed keys), `cli.ts`.

## 5. Intake `spec` outcome routes through the `prd` dispatch; `parseIntakeVerdict` ACCEPTS `spec`

`IntakeOutcome`/`IntakeArtifactType` gained `'spec'`; the `decideAndDispatch` switch routes `case 'spec':` through the SAME `dispatchPrd` path as `case 'prd':` (both name the parent-spec artifact, both use `modes.prd`). `parseIntakeVerdict` now accepts an agent-emitted `"spec"` outcome beside `"prd"` (additive; `prd` still valid). This changed the validation error message from `ask|task|prd|bounce` to `ask|task|spec|prd|bounce` (an existing test asserting the old substring was updated to match the intentional additive change). The `IntakeIntegrationModes` object keys stay `{task, prd}` and the granular flags stay `--merge-prd`/`--merge-task` — renaming those is a migrate-batch concern. Touches: `intake.ts`, `intake-verdict-parse.test.ts`.

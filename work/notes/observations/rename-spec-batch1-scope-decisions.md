# Decisions — prd→spec batch 1 (rename-spec-work-layout-and-folders)

Date: 2026-07-09. Linked from the done record of `rename-spec-work-layout-and-folders`.

These are scope/coherence decisions made while building batch 1 (the `work-layout.ts` folder key/value rename + on-disk `work/specs/* → work/specs/*` git-mv). Recorded here so the reviewer and the human can ratify or reverse.

## 1. Renaming the folder KEYS forces updating every call-site key literal (in THIS batch)

- **Chose:** rename the folder KEYS `prds-* → specs-*` in `WORK_FOLDER_NAME` AND update every call site that passes those keys as string literals (`workItemPath(cwd, 'prds-ready', …)`, the `PARTICIPATING_POOLS`/`APPLY_LIFECYCLE_FOLDERS`/`advance.ts` folder arrays, `ledger-read.ts` local param unions `'prds-proposed' | 'prds-tasked'`, etc.), so the package still compiles.
- **Why:** the keys are `WorkFolderKey`-typed string literals (`as const satisfies readonly WorkFolderKey[]`, `Record<SidecarType, readonly WorkFolderKey[]>`). Renaming a key without updating its literal call sites is a hard TypeScript break, so a "migrate batch" that renames keys MUST update its call sites in the same batch to land green (that is exactly the expand→migrate→contract discipline, ADR §7c: each batch lands green).
- **Tension noted:** the task's domain note says "every call site references keys, never raw strings, so renaming a folder should not re-touch call sites." That claim is true for the VALUE flip (`work/specs/* → work/specs/*`) but NOT for the KEY rename, which necessarily re-touches the key literal at every call site. I read the task's explicit "rename the folder KEYS and VALUES" as authoritative and updated the literals.
- **Touches:** the call sites in `prompt.ts`, `tasking.ts`, `tasking-lock.ts`, `detect.ts`, `advance.ts`, `needs-attention.ts`, `item-lock.ts`, `ledger-read.ts`, `item-path.ts`, `triage-persist.ts`, `intake.ts`, `cli.ts`, and the tests that pass these keys (`prompt.test.ts`, `gc-reap-stale-locks.test.ts`, `work-layout.test.ts`, `helpers/gitRepo.ts`). Batch 4 (`rename-spec-remaining-src-modules`) still owns the REMAINING `Prd*` identifiers/prose/frontmatter-adjacent symbols in those same modules; this batch only touches the folder-key LITERAL, not those symbols.
- **Alternative considered:** rename only the VALUES + `PRD_FOLDERS`/`PrdFolder`, leaving keys as `prds-*`. Rejected: contradicts the task's explicit "rename the folder KEYS".

## 2. Did NOT rename `PrdsLandIn` here (left for batch 3)

- **Chose:** leave the `config.ts` type `PrdsLandIn` / the `prdsLandIn` config key / the `--prds-land-in` flag / `explicitPrdsLandIn` untouched.
- **Why:** the task's phrase "any `PrdsLandIn`-adjacent symbol" conflicts with sibling batch 3 (`rename-spec-config-and-intake`), which EXPLICITLY owns `prdsLandIn → specsLandIn` (key + resolution + JSDoc). `PrdsLandIn` is a config-surface type in `config.ts`, not a folder-key symbol in `work-layout.ts`. Renaming it here would pull the config surface into a folder-identity batch and collide with batch 3's ownership. Per the decision bar (touches ANOTHER task, sets a config-surface name), I leave it for batch 3.
- **Touches:** batch 3 (`rename-spec-config-and-intake`). No overlap remains.

## 3. Kept close-job.ts / ledger-read.ts INTERNAL `Prd*` aliases

- `close-job.ts` keeps its local `PRD_FOLDERS`/`WORK_LAYOUT_PRD_FOLDERS` aliases; only the IMPORT specifier is updated to the new exported name `SPEC_FOLDERS`. `ledger-read.ts` keeps its `Prd*` function/type names; only the imported `PrdFolder` type is renamed to `SpecFolder`. Rationale: the local `Prd*` symbols are batch 4's to rename ("every remaining `Prd*` symbol"); this batch only renames the work-layout EXPORTS and rebinds the imports so the package compiles.

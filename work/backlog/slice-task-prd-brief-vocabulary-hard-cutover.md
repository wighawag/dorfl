---
title: Phase 1: hard cutover of the slice->task / prd->brief vocabulary across CLI, frontmatter, and the identity/lock-ref/sidecar seam (no deprecated aliases)
slug: slice-task-prd-brief-vocabulary-hard-cutover
prd: folder-taxonomy-reorg-and-rename
blockedBy: [work-layout-module-centralises-all-work-paths, brief-regime-rename-and-dropped-migration]
covers: [2, 3]
---

## What to build

The vocabulary HARD CUTOVER: `slice -> task` and `prd -> brief` across every
user-facing and identity surface, with NO deprecated aliases (we have no external
users owed a migration window). After this slice, no old prefix is accepted.

Surfaces to flip:

- **CLI:** `do prd:<slug>` / `do slice:<slug>` → `do brief:<slug>` / `do task:<slug>`;
  any CI-matrix ids likewise.
- **Frontmatter:** the `prd:` field (a slice's pointer to its parent) → `brief:`;
  `sliceAfter:` (the cross-PRD ordering field) → `briefAfter:`.
- **The identity / namespace seam** (the single source of truth shared by the
  CLI resolver, the work-branch ref, the sidecar filename, and the lock ref):
  - `slug-namespace.ts`: the `SlugNamespace` union (`'slice'|'prd'` → `'task'|'brief'`,
    keeping `observation`); the prefix constants (`SLICE_PREFIX`/`PRD_PREFIX` →
    `task:`/`brief:`); `workBranchRef` / `parseWorkBranchRef` (the
    `work/<type>-<slug>` branch encoding and its parse regex);
    `resolveSlug` / `resolveAdvanceArg` / `resolveSliceOnlyArg` messages + guards.
  - `sidecar.ts`: `SidecarType` (`'prd'|'slice'` → `'brief'|'task'`),
    `TYPE_TO_NAMESPACE`, `resolveSidecarIdentity`, `typeForNamespace`, and the
    sidecar filename derivation `work/questions/<type>-<slug>.md`.
  - `item-lock.ts`: the lock-ref ENTRY encoding `<type>-<slug>` becomes
    `task-<slug>` / `brief-<slug>`; `itemFromLockEntry` (the prefix list
    `['slice','prd','observation']` → `['task','brief','observation']`),
    `heldSliceSlugs` (the `'slice-'` prefix → `'task-'`), and any `lockEntryFor`
    path that threads the type.

The cutover is BREAKING by design: a pre-rename un-namespaced ref / old prefix is
simply not accepted (the `parseWorkBranchRef` "returns undefined for a pre-rename
ref" behaviour already documents this clean-break stance, extend it to the new
type alternation). Keep the `observation`/`obs:` namespace exactly as-is (it is
unaffected by the slice/prd rename).

This slice does NOT move on-disk folders (the brief/task folders already moved in
the prior slices) and does NOT edit the protocol docs (that is the final slice). It
flips the in-code vocabulary + identity scheme and updates the tests that assert on
the old prefixes/fields.

If you add any new git-`file://`-CAS race test file, register it in the
`RACE_SENSITIVE` list in `vitest.config.ts` (the house pattern) so it does not
flake under full-suite parallel load.

## Acceptance criteria

- [ ] `do brief:<slug>` / `do task:<slug>` work; `do prd:<slug>` / `do slice:<slug>`
      are NOT accepted (no deprecated alias).
- [ ] Frontmatter `prd:` → `brief:` and `sliceAfter:` → `briefAfter:` everywhere
      they are read/written; no old field name is parsed.
- [ ] The identity seam uses `task`/`brief` end to end: `SlugNamespace`,
      prefixes, `workBranchRef`/`parseWorkBranchRef`, `SidecarType` +
      `resolveSidecarIdentity` + sidecar filename, and the lock-ref entry
      encoding (`task-<slug>`/`brief-<slug>`), `itemFromLockEntry`,
      `heldSliceSlugs`.
- [ ] The `observation`/`obs:` namespace is unchanged.
- [ ] No old prefix (`slice`/`prd`) is accepted after cutover (a pre-rename ref
      resolves to undefined / is rejected, the clean-break stance).
- [ ] Tests assert the new prefixes/fields/identity resolve and the old ones are
      rejected; the Phase-0 guard still passes; any new git-file://-CAS race test
      file is registered in `RACE_SENSITIVE`.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `work-layout-module-centralises-all-work-paths`, the path/identity seam is
  centralised first.
- `brief-regime-rename-and-dropped-migration`, the `briefs/` folders must exist
  before the brief identity/CLI cutover references them; also serialises the
  edits to `item-lock.ts` / `sidecar.ts` so the rebases stay trivial.

## Prompt

> Build the `slice->task` / `prd->brief` HARD CUTOVER of the
> `folder-taxonomy-reorg-and-rename` PRD: rename the vocabulary across the CLI,
> frontmatter, and the whole identity/lock-ref/sidecar seam, with NO deprecated
> aliases. After this slice no old prefix is accepted.
>
> FIRST, check this slice against current reality: confirm the `tasks/` and
> `briefs/` folders already landed (the two prior flip slices are in `done/`) and
> the identity seam still uses `slice`/`prd` prefixes. If the cutover already
> happened, route to needs-attention.
>
> Domain vocabulary: the system has ONE identity scheme shared by four surfaces,
> the CLI prefix (`do <prefix>:<slug>`), the work-branch ref (`work/<type>-<slug>`),
> the sidecar filename (`work/questions/<type>-<slug>.md`), and the per-item lock
> ref (`refs/agent-runner/lock/<type>-<slug>`). All four derive `<type>` from one
> resolver. This slice flips `<type>` from `slice`/`prd` to `task`/`brief`
> everywhere, keeping `observation`/`obs:` exactly as-is. The cutover is BREAKING:
> a pre-rename un-namespaced ref / old prefix is rejected (it is not a
> migration-window alias).
>
> Where to look:
> - `slug-namespace.ts`, `SlugNamespace` union, `SLICE_PREFIX`/`PRD_PREFIX`,
>   `workBranchRef`/`parseWorkBranchRef` (and its regex), the `resolveSlug` /
>   `resolveAdvanceArg` / `resolveSliceOnlyArg` guards + messages.
> - `sidecar.ts`, `SidecarType`, `TYPE_TO_NAMESPACE`, `resolveSidecarIdentity`,
>   `typeForNamespace`, the `work/questions/<type>-<slug>.md` derivation.
> - `item-lock.ts`, the lock entry `<type>-<slug>` encoding, `itemFromLockEntry`
>   (its prefix list), `heldSliceSlugs` (the `'slice-'` prefix).
> - `do.ts` / `cli.ts`, the `do prd:`/`do slice:` dispatch + help text.
> - `frontmatter.ts` / `ledger-read.ts` and the field readers, `prd:` -> `brief:`,
>   `sliceAfter:` -> `briefAfter:`.
>
> SCOPE FENCE: do NOT move on-disk folders (already done) and do NOT edit the
> protocol docs (the final slice owns that). Flip in-code vocabulary + identity +
> tests only.
>
> "Done" means: the new CLI prefixes/fields/identity resolve, the old ones are
> rejected, `observation` is untouched, the Phase-0 guard still passes, any new
> git-file://-CAS race test is registered in `RACE_SENSITIVE` (vitest.config.ts),
> and the full acceptance gate is green. RECORD any non-obvious in-scope decision
> (e.g. the exact rejection behaviour for a pre-rename ref) per `ADR-FORMAT.md`.

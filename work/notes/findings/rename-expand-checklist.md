# Coined-token rename: expand-first checklist for MINT/MAP surfaces

## Frame

For a coined-token rename — a value that is minted, mapped, and switched on across the codebase (e.g. the in-flight `spec` namespace rename) — the surfaces where the token is DEFINED are systematically under-enumerated by the first expand task, while the surfaces that merely READ the token ride safely on a widened union and belong in migrate batches. Two concrete do-agent STOP catches on the current rename motivated this checklist:

1. **First expand missed the identity layer entirely.** `expand-spec-frontmatter-and-namespace-aliases` widened frontmatter / `SlugNamespace` but did not touch the identity-derivation layer; the batch-2 `do` agent stopped when the type-union surfaces did not line up with the new token.
2. **Second catch: lock + sidecar identity.** Verified @ commit `1d0b43fc`, the missing definitional sites were `sidecar.ts:72` (`SidecarType = 'spec' | 'task' | 'observation'`), the inverse map `TYPE_TO_NAMESPACE`, the resolver `typeForNamespace`, and the `'spec'` cases in `item-lock.ts`. The failure mode was silent: because `typeForNamespace` falls through to `'task'` for unrecognised inputs, a missed case produces `lockEntryFor('spec:foo') === 'task-foo'` — a collision, not a crash. This was fixed by adding `expand-spec-lock-and-sidecar-namespace`.

The lesson generalises: definitional MINT/MAP sites must all be widened in an expand task BEFORE any migrate batch flips an emit site. Consumer READ sites are safe to leave until migrate.

Why a checklist (not an ADR or `WORK-CONTRACT.md` edit): the human's answer explicitly picked an enumerable checklist over discipline prose or process rules because a concrete enumeration of surface classes is directly actionable at grep-time for the next rename.

## Definitional MINT/MAP surface classes (expand-first)

Every hit in these classes MUST be widened in an expand task before any migrate batch renames an emit site:

- [ ] **String-literal / discriminated-union type members.** e.g. `type SidecarType = 'spec' | 'task' | 'observation'`, `type SlugNamespace = …`. Widen the union (add the new member alongside the old) in expand; drop the old member only after all emit sites are migrated.
- [ ] **Prefix / literal constants that MINT the token.** e.g. `PRD_PREFIX`, work-branch-ref builders (`workBranchRef`), any parser that recognises a `<token>:` or `<token>-` prefix. Both the writer AND the parser must accept the new prefix in expand.
- [ ] **Namespace / type resolvers and their inverse maps.** e.g. `typeForNamespace` and `TYPE_TO_NAMESPACE` in `sidecar.ts`. Both directions of the mapping must be widened in one expand task or reads and writes fall out of sync.
- [ ] **Silent-fallthrough default cases in resolvers.** A missing `case 'spec':` in a `typeForNamespace`-shaped function does not throw — it aliases to the default (`'task'` in the concrete case), which produces colliding identity strings (`lockEntryFor('spec:foo') === 'task-foo'`). Enumerate every such resolver explicitly; do not rely on the compiler to surface the gap.
- [ ] **Per-item identity derivations that switch on the token to build a namespaced string.** e.g. item-lock keys (`item-lock.ts` `'spec'` cases), sidecar on-disk paths, any function that composes `${namespace}-${slug}` or `${namespace}:${slug}`. If the switch is missing a case, the derived identity silently collides with another namespace's identity.

## Consumer READ surface class (migrate-batch territory)

Plain reads of the form `item.namespace === 'spec'` (or the equivalent `resolved.namespace === 'spec'` / `i.namespace === 'spec'`) ride safely on a widened union and do NOT need to be in the first expand task. They belong in migrate batches, one file (or a small cluster) at a time.

Worked example — the current rename's consumer READ surface, ~11 sites across the following modules (from the source observation):

- `packages/dorfl/src/advance.ts`
- `packages/dorfl/src/advance-drivers.ts`
- `packages/dorfl/src/advance-isolated.ts`
- `packages/dorfl/src/advance-loop-driver.ts`
- `packages/dorfl/src/cli.ts`
- `packages/dorfl/src/do.ts`
- `packages/dorfl/src/do-autopick.ts`
- `packages/dorfl/src/do-remote-auto.ts`
- `packages/dorfl/src/scan.ts`
- `packages/dorfl/src/tasking.ts`
- `packages/dorfl/src/triage-persist.ts`

Each of these is a read against a widened union — safe until the migrate batch that flips it.

## Procedure for the next coined-token rename

A future rename can literally follow these steps:

1. **Grep the old token in both shapes.** As a string literal (`'spec'`, `"spec"`, `` `spec` ``, prefix forms like `'spec:'`) AND as a type-member (in `type X = 'spec' | …` positions). Do both — they surface different files.
2. **Classify every hit** into exactly one of three buckets:
   - `definitional-mint` — the site that produces or names the token (union member, prefix constant, branch-ref builder).
   - `definitional-map` — the site that translates between the token and something else (resolver, inverse map, identity-derivation switch).
   - `consumer-read` — the site that only compares against the token (`x.namespace === 'spec'`).
3. **Put every `definitional-mint` and `definitional-map` hit in an expand task**, widening the union / adding the new case alongside the old, BEFORE any migrate batch renames an emit site. This is the single most important step: if any definitional site is missed here, the first migrate batch breaks the identity layer (silently, if the resolver falls through).
4. **Enumerate every silent-fallthrough resolver explicitly** — walk each `default:` / trailing `return 'task'` / `?? 'task'` and confirm it is either exhaustive or intentionally aliasing. These do not error on a missing case; they collide.
5. **Leave `consumer-read` hits for migrate batches.** They are safe on a widened union and can be renamed incrementally; they do not block the first expand.

## Provenance

Two do-agent STOP diagnoses on the in-flight `spec` namespace rename; the second catch is documented in observation `spec-lock-sidecar-namespace-was-missed-by-first-expand-task` (source observation for this finding).

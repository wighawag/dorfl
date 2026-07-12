---
title: Rename-cutover lessons — three coverage surfaces, and value-aliasable vs atomic is the load-bearing classification
type: finding
status: durable
source: consolidated from four sibling observations of the `prd`→`spec` cutover (see Provenance) — the C-audit's single-lens blind spot fired three times, on producer emit-sites (4d), residual exported symbols (4e), and CLI-flag + internal-identifier surfaces (4f), plus the earlier value-alias vs symbol-alias re-scope of 4a
---

A durable rule set for planning any namespace / enum-value / vocabulary rename
cutover in this repo. Not an ADR (no new decision), not a war-story — the
episodes live in the observations linked at the bottom; this note is the
reusable shape distilled from them.

## The pattern in one line

A rename cutover has **three coverage surfaces**, and one of them is **DATA**
(on-disk identity), not source. Across all three surfaces, the **load-bearing
classification** for every occurrence of the old token is: **is it a VALUE
(aliasable, incrementally splittable) or a NAME / FILE (atomic, must move with
its full blast radius in one commit)?** A single-lens coverage audit (e.g.
"widen every `namespace === 'old'` check") will look green under the alias and
silently drop the other surfaces. The `prd`→`spec` cutover surfaced this three
times in a row, once per surface, each caught by the contract-phase leak scan
rather than the curated audit.

## 1. Producer/consumer coupling — "migrate the consumers" is two jobs

For a namespace / enum-VALUE cutover, migrating the consumer layer is really
**two separate jobs**:

1. **Widen CONSUMER `=== 'old'` checks** to `|| === 'new'`. Green on the alias
   in isolation.
2. **Flip PRODUCER emit-site VALUES and local union DEFINITIONS** from
   `'old'` to `'new'`.

An `'old'` / `'new'` value alias makes step 1 green on its own, which
**hides** every un-flipped producer — the build stays green, so a coverage
audit that only asks "does each batch stay green?" misses them entirely. The
producer flip is only *forced* at the contract step (when the alias is
removed) or by a real identifier leak scan.

Practical rule: **enumerate PRODUCERS and CONSUMERS separately.** A rename
plan that lists only consumer sites is under-scoped by construction. In the
`prd`→`spec` cutover the producer class was ~50 identifiers across ~14 modules
(`SelectedNamespace`, `DecisionOutcome`, `ScannedBlockedItem`, `BlockedItem`,
`lifecycle-pools`, `needs-attention`, `triage-persist artifact`,
`{namespace:'prd'}` emit-sites, `prd:${slug}` CLI-token emits) — none of it
listed by the original audit, all of it caught by the leak scan.

## 2. TYPE identity vs on-disk FILE identity

When the renamed value **also keys an on-disk file** (a sidecar, a lock, a
folder-per-item layout), the producer flip is further **DATA-coupled**:
flipping the emitted value changes which file the readers probe, but the
files on disk still use the old spelling until the data migration runs. So a
naively "additive" producer flip is NOT green in isolation — the reader
misses the file.

Keep the two identities separate in the plan:

- The **TYPE-member** `'old'` is SOURCE. It is removed by the contract task
  when the alias goes away.
- The on-disk **FILENAME** `old-<slug>.md` is DATA. It is converted by the
  data-migration command (`old-<slug>.md → new-<slug>.md`), which also drops
  the reader-side fallback.

Consequence: the file-path alias (a reader that probes `[new-<slug>.md,
old-<slug>.md]`, or a `sidecarPathCandidates(identity)` returning
`[canonical, ...legacyFallbacks]`) **outlives the type-value cutover** and
belongs to the data-migration command's blast radius, not the contract task's.
The contract task's forward leak scan allow-lists that one file-path
fallback with this justification.

## 3. A coverage audit needs THREE enumerations, not one

The C-audit that mapped the `prd`→`spec` migrate surface by ONE lens
(`namespace === 'old'` consumer sites) missed the other surfaces three times
in a row. A rename-cutover coverage audit needs **three separate
enumerations**:

1. **VALUE consumers** — `=== 'old'` sites. Alias-covered. Incremental,
   file-splittable.
2. **VALUE producers** — emit-sites + local union type DEFINITIONS. Must be
   flipped, or the alias silently hides them (the 4d gap).
3. **Exported SYMBOLS / types / fields / file names** — no alias possible
   (see §5). Atomic rename. Enumerate by a **real** `grep -rn "export.*Old"`
   (and a case-INSENSITIVE token grep covering PascalCase, camelCase, AND
   `CONSTANT_CASE`), **never a hand-curated list**.

A curated symbol list is exactly what dropped, in the `prd`→`spec` cutover:

- `renderPrd` (intake.ts)
- `buildIntakeDecisionPrd` (intake.ts, re-exported from index.ts — public API)
- `findPrdPath` (prompt.ts)
- `promoteFromPrePrd`, `PromoteFromPrePrdOptions`, `PromoteFromPrePrdResult`
  (needs-attention.ts)
- `PrdsLandIn` and its internal plumbing: `config.prdsLandIn`,
  `prdLandingToSide`, `explicitPrdsLandIn`, `PerformIntakeOptions.prdsLandIn`,
  the env-config schema

None were on the audit's curated list; all were exported, all were live, all
were caught by the contract-phase leak scan when it forced a real
`grep "export.*Prd"`. A pre-flight that greps only `[A-Za-z]*Prd[A-Za-z]`
also misses `STAGED_PRDS_DIR` (all-caps) — the token pre-flight must be
case-insensitive.

**The contract-phase leak scan is the honest backstop**, precisely because it
greps instead of trusting the curated audit — three STOPs, three real gaps,
zero false alarms. Treat a curated symbol list appearing in a rename task
as a **risk**, not a convenience.

## 4. VALUE aliases are incremental; SYMBOL / TYPE / FILE renames are atomic

The two mechanics have opposite green-in-isolation properties, and conflating
them is what makes a file-orthogonal a/b/c split misfire.

- **VALUE aliases** (parser dual-accept, config dual-read, enum/namespace
  dual-accept, intake dual-verb): both `'old'` and `'new'` are simultaneously
  valid, so a consumer reading a VALUE keeps working while the migration
  moves. This is what makes a **file-orthogonal a/b/c split** work for the
  value-consumer batches — each sub-batch stays green on its own.
- **SYMBOL / TYPE / FILE renames**: no dual form. The old NAME simply stops
  existing, breaking every importer at `pnpm -r build` immediately. An
  `export { OldName } from '...'` shim is (a) an unratified new surface, (b)
  itself flagged by the leak scan, and (c) usually misses importers outside
  a single sub-batch's file set. So exported-symbol / file renames must be
  **ATOMIC**: definition + `index.ts` re-export + every importer + coupled
  tests in ONE green commit, no alias.

**Consequence for batch planning:** before asserting "the alias covers this
batch," CLASSIFY every identifier the batch touches:

- VALUE (aliasable, incremental, file-splittable), or
- NAME / FILE (atomic, must move with its full blast radius).

A file-orthogonal a/b/c split only composes for the value layer. The
symbol/file layer is its **own** atomic batch, and it must be **ordered
first** so downstream value-consumer batches rebase cleanly against the new
names.

## 5. Three surfaces to name before you audit — resolver-namespace vs artifact-type vs promote-alias

When reasoning about a rename's blast radius, keep three DIFFERENT surfaces
apart by name. Conflating them is what makes a single-lens audit under-count
(a consumer of one surface is not a consumer of the others):

1. **Resolver-namespace** — how a token is parsed / resolved from user input
   or on-disk (`SlugNamespace`; `resolveSlug('prd:x')` → `{namespace: 'prd'}`).
2. **Artifact-type** — the on-disk / type identity of the object
   (`SidecarType`; the file layout; `DecisionOutcome`'s `artifact` field).
3. **Promote-alias** — a compatibility bridge kept explicitly for migration
   (the `promote` verb accepting BOTH `prd:` and `spec:` input, a
   `{namespace:'prd'}` produced for a `PromotableItem`'s display, etc.).

A consumer of surface 1 (`resolveSlug`) is not a consumer of surface 2
(`artifact === 'prd'`) is not a consumer of surface 3 (the promote alias) —
they migrate on different timelines and belong to different batches. Name
the three surfaces up-front in the plan so a single-lens audit cannot silently
conflate them.

## 6. How to use this next time — a rename-plan author's checklist

Copy this into the top of any rename-cutover plan:

1. **Name the three surfaces** for this rename: resolver-namespace,
   artifact-type, promote-alias. Assign every touch-site to exactly one.
2. **Enumerate three lists, not one:** value-consumers (`=== 'old'`),
   value-producers (emit-sites + local union DEFINITIONS), exported
   symbols/types/fields/file names via a **real, case-insensitive**
   `grep -rn "export.*Old"` + `grep -rin "old"` — never a hand-curated list.
3. **Classify every identifier as VALUE or NAME/FILE.** VALUE → aliasable,
   file-splittable, incremental batch. NAME/FILE → atomic batch, ordered
   FIRST.
4. **Separate TYPE identity from on-disk FILE identity.** The file-path
   alias belongs to the data-migration command, not the contract task.
   Carve out the reader fallback explicitly.
5. **Plan the contract-phase leak scan as the backstop**, not the audit.
   Assume the curated list is incomplete; expect the leak scan to STOP the
   contract task at least once and treat that as the scan doing its job.
6. **Pre-flight your token grep case-insensitively** and include
   `CONSTANT_CASE` — not just PascalCase / camelCase.

## Provenance

Consolidated from four sibling observations of the `prd`→`spec` cutover. These
episodes are the ground truth for every point above; they may be discharged
after this note lands, and remain reachable via `git log` on their paths:

- `work/notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md`
  — producer/consumer coupling (§1) + TYPE-vs-FILE identity split (§2).
- `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md`
  — the single-lens blind spot, the three enumerations (§3), and the
  concrete leaked-symbol list (`renderPrd`, `buildIntakeDecisionPrd`,
  `findPrdPath`, `promoteFromPrePrd*`, `PrdsLandIn` plumbing).
- `work/notes/observations/prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md`
  — the value-alias vs symbol-alias distinction (§4); classify each
  identifier before planning batches.
- `work/notes/observations/spec-migrate-4c-scope-decisions.md`
  — the resolver-namespace vs artifact-type vs promote-alias three-surface
  distinction (§5).

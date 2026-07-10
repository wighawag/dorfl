---
title: slug-namespace-resolution — bare = slice, slice:/prd: explicit, ERROR on collision (§3a)
slug: slug-namespace-resolution
spec: command-surface-phase-2
blockedBy: []
covers: [7]
---

## What to build

The §3a slug-namespace resolver: a PRD and a slice may share a slug, so a bare slug is ambiguous across the two namespaces `do` spans. A pure resolver + its wiring into the slice-only commands.

| input | resolves to | on collision (a slice AND a PRD named `<slug>`) |
| --- | --- | --- |
| `<slug>` (bare) | the **slice** | **ERROR** — "ambiguous; use `slice:<slug>` or `prd:<slug>`" |
| `slice:<slug>` | the slice | always unambiguous |
| `prd:<slug>` | the PRD | always unambiguous |

- **Bare `<slug>` is human convenience ONLY** — it resolves to the slice, but ONLY after a cheap cross-namespace existence check confirms no PRD shares the slug; on a collision it ERRORS loudly (it never silently guesses).
- **Slice-only commands** (`claim`, `start`, `resume`, `complete`, `prompt`, `requeue`, `work-on`) accept bare (= slice) and `slice:` (explicit alias), and **reject `prd:`** with a clear "operates on slices, not PRDs" error.
- `do` accepts all three (it spans both namespaces) — but THIS slice provides the resolver + wires the slice-only commands; `do` consumes the resolver in the `do-in-place` slice.
- **Existence checks — read the slice side through the existing read path; the PRD side needs a NEW reader (this does not exist yet).** A SLICE is resolved through the existing read seam (`ledgerRead.resolveLocalState` already returns `backlog` + reads `in-progress`/`done`; `frontmatter` parses slugs). But there is **NO PRD reader anywhere today** — `ledger-read.ts`/`scan.ts` read only `backlog`/`done`/`needs-attention`, never `work/prd/` (or `work/slicing/`). So the PRD-existence check is a small ADDITION you make here: a cheap read of `work/prd/<slug>.md` (and `work/slicing/<slug>.md`) resolving the PRD slug from frontmatter (falling back to filename), the same shape the slice readers use. Add it as a focused PRD-existence helper (ideally near/through the read seam so it is the single PRD read path the autoslice/`do prd:` slices later reuse) — do NOT pretend an existing reader covers it.
- The slice = `backlog/`+`in-progress/`, PRD = `prd/`(+`slicing/`). This mirrors the field-level namespace split the contract already makes (slice `blockedBy` vs PRD `sliceAfter`); the `slice:`/`prd:` prefixes are the command-line form of it.

## Acceptance criteria

- [ ] A pure resolver maps bare → slice (after a no-PRD-collision check), `slice:` → slice, `prd:` → PRD; on a slice/PRD collision a bare slug ERRORS with the "use slice:/prd:" message.
- [ ] The slice-only commands (`claim`/`start`/`complete`/`prompt`/`work-on`, and `requeue`/`resume` if they exist yet — otherwise leave hooks) accept bare + `slice:` and reject `prd:` with a clear "operates on slices, not PRDs" error.
- [ ] The SLICE-existence check reads through the existing read seam; a NEW PRD-existence reader is added (none exists today — the read seam/scan read only backlog/done/needs-attention, never `work/prd/`), reading `work/prd/<slug>.md` (+`work/slicing/<slug>.md`), slug from frontmatter or filename. The PRD reader is a single shared path (so autoslice/`do prd:` reuse it), not a bespoke scan.
- [ ] Tests: bare resolves to slice; seeded slice/PRD collision errors on bare; `slice:`/`prd:` always unambiguous; a slice-only command rejects `prd:`.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — pure logic + wiring; `do-in-place` and `human-face-verbs` consume it.

## Prompt

> Build the **§3a slug-namespace resolver** per `docs/adr/command-surface-and- journeys.md` §3a: bare `<slug>` = the slice (after a cheap no-PRD-collision check; ERROR on collision), `slice:<slug>`/`prd:<slug>` explicit. `do` spans both namespaces; slice-only commands accept bare + `slice:` and reject `prd:`. This slice provides the pure resolver + wires the slice-only commands (`do` consumes it in the `do-in-place` slice).
>
> FIRST run the drift check: confirm the commands listed (`claim`/`start`/`complete`/ `prompt`/`work-on`) and the read path still match; `requeue`/`resume` are added by sibling slices — wire them if present, else leave a clear seam.
>
> READ FIRST: ADR `command-surface-and-journeys` §3a (the table + the rule that bare never silently guesses; CI uses explicit prefixes), the read path (`src/ledger-read.ts` / `src/scan.ts` readers / `src/frontmatter.ts`) for the SLICE side, and `src/cli.ts` for the slice-only command wiring.
>
> CRITICAL: there is NO PRD reader today — `ledger-read.ts`/`scan.ts` read only `backlog`/`done`/`needs-attention`, NEVER `work/prd/`. The slice-existence check uses the existing read seam; the PRD-existence check is a NEW helper you add (read `work/prd/<slug>.md` + `work/slicing/<slug>.md`, slug from frontmatter/filename), ideally added near/through the read seam so it is the single PRD read path the later autoslice / `do prd:` work reuses. Do NOT assume an existing reader covers PRDs.
>
> Implement a pure resolver (no git, no side effects beyond the existence reads) and wire the slice-only commands to reject `prd:`.
>
> TDD with vitest, house style: bare→slice, collision→error, explicit prefixes unambiguous, slice-only command rejects `prd:`. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim slug-namespace-resolution --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/slug-namespace-resolution <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/slug-namespace-resolution.md work/done/slug-namespace-resolution.md
```

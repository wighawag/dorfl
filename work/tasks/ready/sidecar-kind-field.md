---
title: Sidecar entry `kind` field (merge | stuck | triage | spec) — the dispatch signal the apply rung reads
slug: sidecar-kind-field
blockedBy: []
covers: []
---

> INTERIM PRIMITIVE — may be REMOVED later. This per-entry `kind` field is the
> dispatch signal for the answered-question apply layer TODAY (flat
> `work/questions/`). Once question sidecars are grouped into KIND-BASED
> SUBFOLDERS (`questions/merge/`, `questions/stuck/`, `questions/triage/`,
> `questions/spec/`), the FOLDER encodes the kind and this per-entry field becomes
> REDUNDANT. That restructure is its own ADR-worthy decision, tracked by the
> observation `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`
> + idea `folder-taxonomy-and-prd-edit-handshake`. So build this as a clean,
> easily-removable field, NOT a load-bearing fixture: a single typed field on the
> entry, read in exactly ONE place (the apply dispatch), so the later
> folder-cutover can delete it in one move.

## What to build

Add a typed, OPTIONAL `kind` field to the question-sidecar ENTRY so the
answered-question apply rung can route a runner-ACTION question (e.g. `merge`,
`stuck`) to the DETERMINISTIC action dispatch, and a CONTENT question
(`triage`, `spec`) to the agentic `decide()` path — WITHOUT sniffing the shape
of another field.

This is the foundational primitive the three `land-time-reverify` merge-question
tasks were conditioned on (PRD applied-answers q3 / q5: "an explicit typed `kind`
field (merge | stuck | triage | spec) in the identity comment — the kind is what
the apply rung reads to choose deterministic-action vs agentic-content
dispatch"). It was wrongly left to whichever task touched it first;
`merge-question-surfacer` was BLOCKED at review for working around its absence
(it overloaded the free-text `default` humility-aid field to carry the
`merge | hold | drop` menu and asked the apply layer to string-sniff it). Extract
the primitive HERE so the surfacer / apply-rung / gate-axis all build on a real
field.

Scope (deliberately minimal — it is interim):

- Add `kind?: 'merge' | 'stuck' | 'triage' | 'spec'` to `SidecarEntry` (and to
  `NewQuestion` so a surfacer can stamp it) in `sidecar.ts`. OPTIONAL — an entry
  with no `kind` is the existing binary content question (back-compat: every
  current sidecar parses unchanged).
- PARSE + SERIALISE it in the per-entry HTML identity comment (`<!-- qN fields:
  id=qN ... -->`), alongside the existing `id=` — NOT as visible prose (it is a
  machine field, not something the human reads/edits). A mistyped/unknown value
  reads as `undefined` (silent-on-malformed, mirroring the retired `disposition`
  parse and the `humanOnly` frontmatter discipline), never a throw, never a
  coerce.
- A round-trip test: `serialise(parse(x)) === x` for an entry carrying each kind
  and for an entry with no kind; an unknown `kind=` value parses to `undefined`.
- Do NOT add any dispatch LOGIC here (that is the apply-rung task's job) and do
  NOT touch the surfacers (the surfacer task stamps the field). This task only
  makes the field EXIST, parse, and serialise.

## Acceptance criteria

- [ ] `SidecarEntry.kind` + `NewQuestion.kind` exist as the optional union
      `'merge' | 'stuck' | 'triage' | 'spec'`; absent ⇒ today's binary content
      entry (no behaviour change for existing sidecars).
- [ ] The field round-trips through parse + serialise in the per-entry identity
      HTML comment; an unknown/mistyped `kind=` parses to `undefined` (no throw,
      no coerce), asserted by a test.
- [ ] Every existing sidecar test still passes (back-compat: no `kind` ⇒
      unchanged render + parse).
- [ ] No dispatch logic and no surfacer changes in this task (field-only).
- [ ] The field is documented as INTERIM (removable once kind-subfolders land) in
      the `sidecar.ts` docstring, cross-linking the questions-folder observation.
- [ ] Acceptance gate `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — a self-contained schema primitive; the three merge-question tasks depend
  on IT, not the reverse.

## Prompt

> Add an OPTIONAL typed `kind` field (`'merge' | 'stuck' | 'triage' | 'spec'`) to
> the question-sidecar ENTRY so the answered-question apply rung can recognise a
> runner-ACTION question deterministically, without sniffing the shape of the
> free-text `default` field (the workaround that got `merge-question-surfacer`
> blocked at review). Read `packages/dorfl/src/sidecar.ts` — the `SidecarEntry` /
> `NewQuestion` interfaces, the per-entry HTML identity comment
> (`<!-- qN fields: id=qN -->`) parse + serialise, and the retired-`disposition`
> silent-on-malformed precedent. Add `kind` as an OPTIONAL field carried in that
> HTML comment (a machine field, not visible prose); absent ⇒ the existing binary
> content entry, so every current sidecar parses + renders byte-identically. A
> mistyped/unknown `kind=` reads as `undefined` (never a throw, never a coerce),
> exactly like the retired `disposition` token. Add a round-trip test (each kind +
> no-kind + unknown-value→undefined). Do NOT add dispatch logic (apply-rung task)
> and do NOT touch the surfacers (surfacer task stamps it) — this task only makes
> the field exist/parse/serialise.
>
> IMPORTANT framing: this field is INTERIM. Once question sidecars move to
> KIND-BASED SUBFOLDERS (`questions/merge/` …), the folder encodes the kind and
> this field is redundant — see the observation
> `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21` + idea
> `folder-taxonomy-and-prd-edit-handshake`. Build it so the later cutover can
> DELETE it in one move: read in exactly one place (the apply dispatch, a later
> task), a single typed field, documented as interim in the docstring. Record any
> in-scope decision (e.g. the exact HTML-comment token spelling `kind=…`) per
> task-template. Verify with the AGENTS.md acceptance gate.

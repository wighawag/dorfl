---
title: advance — the question/answer SIDECAR contract (parse/serialise/atomic-apply), the genuinely-new keystone
slug: advance-sidecar-contract
spec: advance-loop
blockedBy: []
covers: [8, 9, 10, 11, 15]
---

## What to build

The one genuinely-new piece of the whole `advance` family: a strict, tooling-OWNED per-item **sidecar** file at `work/questions/<type>-<slug>.md` carrying per-entry answered-state, with a parser, a serialiser, append semantics, a derived `allAnswered`, and an ATOMIC apply (mutate the item body + the sidecar in ONE commit). Everything else in the family triggers off this; build it first, end-to-end, with the format fully nailed (the format is RESOLVED in the SPEC — do NOT re-open it).

This slice delivers the format + the in-memory model + the read/write/append/ apply operations + tests. It does NOT build the tick, the verb, the lock, or the rungs (later slices consume this).

### The format (RESOLVED in the SPEC — build to this; an ADR may finalise byte

detail but not the shape)

```
---
item: spec:autoslice          # the NAMESPACED identity (the resolver is the source of truth)
type: spec                    # spec | slice | observation  (redundant w/ filename; explicit for the parser)
slug: autoslice
allAnswered: false           # DERIVED mirror — recompute from entries on every write; never trusted over entries
---

## Q1
id: q1                       # stable, monotonic (q1, q2, …), NEVER reused
question: |
  <verbatim question>
context: |
  <inline context so the human need not open the item>
default: |                   # optional suggested default (the surface-questions humility aid)
  <suggested default, if any>
answered: false              # per-entry source of truth
answer: |                    # filled by the HUMAN; empty/absent while unanswered
disposition:                 # optional, triage/terminal entries: promote-slice | promote-adr | keep | delete | out-of-scope | needs-attention
```

### Decided rules (from the SPEC — non-negotiable)

- **The answered predicate (MAINTAINER-RESOLVED §1):** a **non-empty `answer:` ⇒ ANSWERED**, with an explicit `answered:` line as an OVERRIDE. The serialiser normalises `answered: true` on the next write; an explicit `answered: false` overrides a non-empty answer. (This closes the one byte-detail the source deferred — do NOT emit a `needsAnswers` for it.)
- **Entry ids are stable + monotonic** (`q1`, `q2`, …), never reused. APPEND adds `qN+1`; the agent keys "already asked/answered" off the id.
- **`allAnswered` is DERIVED** — recompute from the entries on every write; the classifier MAY read it for a cheap scan but MUST NOT trust it over the entries.
- **Identity-keyed, not folder-keyed** — the sidecar path is derived PURELY from the item's namespaced identity (`<type>-<slug>`, `:`→`-` for the filename), using the existing resolver (`slug-namespace.ts`) as the single source of truth for the identity. There is NO back-pointer field in the item body; the only in-body signal is `needsAnswers`.
- **Append, never overwrite** — appending an entry flips a previously-`allAnswered` sidecar back to not-all-answered (the sidecar is the item's full Q&A history).
- **`disposition` present only on triage/terminal-routing entries.**

### Operations to deliver

- `parseSidecar(text)` → typed model (frontmatter + ordered entries), tolerant of the human writing only `answer:`.
- `serialiseSidecar(model)` → canonical text (normalises `answered:`, recomputes `allAnswered`, stable id order).
- `appendQuestions(model, newEntries)` → new model with `qN+1…` ids, never touching existing answered entries.
- `allAnswered(model)` / `pendingEntries(model)` — derived from entries.
- `applyAtomic(...)` — the ONE-commit operation that mutates the item body AND updates/removes the sidecar (and, on full resolution, clears `needsAnswers` + DELETES the sidecar) in a single commit. (Atomic-apply is the keystone the state machine's invariant `needsAnswers:false ⟺ no sidecar` rests on.)
- `sidecarPathFor(identity)` — derive `work/questions/<type>-<slug>.md` from the resolver's namespaced identity.

## Acceptance criteria

- [ ] `work/questions/<type>-<slug>.md` parses/serialises round-trip stable (frontmatter + ordered entries; canonical output).
- [ ] A non-empty `answer:` is treated as ANSWERED; an explicit `answered: false` overrides; the serialiser normalises `answered: true` on the next write.
- [ ] Entry ids are stable + monotonic (`q1`, `q2`, …) and NEVER reused; append adds `qN+1` and never mutates an existing answered entry.
- [ ] `allAnswered` is recomputed from entries on every write and is correct for none/subset/all-answered.
- [ ] The sidecar path is derived purely from the item's namespaced identity via the existing resolver (`:`→`-`); no back-pointer is written into the item.
- [ ] `applyAtomic` mutates the item body + the sidecar in ONE commit; on full resolution it clears `needsAnswers` AND deletes the sidecar in that SAME commit (the `needsAnswers:false ⟺ no sidecar` invariant holds).
- [ ] Tests cover the new behaviour mirroring the repo's existing parse/serialise + throwaway-git-repo patterns (e.g. `frontmatter.ts`, `slicing-lock.ts` tests).
- [ ] Tests write only to their own temp git fixtures; no shared/global location is touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. This is the keystone the rest of the family triggers off.

## Prompt

> Build the question/answer SIDECAR contract — the one genuinely-new piece of the `advance` family. A per-item file `work/questions/<type>-<slug>.md` in a strict, tooling-OWNED format with per-entry answered-state, plus parse/serialise/append/ derived-allAnswered/atomic-apply operations and tests. Read the SPEC `work/spec/advance-loop.md` (it now resides in `work/spec-sliced/` or `work/slicing/` while being sliced) — specifically "The sidecar (the keystone — Option B)", "The sidecar FORMAT (RESOLVED here)", and "MAINTAINER-RESOLVED SLICE-TIME DECISIONS §1" (the answered predicate: non-empty `answer:` ⇒ answered, explicit `answered:` is the override). The format is RESOLVED — do NOT re-open it; an ADR may finalise byte detail, not the shape.
>
> Domain vocabulary: the sidecar is IDENTITY-keyed (`<type>-<slug>`, derived from the namespaced identity via the existing resolver `slug-namespace.ts` — `:`→`-` for the filename), NOT folder-keyed, so it survives the item's `git mv`s with no lock-step move. The ONLY in-body signal is the existing `needsAnswers` flag — there is NO back-pointer field. `allAnswered` is a DERIVED mirror (recompute from entries every write; never trusted over them). Append never overwrites (the sidecar is the full Q&A history); ids are stable + monotonic, never reused. Atomic-apply mutates the item body + sidecar in ONE commit and, on full resolution, clears `needsAnswers` + deletes the sidecar in that same commit (the invariant `needsAnswers:false ⟺ no active sidecar`).
>
> READ FIRST: `packages/dorfl/src/frontmatter.ts` (YAML frontmatter parse/serialise house pattern), `packages/dorfl/src/slug-namespace.ts` (`parseSlugArg`/`resolveSlug` — the namespaced-identity source of truth), and the existing slicing-lock / claim-cas tests for the throwaway-git-repo atomic-commit pattern.
>
> FIRST, check this slice against current reality (it is a launch snapshot — though freshly cut). The `spec/`→`slicing/`→`spec-sliced/` lifecycle and `slug-namespace.ts` resolver are LANDED substrate (see the SPEC's 2026-06-09 PRECURSOR-LANDED UPDATE). If a dependency landed differently than this slice assumes, route to `needs-attention/` with the discrepancy rather than building on a stale premise.
>
> TDD with vitest, house style (throwaway repo + temp dirs). "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

---

### Claiming this slice

```sh
dorfl claim advance-sidecar-contract --arbiter origin
git fetch origin && git switch -c work/advance-sidecar-contract origin/main
git mv work/in-progress/advance-sidecar-contract.md work/done/advance-sidecar-contract.md
```

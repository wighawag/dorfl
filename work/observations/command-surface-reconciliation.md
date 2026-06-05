---
title: Command-surface ADR drifts existing code + runner-in-ci/auto-slice PRDs — reconcile in 3 phases
type: observation
status: spotted
spotted: 2026-06-05
---

# The command-surface ADR deliberately drifts existing code, PRDs, and slices

> **Spotted while accepting `docs/adr/command-surface-and-journeys.md`.** That ADR
> reshapes the whole command model (registry via `remote *`, the `run` daemon vs
> `do` worker split, renames, in-place isolation, flag cleanup, adopt=skill/
> execute=command). By design this makes parts of the CURRENT code and two unsliced
> PRDs stale. Per WORK-CONTRACT.md "Drift is a needs-attention signal", capture it
> rather than let it silently propagate. This note is the phase-1 (reconcile-docs)
> + phase-3 (reconcile-code) checklist.

## The mandated 3-phase cadence (from the ADR)

1. **Reconcile-the-docs** (the ADR + CONTEXT rewrite are done; the PRD reshapes
   below are NOT yet) — make the spec coherent BEFORE building.
2. **Build the new system** — slices implementing the new surface. **The "Current
   CODE that drifts" list below IS the phase-2 build inventory** (it doubles as
   phase-3's drift checklist). Phase 2 = write a PRD from
   `docs/adr/command-surface-and-journeys.md` and slice it.
3. **Reconcile-the-code** — drift-check existing slices/code against the new code,
   then resume feature work.

**Sequencing constraint for phase 2 (important):** the backlog slices
`autoslice-command` and `autoslice-confidence` are reshaped to build against the
**`do`** command — which does NOT exist until phase 2 builds it. So they are
effectively blocked on the `do` slice; do NOT claim them before `do` lands.
`autoslice-gate` + `autoslice-lock` are unaffected (pure logic / the seam CAS) and
buildable independently. The `watch` backlog slice references the deleted `watch`
verb (folds into `run`) and must be reshaped/retired in phase 2 too.

## Current CODE that drifts (phase 3 — after build)

- `cli.ts`: add `remote add/rm/ls/find`; remove `arbiter init`/`arbiter status`;
  rename `return` → `requeue`; add `do`; reframe `run`/`run --once`; add `resume`
  verb; add `--agent` to `start`/`work-on`; remove `--by`; rename the readiness
  override to `--ignore-not-ready` only (drop `--force` spelling on
  claim/start/work-on); demote advanced flags in help.
- `arbiter.ts`: `arbiterInit` folds into `remote add --local`; `arbiterStatus`
  folds into `status`.
- isolation: introduce the **in-place vs job-worktree isolation strategy** seam
  that `do` selects on (in-place when it has a checkout; mirror+job-worktree for
  `do --remote`, sharing `run`'s isolation).
- config: remove the `roots` field (and never add a `remotes` field); the registry
  = the hub-mirror set. `remote find` reuses `isParticipatingRepo` (detect.ts).
- `do` absorbs `ar-run.sh` (the bash test-driver retires).

## PRDs that drift (phase 1 — reshape BEFORE slicing/building them)

- **`runner-in-ci`** (unsliced): currently assumes CI runs `run --once` against a
  registered remote. WRONG per the ADR — **CI = `do`** (one repo, in-place, exits;
  `install-ci` generates a workflow calling `do --propose`, optionally with a
  slug/PRD arg or `-n`). Reshape the PRD: CI tick = `do` (auto-slice eligible PRDs
  + build eligible slices, slices-first), not `run --once`. Keep the auth/secrets
  + `install-ci` scaffolding parts; swap the engine framing.
- **`auto-slice`** (already SLICED — its slices are in `work/backlog/`): the
  `slice <prd>` command it defines is now **subsumed by `do <prd>`** (slicing is
  "work to do" in the in-place worker) + the `run`/`do` auto-slice-eligible-PRDs
  step. Decide at phase 1: keep a standalone `slice <prd>` (thin, for explicit
  slicing) AND wire `do <prd>` / the tick to the same machinery, OR fold slicing
  entirely into `do <prd>`. Its already-emitted slices (`autoslice-gate/lock/
  command/confidence`) likely need re-scoping (e.g. "command" becomes "the `do
  <prd>` path"); re-run the drift check on them before they are claimed/built.

## Skills/docs that drift

- CONTEXT.md "The faces" — DONE (rewritten to the new model).
- `work/ideas/needs-attention-surfacing.md` and the `watch` backlog slice
  reference `watch`/`run --once`; `watch` is deleted (its meaning = `run`). The
  `watch` slice should be reshaped or retired (its loop behaviour folds into
  `run`); re-scope when phase 2 reaches it.
- Any doc listing the command set / "two faces".

## Why an observation, not a work item

It is actionable only as the phased reconciliation the ADR mandates — partly now
(phase-1 PRD reshapes), partly after the new surface is built (phase-3 code
drift-check). Captured so nothing is silently left stale. Delete this note once
all three phases are complete and the surface matches the ADR.

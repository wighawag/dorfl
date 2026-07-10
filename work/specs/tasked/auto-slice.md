---
title: auto-slice — slice a SPEC file into backlog items as a work/-native capability
slug: auto-slice
humanOnly: true
---

> **Sliced into `work/backlog/` on 2026-06-04** — detail trimmed to the slices. Launch snapshot, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/backlog/autoslice-{gate,lock,command,confidence}.md`. (`humanOnly: true` here meant only that a human drove THIS SPEC's slicing — disjoint from the slices' own gates; all four emitted slices are auto-eligible on their own build-merits.)
>
> **RESHAPED 2026-06-05** to `docs/adr/command-surface-and-journeys.md`: there is **no standalone `slice <spec>` command** — slicing a SPEC is **`do prd:<slug>`** (slicing is "work to do" in the in-place worker; `do` spans the build-a-slice and slice-a-SPEC namespaces, disambiguated by the `slice:`/`prd:` prefixes, ADR §3a). The GATE and LOCK (`autoslice-gate`, `autoslice-lock`) are unchanged — they are needed regardless of the entry verb. The `autoslice-command` slice is re-scoped from "the `slice <spec>` command" to "**the `do prd:<slug>` slicing path**"; CI drives it via `install-ci`-generated `do prd:<slug>` (explicit prefix, never bare). `run`/`do`'s tick auto-slices eligible PRDs (slices-first, per-repo toggle). Re-run the drift check on the slices before claiming them.

## Problem Statement

Turning a SPEC (`work/spec/<slug>.md`) into independently-grabbable `work/backlog/<slug>.md` slices is currently a **human-only, manual** step (run the `to-slices` skill by hand). I want this to be a **first-class dorfl capability** — a command that slices a SPEC into backlog items — so it can be run locally OR triggered in CI like any other dorfl operation. Auto-slicing is NOT a CI feature; it is a `work/`-native capability for which CI is just one caller. It must be **human-first by default** (an agent only auto-slices when the repo explicitly opts in and the SPEC does not forbid it), and it must be safe under concurrency (two CI runs, or a human and CI, must not both slice the same SPEC).

One of three decoupled capabilities (`runner-in-ci`, `auto-slice`, `issue-to-spec`). This one knows nothing about GitHub issues.

## Solution

The **`do prd:<slug>`** slicing path (NOT a standalone `slice` command — see the reshape banner; ADR `command-surface-and-journeys` §3/§3a) drives the slicing of a SPEC into `work/backlog/` items, with an autonomy gate mirroring the existing two-axis gate (`humanOnly` × `needsAnswers`) + the `allowAgents` precedent, and a claim-CAS lock so concurrent slicers never collide.

- **The command** delegates the actual slicing to the agent harness using the `to-slices` methodology (the slicer skill), then the runner — owning all git-state transitions, as everywhere — commits the produced slices + the SPEC transition. The agent only produces slice files; it does not commit/push/move.
- **Autonomy gate (the two axes, at the SPEC level):**
  - SPEC frontmatter **`humanOnly: true`** (DECIDED) — a human must drive the slicing of this SPEC (a judgement call). Omitted ⇒ undeclared. Set by `to-spec`.
  - SPEC frontmatter **`needsAnswers: true`** (DISCOVERED) — the SPEC has unresolved questions (in its body); the auto-slicer refuses to slice until answered.
  - Per-repo policy **`autoSlice`** — may an agent auto-slice undeclared PRDs in this repo? Default `false`; resolved like `allowAgents` and `integration` — and that chain now includes the ENV layer that has since landed (`config-env-layer`, in `done/`): **flag > `DORFL_*` env > per-repo `.dorfl.json` > global > default `false`** (so `autoSlice` gets env support for free, e.g. in CI).
  - Agent-sliceable iff `needsAnswers !== true && humanOnly !== true && autoSlice` (the same predicate the build gate uses, one level up). **Slicing is human-first by default.**
  - **`sliceAfter` (cross-SPEC order):** a SPEC's `sliceAfter: [other-spec]` lists PRDs that must already be SLICED (resolved against the `sliced:` marker, NOT `done/`) before the auto-slicer may slice it — so this SPEC's emitted slices can reference the real slugs of those PRDs' slices in `blockedBy`. Enforced for the agent; a human may override.
- **Concurrency lock via the existing claim CAS (status = folder):** the auto-slicer atomically races a `git mv work/spec/<slug>.md → work/slicing/<slug>.md` micro-commit to the arbiter (the same compare-and-swap the build-claim uses), on a **different branch name** so it never collides with build-work claims. NOTE (drift since launch): the claim CAS now lives BEHIND the **ledger-transition write seam** (`docs/adr/claim-ledger-vs-protected-main.md`; slices in `done/`). Reuse it THROUGH that seam's transition machinery (a new `slicing` transition kind, or the claim primitive the seam exposes) — do NOT call the raw `claim-cas` / push `main` directly, or you reintroduce the exact direct-`main` coupling the seam removed. The winner slices; on success it moves the SPEC back to `work/spec/<slug>.md` and drops the new slices into `work/backlog/` in the completing transition. A loser gets the claim's exit-2 and backs off. `work/slicing/` is the in-progress folder for the slicing operation (status = folder, consistent with the rest of the contract).
- **Human path needs no lock.** A human slicing locally with no agent running has no contention, so they may slice on `main` directly (lock optional for the human, mandatory for the agent) — exactly parallel to "the runner never skips verify; the human may." The lock exists to serialise _concurrent_ slicers.
- **Confidence behaviour (no human present):** when auto-slicing, if any of {granularity, dependency order, a gate, a seam} is genuinely unresolved, the slicer does NOT emit a guessed slice — it sets `needsAnswers` on the specific uncertain slice (questions in the body) or routes the whole SPEC to `needs-attention/` with the questions. Never a wrongly-cut slice.
- **Skill updates (done in this docs pass):** `to-spec` sets `humanOnly` / `needsAnswers` / `sliceAfter` from the conversation; `WORK-CONTRACT.md` documents the two-axis SPEC gate, the `autoSlice` repo policy, `sliceAfter`, and the `work/slicing/` lock folder.

## User Stories

1. As the maintainer, I want `dorfl do prd:<slug>` to turn a SPEC file into `work/backlog/` slices, so that slicing is a real capability (the `do` worker's SPEC branch), not a manual ritual.
2. As the maintainer, I want slicing to be human-first by default and only auto-run when I opt in per repo (`autoSlice`), so that I keep control over when agents decompose work.
3. As the maintainer, I want a SPEC markable `humanOnly: true` (judgement) or `needsAnswers: true` (open questions), so that such PRDs are never auto-sliced even where `autoSlice` is on — and so the reason an agent skipped it is honest.
4. As the maintainer, I want concurrent slicers (two CI runs, or human + CI) to be serialised by the existing claim CAS, so that a SPEC is never double-sliced.
5. As the maintainer, I want a human with no agent running to slice on `main` directly without a lock dance, so that the safe common case stays simple.
6. As the maintainer, I want the runner (not the agent) to own the slice commits and the SPEC folder transitions, so that the git boundary stays identical to the rest of the system.

> Implementation & testing detail moved to the slices (`autoslice-gate`, `autoslice-lock`, `autoslice-command`); the no-human confidence/needs-attention routing once planned as `autoslice-confidence` is SUPERSEDED by and folded into `slicer-review-edit-loop` (the review/edit loop owns both the confidence judgement and the verdict routing — see `work/spec/review.md` RESOLVED DESIGN). Durable rationale for the seam the lock rides on is in `docs/adr/claim-ledger-vs-protected-main.md`.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (this SPEC, DECIDED):** meant ONLY that a human drives the _slicing_ of this SPEC (an agent may not auto-slice it) — because auto-slice reshapes the autonomy model and warranted a human cutting it. This is **disjoint** from the emitted slices' gates (WORK-CONTRACT.md §3b): all four slices were judged on their OWN build-nature and are **auto-eligible** (pure predicates, a mechanical seam-CAS lock, well-specified orchestration, and confidence-routing — none needs a human to build).
- **`needsAnswers`:** none open — gate names, predicate, lock mechanism (now via the ledger seam), and `sliceAfter` semantics are decided.

## Out of Scope

- GitHub issue awareness (that is `issue-to-spec`; this command takes a SPEC slug).
- The CI trigger/workflow wiring (covered by `install-ci`; this slice ships the capability + lock, not the workflow).
- Rewriting `to-slices` itself — reuse the existing methodology; only add the two-axis gate + `sliceAfter` plumbing.

## Further Notes

- Builds on the existing claim CAS (`claim-cas.ts` / `scripts/claim.sh`) and the `humanOnly`/`allowAgents` precedent (CONTEXT.md, `docs/adr/methodology-and-skills.md` §4) — the new gate is a deliberate mirror of it.
- The `issue-to-spec` capability's loop-closure relies on slices carrying `prd:` (which `to-slices` already sets); auto-slice must preserve that link so a finished slice resolves back to its SPEC (and thence the issue).

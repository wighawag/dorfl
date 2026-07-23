---
title: 'autoMerge means TWO different things — the SPEC''s "auto-merge the --propose PR on approve" vs the code''s "let a --merge proceed (else downgrade to propose)" — a concept collision to think through later'
date: 2026-06-07
status: resolved
resolvedBy: remove-automerge-merge-means-auto-on-gate-pass
resolvedDate: 2026-06-15
---

> **RESOLVED 2026-06-15 (slice `remove-automerge-merge-means-auto-on-gate-pass`).** Closed in favour of **Model P**, realised by HARD-DELETING the `autoMerge` knob entirely (config field + `DEFAULT_CONFIG`, the per-repo key list, the `DORFL_AUTO_MERGE` env coercion, the `--auto-merge`/`--no-auto-merge` CLI flags, the `do`/`run`/`complete`/`integration-core` option fields, and the `merge`→`propose` downgrade logic at both `integration-core.ts` application sites). After this: `integration: merge` MEANS "land automatically when the gate passes" (green `verify`, plus a Gate-2 `approve` when `review` is on) and `integration: propose` MEANS "a human merges" (PR / PR-less checkpoint). The old `merge` + `autoMerge: false` "downgrade to propose" combination is gone — it was redundant with `propose`. There is no separate auto-merge sub-knob; auto-land is a property of the chosen integration mode. A stale `autoMerge` config key / env var is silently inert. The four user stories below resolve to: (1) `integration: merge` + `review: on`; (2) `integration: propose` + `review: on`; (3) review off + `merge` is unaffected (the downgrade never gated no-review merge, and now there is no downgrade at all); (4) `--merge` + `autoMerge` off is no longer expressible — `propose` is the canonical "a human merges" form. SPEC `work/spec-sliced/review.md` + ADR `docs/adr/ci-config-policy-and-gate-family.md` updated to Model P.

## The signal

While designing the run/do integrate-path convergence (the core owns the effective-integration-mode decision), the `autoMerge`-off → downgrade-`merge`-to- `propose` logic in `complete.ts` looked like it conflicts with the original intent. Checked it: it does. `autoMerge` is attached to TWO different mental models.

## The two models (both real, in two places)

### Model P — the SPEC (`work/spec/review.md`): autoMerge is a PROPOSE-mode policy

- Gate 2 (PR/code review) is framed as **"the FINAL ARBITER of the `--propose` PR"** (lines 49–52, 167–172). Review lives in the `--propose` journey: a PR is opened, review judges it.
- `autoMerge`-on-approve (lines 176–184, 204–207, 235–236): **"If (and only if) the repo opts in, an `approve` verdict AUTO-MERGES THE PR; otherwise the review is advisory/blocking and the PR is left for a human."**
- So in Model P: mode is `propose`; review approves; `autoMerge` on ⇒ the runner merges the opened PR; `autoMerge` off ⇒ leave the PR for a human. `autoMerge` is a knob WITHIN propose. `merge` mode isn't really in the picture (there's no PR to auto-approve in plain `merge`).

### Model M — the code (`src/complete.ts`): autoMerge gates MERGE mode

- The implemented logic: on a review **approve**, `if (mode === 'merge' && !autoMerge) { mode = 'propose'; }` — i.e. an approved **`merge`** proceeds autonomously ONLY if `autoMerge` is on; otherwise it is DOWNGRADED to `propose` so a human does the merge.
- So in Model M: `autoMerge` is a knob on **`merge`** (autonomous merge vs downgrade-to-propose). `--merge` with `autoMerge` OFF is the conflicting combination that surfaced this — it reads as "you asked to merge but also said don't auto-merge," resolved by silently becoming propose.

## Why it matters (the conflict)

- `--merge` + `autoMerge` off is a contradictory-looking pair under Model M; under Model P it wouldn't arise (autoMerge is a propose sub-policy, not a merge gate).
- The maintainer's recollection (the source of truth for intent) is **Model P**: "autoMerge was intended for propose mode — have the PR auto-approved/merged on approve." Model M may be a miscommunication that crept into the implementation.
- Either model is defensible, but having ONE flag mean both is the bug: it makes `--merge`/`autoMerge` combinations ambiguous and the user stories unclear.

## User stories to think through (before deciding)

Frame these explicitly later, then reconcile SPEC + code to ONE model:

1. Repo wants autonomous landing with a model review as the merge gate: which mode + flag? (Model P: `propose` + `autoMerge` on. Model M: `merge` + `autoMerge` on.)
2. Repo wants a model review that only ADVISES, human always merges: (Model P: `propose` + `autoMerge` off. Model M: `propose`, or `merge`-downgraded.)
3. Repo wants plain autonomous `merge` with NO review at all: review off, mode `merge` — does `autoMerge` even apply when review is off? (Today the downgrade is under `if (options.review)`, so no-review `merge` is unaffected — worth confirming that's intended.)
4. What does `--merge` + `autoMerge` off even MEAN as a user intent? If it's incoherent, the CLI should reject it or it shouldn't be expressible — rather than silently downgrading.

## Disposition — DO NOT fix now

- **Explicitly fenced OFF from the run/do integrate-path convergence** (the `integration-core.ts` extraction + routing `run` through it). The convergence preserves the CURRENT behaviour (Model M) verbatim — the core owns the effective-mode decision AS IT IS TODAY; it does NOT adopt a position on this collision. This finding is the separate, later reconciliation.
- Reconcile to ONE model (likely Model P per the maintainer's intent), update `work/spec/review.md` + `src/complete.ts` together, and either make the contradictory flag combination unrepresentable or reject it loudly. Its own SPEC/slice when prioritised.

(Captured 2026-06-07 during the convergence grilling pass; flagged by the maintainer as a probable miscommunication between the SPEC intent and the implemented logic.)

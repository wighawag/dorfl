---
title: rename reviewPr → review (flag --review, config key review, env DORFL_REVIEW) — the -pr suffix is a fossil; the gate is merge/propose-agnostic
slug: rename-reviewpr-to-review
spec: review
blockedBy: []
covers: []
---

## What to build

Rename the review-gate on/off toggle from **`reviewPr` → `review`** across the flag, config key, and env var. Pure rename + doc fix; NO behaviour change.

- **CLI flag:** `--review-pr` / `--no-review-pr` → **`--review` / `--no-review`** (on both `do` and `complete`).
- **Config key:** `reviewPr` → **`review`** (`config.ts` `Config` + `DEFAULT_CONFIG`, `repo-config.ts` `REPO_ALLOWED_KEYS`, `do-config.ts` `ReviewFlags`/`reviewFlagOverrides`, the `do.ts`/`complete.ts` option fields, `cli.ts` wiring).
- **Env var:** `DORFL_REVIEW_PR` → **`DORFL_REVIEW`** (`env-config.ts`).
- **Internal field** on `DoOptions`/`CompleteOptions` (`reviewPr?: boolean`) → `review?: boolean`.

### Why (rationale — record so it is not relitigated)

`--review-pr` is a FOSSIL of the pre-grilling-pass framing ("Gate 2 = PR/code review"). Two reasons the `-pr` suffix is wrong now:

1. **The gate is NOT about PRs.** It runs in `performComplete` after `verify`, on BOTH `--merge` and `--propose` paths. On a `--merge` run there is no PR at all, yet the gate still applies. So `-pr` implies a coupling that does not exist (the same "PR is GitHub jargon" smell that drove the earlier `pr`→`propose` rename in the integration seam ADR).
2. **There is no sibling toggle to disambiguate against.** The grilling pass resolved that the OTHER review concept (slice-generation) is the **slicer edit loop** — on-for-auto-slicing, NO toggle flag, its only knob is `maxReview`. So `--review-pr` never needed the `-pr` to contrast with a `--review-spec`. `--review` (bare) is unambiguous: "run the code-review gate on this `do`/`complete`."

### Scope / naming consistency

- The sibling keys **stay as-is**: `reviewModel`, `reviewMaxRounds`, `autoMerge`. After the rename the family reads cleanly: **`review`** (the toggle), `reviewModel`, `reviewMaxRounds`, `autoMerge`. (`reviewModel`/`reviewMaxRounds` are already correctly "review"-prefixed; only the toggle carried the bad `-pr`.)
- **Behaviour is IDENTICAL** — resolution chain (flag > env > per-repo > global > default off), the gate logic, autoMerge-downgrade, routing: all unchanged. This is a rename only.
- **No back-compat alias** (the flag/key is days old, unreleased — a clean rename, not a deprecation). If an alias is wanted, that is a separate decision; default is no alias (keep it simple).
- **Update the in-tree docs/specs** that name the old key so the contract stays honest: `work/spec/review.md`, `work/spec/runner-in-ci.md`, `work/backlog/{harness-agent-output,review-gate-pr-comment}.md`, `work/done/review-gate-pr.md`, `work/observations/reviewmaxrounds-on-wrong-concept.md`, `work/findings/run-and-do-have-separate-integrate-paths.md`. (The slug `review-gate-pr` and this slug keep their names — they are content-derived identifiers, not the flag; only the FLAG/KEY/ENV rename.)

## Acceptance criteria

- [ ] `--review` / `--no-review` work on `do` AND `complete`; `--review-pr` / `--no-review-pr` are GONE (no longer accepted).
- [ ] Config key is `review` (per-repo `.dorfl.json`, global config); env is `DORFL_REVIEW`; resolution precedence + default-off unchanged.
- [ ] No `reviewPr` identifier remains in `src/` (grep clean) — including the `DoOptions`/`CompleteOptions` field, `do-config.ts` flag mapping, and `repo-config.ts` allowed keys.
- [ ] Sibling keys `reviewModel`/`reviewMaxRounds`/`autoMerge` are untouched and still resolve as before.
- [ ] Behaviour is byte-for-byte identical (a renamed-flag run does exactly what the old flag did): the review gate runs after verify on both merge and propose; approve→integrate, block→needs-attention; autoMerge downgrade intact.
- [ ] Tests updated to the new names; the existing review-gate test coverage (`review-gate-pr.test.ts`, `review-gate.test.ts`) passes under the new flag (rename the references; keep the assertions). **Do NOT rename the test FILE `review-gate-pr.test.ts` — `review-gate.test.ts` ALREADY EXISTS (verified 2026-06-06); renaming would collide/overwrite it.** Leave both test filenames as-is; only rename the IDENTIFIERS inside them. (An earlier draft floated a file rename — it is a trap; this criterion supersedes it.)
- [ ] In-tree specs/docs naming the old key are updated (list above).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — a self-contained rename against the just-landed review-gate code (#11/#12, on `main`). `covers: []` / derives from the `review` SPEC's gate (so `prd: review` for story-context, though it adds no new story — it tidies an existing one). Independent of `propose-pr-body` / `review-gate-pr-comment` (do this FIRST so they reference the clean name).

## Prompt

> Rename the review-gate toggle `reviewPr` → `review` (flag `--review`/`--no-review`, config key `review`, env `DORFL_REVIEW`, and the internal `DoOptions`/`CompleteOptions` field). PURE rename + doc fix — ZERO behaviour change. The `-pr` suffix is a fossil: the gate runs after `verify` on BOTH `--merge` and `--propose` (no PR on merge), and the other review concept (slice generation) is the slicer EDIT LOOP with no toggle, so there is no `--review-spec` to disambiguate against.
>
> FIRST run the drift check: confirm the current names exist where expected — `cli.ts` (`--review-pr`/`--no-review-pr` on `do` AND `complete`), `config.ts` (`Config.reviewPr` + `DEFAULT_CONFIG`), `repo-config.ts` (`REPO_ALLOWED_KEYS`), `do-config.ts` (`ReviewFlags`/`reviewFlagOverrides`), `env-config.ts` (`reviewPr: 'boolean'`, env `DORFL_REVIEW_PR`), `do.ts`/`complete.ts` (`reviewPr?` option + the `reviewPr` gate-on check), `review-gate.ts` (any reference). ~100 token occurrences across the 8 src + 2 test files (verified 2026-06-06; the count is illustrative — the bar is "grep finds no `reviewPr`"). Route to needs-attention if the shape differs.
>
> Rename ALL of them to `review` / `--review` / `DORFL_REVIEW`. Leave `reviewModel`, `reviewMaxRounds`, `autoMerge` UNTOUCHED (they are correctly named). No back-compat alias (unreleased). Keep resolution precedence + default-off + all gate behaviour identical. Update the in-tree specs/docs that name the old key (`work/spec/review.md`, `work/spec/runner-in-ci.md`, `work/backlog/{harness-agent-output,review-gate-pr-comment}.md`, `work/done/review-gate-pr.md`, `work/observations/reviewmaxrounds-on-wrong-concept.md`, `work/findings/run-and-do-have-separate-integrate-paths.md`). Do NOT rename the SLUGS `review-gate-pr` / `rename-reviewpr-to-review` (content-derived ids, not the flag).
>
> READ FIRST: `src/cli.ts` (the two command definitions), `src/config.ts`, `src/repo-config.ts`, `src/do-config.ts`, `src/env-config.ts`, `src/do.ts`, `src/complete.ts`, `src/review-gate.ts`; the tests `test/review-gate-pr.test.ts` + `test/review-gate.test.ts`.
>
> TDD/grep discipline: after the rename, `grep -rn reviewPr packages/dorfl/src` is EMPTY; the existing review-gate tests pass under `--review` (rename refs, keep assertions); a renamed-flag run behaves exactly as the old one. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim rename-reviewpr-to-review --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/rename-reviewpr-to-review <remote>/main
git mv work/in-progress/rename-reviewpr-to-review.md work/done/rename-reviewpr-to-review.md
```

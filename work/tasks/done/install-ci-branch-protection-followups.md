---
title: 'install-ci branch-protection follow-ups (default-branch auto-detect + real deadlock guard)'
status: open
sourceObservation: review-nits-install-ci-tier1-branch-protection-2026-06-26
relates: install-ci-tier1-branch-protection (done, commit 38368f6b)
---

## Context

Gate-2 approved `install-ci-tier1-branch-protection` (done at 38368f6b) with three non-blocking nits. On triage:

- Nit (a) — the six in-scope choices shipped without a `Decisions` block (scope detection via `permissions.admin`; branch-protection PUT vs ruleset POST; deadlock-guard as natural-trigger + log line; undefined admin ⇒ non-admin; verify capability auto-emitted on every install-ci; step 5b unconditional) — is **RATIFIED as-is**. The choices are reasonable and durably named in source comments (`install-ci-branch-protection.ts` module header + `install-ci.ts` step 5b). No code change; no ADR needed. This task does NOT touch (a).

- Nits (b) and (c) are the two real follow-ups below. They both live in the same module (`install-ci-branch-protection.ts`) and the GitHub adapter (`install-ci-github.ts`), which is why they are bundled into one task.

The source observation should be deleted once this task is done.

## Nit (b) — auto-detect the default branch

**Problem.** `DEFAULT_PROTECTED_BRANCH` is hardcoded to `'main'` in `install-ci-branch-protection.ts`, and `install-ci.ts` step 5b calls `installCIBranchProtectionStep({ ctx, fake, log })` with no branch override. On any repo whose default branch is `master` (or anything non-`main`), install-ci will PUT branch protection on a non-existent/wrong branch (or 404), AND the printed `gh api` fallback that the user is told to copy-paste also targets `main`. This is real breakage today, not a theoretical concern.

**Do.**
1. In the GitHub adapter (`install-ci-github.ts`), add a default-branch lookup using `gh repo view --json defaultBranchRef` (parse `defaultBranchRef.name`). Return it from the adapter alongside the existing admin-scope info, or via a small new adapter method — whichever fits the existing shape best.
2. Thread the detected branch into `installCIBranchProtectionStep` so the PUT call and the printed `gh api` fallback both target the real default branch.
3. Fall back to `main` only if the lookup fails or returns empty; log the fallback so it is visible in the user log.
4. Fake/test path: make the fake adapter return a configurable default branch so tests can cover both the `main` and `master` cases; add a test that asserts the PUT URL and the printed fallback both use the detected branch.

## Nit (c) — make the deadlock guard mechanism-shaped, not documentation-shaped

**Problem.** The current deadlock guard is a NOTE log line plus reliance on the user committing/pushing `verify.yml` to the default branch before opening the next PR. The brief for the original task explicitly asked to *'either run the check once before requiring it, or use `do_not_enforce_on_create` — pick one and justify.'* The agent picked neither runtime mechanism. Because `writeArtifacts` writes locally and does not push, and step 5b runs synchronously right after, there is a real window where protection is set but `verify.yml` has not yet reached the default branch — any in-flight PR (or a user who forgets to push) hits a deadlock: the required check will never report.

**Do.** Pick ONE of the two runtime mechanisms from the original brief and implement it. Options in order of preference:

1. **Rulesets with `enforcement: 'active'` + `conditions.ref_name` and `bypass_actors` / `do_not_enforce_on_create`-style behaviour.** This is the modern GitHub-native way to say 'require this check, but do not fail PRs that predate the rule / were opened before the check first ran'. Justify in the module header (and in this task's completion note) why ruleset vs classic-branch-protection was chosen for the guard even though the base protection is still PUT via the classic endpoint (nit-a decision preserved).
2. **Pre-run the check once before requiring it.** After writing `verify.yml`, dispatch `verify.yml` on the default branch (e.g. via `gh workflow run`) and wait for at least one completed run to exist, THEN PUT the required-status-check protection. This is more code and requires the workflow to already be on the default branch, so option (1) is usually cleaner.

Whichever is picked, record the choice + rationale in a proper `Decisions:` block in the commit message (do not repeat the nit-a mistake for this new work), and keep the module-header note in sync.

## Out of scope

- Anything touching (a). The six ratified choices stay as-is.
- Reworking the classic-branch-protection PUT into a full ruleset migration for the *base* protection — only the deadlock-guard aspect needs the ruleset mechanism (or the pre-run).
- Changing the `verify` capability's auto-registration behaviour.

## Done when

- `gh repo view --json defaultBranchRef` (or equivalent) is called by the GitHub adapter and its result flows into both the API PUT and the printed `gh api` fallback string, with a `main` fallback on lookup failure.
- A test covers a `master`-defaulted repo and asserts neither the PUT nor the fallback string contain a hardcoded `main`.
- The deadlock guard is a real runtime mechanism (ruleset toggle OR pre-run), not just a log line; the module-header comment is updated to describe the mechanism, and the commit message carries a `Decisions:` block naming the chosen mechanism and why.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The source observation `review-nits-install-ci-tier1-branch-protection-2026-06-26` is deleted as part of finishing this task (nit (a) is ratified in the task context above; nits (b) and (c) are addressed by the task itself).

## Prompt

> Build the task 'install-ci-branch-protection-followups', described above.

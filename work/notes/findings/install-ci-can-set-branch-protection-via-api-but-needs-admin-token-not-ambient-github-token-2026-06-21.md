# `install-ci` CAN set Tier-1 branch protection (required check + strict/up-to-date) via API, but it needs an ADMIN-scoped token, not the ambient `GITHUB_TOKEN`

2026-06-21

Verified against GitHub REST docs + the fine-grained-PAT permission reference (web-fetched 2026-06-21). Relevant to the `land-time-reverify-and-parallel-merge-ceiling` brief, OPEN QUESTION 4 (is the GitHub ceiling auto-configured or a manual step?).

## The three Tier-1 pieces are all API-settable

1. **Required `verify` check + "require branches up to date".** `PUT /repos/{owner}/{repo}/branches/{branch}/protection` with
   `required_status_checks: { strict: true, checks: [{ context: "verify" }] }`.
   `strict: true` IS verbatim "Require branches to be up to date before merging" (confirmed in the docs body). One `gh api` call. Modern alternative: `POST /repos/{owner}/{repo}/rulesets` with a `required_status_checks` rule + `strict_required_status_checks_policy: true`.
2. **Tier-2 merge queue is ALSO API-creatable.** Rulesets expose a `merge_queue` rule type (`POST /repos/{owner}/{repo}/rulesets`), with grouping strategy / merge method / sizes — so the merge-queue ceiling is provisionable the same way, not UI-only.
3. **Check-name match is owned by install-ci.** `required_status_checks.checks[].context` must equal the workflow's job/check name. Since `install-ci` emits BOTH the advance-loop workflow AND sets the protection, it controls both strings and guarantees they match (avoids the hand-typed-context foot-gun).

## The caveat: it needs ADMIN write, NOT the ambient `GITHUB_TOKEN` (same wall as `Allow Actions to create PRs`)

- The permission reference lists `PUT .../branches/{branch}/protection` and `POST .../rulesets` under repository **"Administration" -> write**.
- The default workflow `GITHUB_TOKEN` is NEVER treated as admin, even when the triggering actor IS an admin (confirmed by two StackOverflow Q&As: "No - in case you need different permissions, you should use PAT instead"; "even with write permissions, the workflow isn't considered to have admin permissions").
- So this is the SAME CLASS of obstacle as the `Allow GitHub Actions to create and approve pull requests` toggle the user had to enable by hand — elevated credential required — EXCEPT:
  - `Allow Actions to create PRs` is a UI/policy toggle with NO API: ALWAYS manual.
  - branch protection / required check / merge queue ARE API-settable: automatable WHEN install-ci runs with an admin-scoped PAT or GitHub App token (`Administration: write`), e.g. a human admin's `gh` auth at local setup time, or the `runner-in-ci` wizard's provisioned token. With only a vanilla CI `GITHUB_TOKEN` it CANNOT, and must fall back to instructions.

## Chicken-and-egg to handle

A required status check that has NEVER reported can block all merges (GitHub treats an unreported required check as pending). So install-ci must ORDER it: land the workflow, let it run once on a PR, THEN require it — or use a ruleset with `do_not_enforce_on_create`. This sequencing favours install-ci owning the step over loose instructions.

## Recommended resolution for the brief's OPEN QUESTION 4

Two-mode, mirroring how the runner already degrades (authed provider vs push-only):

- **Admin credential present** (human admin's `gh` at setup, or a configured PAT / GitHub App with `Administration: write`): install-ci AUTO-CONFIGURES Tier 1 (one `gh api` branch-protection / ruleset call), guaranteeing the context name matches the emitted workflow, ordered so the never-run-check does not deadlock merges.
- **Only the ambient `GITHUB_TOKEN`**: install-ci CANNOT set protection — it PRINTS the exact ready-to-run `gh api` command + the human-step instructions (the `Allow Actions to create PRs`-style manual fallback). The `runner-in-ci` auth/secrets wizard is the natural home, since it already provisions elevated tokens.

Net: better than the always-manual `Allow Actions to create PRs` (this CAN be automated with the right token), but it shares the "needs elevated permission" property — so frame it as "auto when admin-scoped, documented manual fallback otherwise," never "free from a plain workflow token."

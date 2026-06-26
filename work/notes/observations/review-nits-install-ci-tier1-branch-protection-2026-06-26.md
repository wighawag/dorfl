---
title: review-gate non-blocking nits for 'install-ci-tier1-branch-protection' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: install-ci-tier1-branch-protection
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-tier1-branch-protection' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the agent shipped NO 'Decisions' block in the PR/commit message. Several in-scope choices were made and recorded only in source comments — please ratify each: (a) scope detection via 'permissions.admin' from GET /repos (vs token-metadata headers); (b) branch-protection PUT endpoint (vs ruleset POST); (c) deadlock-guard chosen as 'natural pull_request trigger + remediation log line' rather than a pre-run of the check or ruleset do_not_enforce_on_create; (d) undefined admin verdict treated as non-admin; (e) verify capability self-registers and is therefore emitted on EVERY install-ci run (not opt-in via the wizard); (f) the branch-protection step is wired unconditionally into installCI's step 5b and always logs, even on providers without the seam.
  (git log -1 41206447 shows only the bare title; no 'Decisions' block. Choices live in install-ci-branch-protection.ts module header + install-ci.ts step 5b.)
- DEFAULT_PROTECTED_BRANCH is hardcoded to 'main' and installCI never passes a branch override — a repo whose default branch is 'master' (or anything else) will have install-ci PUT protection on a non-existent/wrong branch (or 404), AND the printed 'gh api' fallback also targets 'main'. The GitHub adapter could detect the real default branch via 'gh repo view --json defaultBranchRef'. Worth either auto-detecting or surfacing the assumption in the user log.
  (install-ci-branch-protection.ts: DEFAULT_PROTECTED_BRANCH='main'; install-ci.ts step 5b calls installCIBranchProtectionStep({ctx,fake,log}) with no branch. No default-branch lookup in install-ci-github.ts.)
- Deadlock guard is documentation-shaped, not mechanism-shaped: the API call sets protection at install time, BEFORE the human pushes verify.yml to the default branch. The brief asked to 'either run the check once before requiring it, or use do_not_enforce_on_create — pick one and justify.' The agent picked neither runtime mechanism; it relies on the user committing verify.yml before opening the next PR, plus a NOTE log line. The trade-off IS recorded in source, but in-flight PRs and the 'set protection then forget to push verify.yml' window can still deadlock. Ratify the choice or ask for the ruleset toggle.
  (install-ci-branch-protection.ts module header §DEADLOCK GUARD; install-ci.ts step 5b runs synchronously after writeArtifacts (which writes locally, does not push).)

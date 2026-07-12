---
title: The tree-less publish misreads a GH006 protected-branch rejection as fast-forward contention and burns the whole retry ceiling; the live `main` drifted from install-ci's designed protection shape (required `verify` in classic per-push gate, not the ruleset)
type: observation
status: spotted
spotted: 2026-07-12
needsAnswers: false
triaged: keep
---

## What was seen

A CI `advance-lifecycle` run (https://github.com/wighawag/dorfl/actions/runs/29189533059) had 3 of 4 concurrent legs fail their tree-less publish with:

```
>> advance: could not publish the tree-less result to origin/main (remote: error: GH006: Protected branch update failed for refs/heads/main.
remote:
remote: - Required status check "verify" is expected.
 ! [remote rejected]   HEAD -> main (protected branch hook declined)
error: failed to push some refs to 'https://github.com/wighawag/dorfl'); the work is saved in the working clone and will re-apply on the next pass.
```

The tree-less rungs (`surface` / `apply` / `triage-observation`) publish by a DIRECT `git push HEAD:main` of a freshly-made commit (`pushTreelessResult`, `src/advance-treeless-publish.ts`). This is by design per the SPEC `ci-advance-surfaces-questions-not-only-builds` ("tree-less ledger writes go straight to `main` in BOTH modes"). That design assumed `main` did NOT hard-gate every direct push.

## The two distinct defects

1. **Classifier bug: a PERMANENT rejection is mis-read as a fast-forward RACE.** `pushTreelessResult`'s contention test was `/non-fast-forward|rejected|fetch first|stale info/i`. The GH006 stderr contains `! [remote rejected] ... (protected branch hook declined)`, so `rejected` matched, `contended` went `true`, and the loop did fetch + rebase + re-push against the SAME unwinnable required-check rule for all `retries: 1000` iterations before finally emitting "could not publish". A rebase can NEVER cure a required-status-check gate on a fresh direct-push commit (the commit still has no green `verify`), so every retry was a pointless network round-trip. The user's expectation ("we had a retry with random delay?") was right that jitter/retry EXISTS; it just fired uselessly because the failure is terminal, not transient.

2. **Config drift: the live `main` protection is NOT the shape install-ci was designed to install.** `install-ci-branch-protection.ts`'s module header is explicit: the classic PUT should carry an EMPTY `checks` array (only `strict: true` = "require branches up to date"), and the required `verify` check should live ONLY in a RULESET with `do_not_enforce_on_create: true`, so a direct/pre-existing ref is not blocked. But the LIVE repo (checked 2026-07-12 via `gh api repos/wighawag/dorfl/branches/main/protection`) has `required_status_checks.contexts: ["verify"]` + `checks: [{context: verify}]` in the CLASSIC protection, and NO ruleset exists (`gh api .../rulesets` returned empty). So `main` hard-requires `verify` on EVERY push with no create-exemption, which rejects every direct tree-less push. `enforce_admins` is `false`, but the CI bot token is not admin-bypassing here, so it hits GH006.

## Why it matters

The tree-less publish path is the mechanism that makes the "human is the clock" answer-loop real in CI: surfaced sidecars / triage markers / applied answers must LAND on `main`. With `main` hard-gating every direct push, 3/4 legs per tick silently lose their work to the retry storm and the loop does not drain. And the retry storm itself wastes ~1000 round-trips per failing leg before giving up.

## Fix applied inline (this session)

- **Classifier (`src/advance-treeless-publish.ts`).** Added `PERMANENT_PUSH_REJECTION = /GH006|protected branch|hook declined|required status check|cannot force-update the branch/i`, checked BEFORE `contended`. A permanent rejection now stops at the FIRST push attempt with a distinct, honest note that names the protected-branch/required-check cause and points at the fix (put the required check in a ruleset with `do_not_enforce_on_create`, not the classic per-push gate). Regression test in `test/advance-in-place-publishes-treeless-results.test.ts` installs a bare-arbiter `pre-receive` hook emitting the live GH006 stderr and asserts EXACTLY one push attempt (no retry storm) + the protection-specific note; a second test pins the regex against the live GH006 stderr and confirms it does NOT match a plain `non-fast-forward`.

- **Live protection reconcile (human runs the `gh api` calls; see Provenance).** Set the classic protection's `required_status_checks.checks` to EMPTY (keep `strict: true`), and create the deadlock-guard ruleset carrying the required `verify` check with `do_not_enforce_on_create: true` — i.e. bring the live `main` to the shape `install-ci-branch-protection.ts` was designed to install.

## Residue for a human (NOT decided inline)

- **Does install-ci need to be RE-RUN, or is this a one-repo manual drift?** The live `main` predates the ruleset-based design (or was set via UI / an older install-ci). Worth checking whether `install-ci` on an already-protected repo IDEMPOTENTLY reconciles the classic `checks` to empty + adds the ruleset, or whether it only ADDS and thus leaves a pre-existing per-push `contexts` gate in place (which would re-introduce this exact failure on any repo that was protected the old way). If the latter, that is a real install-ci slice: "reconcile, don't only add".

- **Should the tree-less push have a SECOND landing path when `main` is legitimately gated?** The classifier fix makes the failure honest + fast, but the work still does not LAND: it stays local for the next pass. If an operator genuinely wants `main` gated on every direct push, the answer-loop needs an alternative (e.g. a bot admin-bypass token, or a tiny auto-PR-per-sidecar path in that config) rather than silently never draining. The SPEC explicitly rejected per-sidecar PRs, so this is a real design fork to weigh, not an obvious fix.

## Provenance / refs

- Failing run: https://github.com/wighawag/dorfl/actions/runs/29189533059 (3/4 concurrent legs).
- `src/advance-treeless-publish.ts` (`pushTreelessResult`, the classifier; the module header describing the direct `HEAD:main` push + the C2 rebase-until-real retry).
- `src/install-ci-branch-protection.ts` (module header: classic PUT with EMPTY `checks`; required check in a RULESET with `do_not_enforce_on_create: true`; `VERIFY_CHECK_CONTEXT = 'verify'`).
- SPEC `work/specs/tasked/ci-advance-surfaces-questions-not-only-builds.md` ("tree-less ledger writes go straight to `main` in both modes"; per-sidecar PRs explicitly out of scope).
- Live protection state 2026-07-12: `gh api repos/wighawag/dorfl/branches/main/protection` shows classic `contexts:["verify"]`; `gh api repos/wighawag/dorfl/rulesets` empty.

## Note on scope

The classifier fix is uncontested and wanted regardless (a terminal rejection must not spin the liveness ceilinig). The protection reconcile is an operational config change on this one repo. The two residue questions (install-ci reconcile-vs-add idempotency; a second landing path for a legitimately-gated `main`) are the real design residue captured for a human.

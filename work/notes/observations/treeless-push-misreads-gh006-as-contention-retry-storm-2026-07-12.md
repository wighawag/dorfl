---
title: 'The tree-less publish misreads a GH006 protected-branch rejection as fast-forward contention and burns the whole retry ceiling; the live `main` drifted from install-ci''s designed protection shape (required `verify` in classic per-push gate, not the ruleset)'
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

2. **Config drift: the live `main` protection is NOT the shape install-ci was designed to install.** `install-ci-branch-protection.ts`'s module header is explicit: the classic PUT should carry an EMPTY `checks` array (only `strict: true` = "require branches up to date"), and the required `verify` check should live ONLY in a RULESET with `do_not_enforce_on_create: true`, so a direct/pre-existing ref is not blocked. But the LIVE repo (checked 2026-07-12 via `gh api repos/wighawag/dorfl/branches/main/protection`) had `required_status_checks.contexts: ["verify"]` + `checks: [{context: verify}]` in the CLASSIC protection, and NO ruleset existed (`gh api .../rulesets` returned empty). So `main` hard-required `verify` on EVERY push with no create-exemption, which rejected every direct tree-less push. `enforce_admins` is `false`, but the CI bot token is not admin-bypassing here, so it hit GH006.

3. **The DESIGNED shape does NOT actually unblock the loop either (discovered while reconciling).** Reconciling to the install-ci-designed shape (empty classic `checks` + a ruleset carrying `verify` with `do_not_enforce_on_create: true`) STILL blocks the tree-less push, now with `GH013 ... Required status check "verify" is expected`. Root cause: **`do_not_enforce_on_create` exempts branch CREATION only, not UPDATES.** The tree-less loop UPDATES `main` every tick, so an active ruleset re-gates exactly the direct push. Empirically, the `dorfl[bot]` tree-less commits landed only in the ~7-minute window AFTER the classic `checks` were emptied but BEFORE the ruleset was created; once the ruleset was active, even a repo-ADMIN direct push (`wighawag`) was rejected, because rulesets require explicit `bypass_actors` and the list was empty (`enforce_admins: false` on the classic layer is irrelevant to a ruleset). So the install-ci-designed ruleset shape BREAKS the loop rather than unblocking it.

## Why it matters

The tree-less publish path is the mechanism that makes the "human is the clock" answer-loop real in CI: surfaced sidecars / triage markers / applied answers must LAND on `main`. With `main` hard-gating every direct push, 3/4 legs per tick silently lose their work to the retry storm and the loop does not drain. And the retry storm itself wastes ~1000 round-trips per failing leg before giving up.

## Fix applied inline (this session)

- **Classifier (`src/advance-treeless-publish.ts`).** Added `PERMANENT_PUSH_REJECTION = /GH006|protected branch|hook declined|required status check|cannot force-update the branch/i`, checked BEFORE `contended`. A permanent rejection now stops at the FIRST push attempt with a distinct, honest note that names the protected-branch/required-check cause and points at the fix (put the required check in a ruleset with `do_not_enforce_on_create`, not the classic per-push gate). Regression test in `test/advance-in-place-publishes-treeless-results.test.ts` installs a bare-arbiter `pre-receive` hook emitting the live GH006 stderr and asserts EXACTLY one push attempt (no retry storm) + the protection-specific note; a second test pins the regex against the live GH006 stderr and confirms it does NOT match a plain `non-fast-forward`.

- **Live protection reconcile (done this session).** FIRST tried the install-ci-designed shape (empty classic `checks` + `verify` ruleset with `do_not_enforce_on_create`), which re-blocked the loop with GH013 (defect 3 above). SETTLED on the no-ruleset shape for now: classic `required_status_checks.checks` EMPTY, `strict: true` kept, force-push + deletion still blocked, and the `dorfl-verify-required` ruleset DELETED. This lets the tree-less loop (and admins) push direct; the trade-off is that `main` no longer requires `verify` on PR merges either. Adopted Option B (below) deliberately because Option A (bypass actors) is an unbuilt install-time feature.

## Residue for a human (NOT decided inline)

- **BIGGEST residue — `install-ci-branch-protection.ts`'s designed shape is WRONG for the loop and should be fixed (a slice).** The module provisions a `verify` ruleset with `do_not_enforce_on_create: true` believing it exempts the tree-less direct push. It does not (defect 3: creation-only exemption; the loop UPDATES `main`). So install-ci, as built, would BREAK the answer-loop on any admin-scoped GitHub repo the moment it provisions that ruleset. The genuinely-correct shape must add `bypass_actors` to the ruleset for the loop's OWN bot identity (and optionally repo admins). But that identity is only knowable at install time and varies by auth method: a GitHub App -> `{actor_type: "Integration", actor_id: <app id>}`; a machine-user PAT -> the user actor; the ambient `GITHUB_TOKEN` -> NO stable actor (ephemeral per run, cannot be a bypass actor at all). So the fix is a real feature, not a static body: a new GitHub-adapter seam (`getAuthenticatedActor()` -> `{actor_type, actor_id}`), a `bypass_actors` parameter on `buildBranchProtectionRuleset`, and a decision for the `GITHUB_TOKEN`-only case (probably: do NOT provision the ruleset, since it would only lock the loop out). Until this lands, install-ci should provision the NO-RULESET shape (empty classic `checks`, `strict: true`) so the loop is never self-blocked.

- **Should the tree-less push have a SECOND landing path when `main` is legitimately gated (Option C)?** The classifier fix makes the failure honest + fast, but the work still does not LAND: it stays local for the next pass. If an operator genuinely wants `main` gated on every direct push, the answer-loop needs an alternative (a bot admin-bypass token, or a tiny auto-PR-per-sidecar path in that config) rather than silently never draining. The SPEC explicitly rejected per-sidecar PRs, so this is a real design fork to weigh, not an obvious fix. This is distinct from the bypass-actor slice above: bypass actors keep the direct-push model (just exempt the trusted bot); Option C changes the landing model.

### The three end-states weighed this session

- **Option A — ruleset + `bypass_actors` for the bot (+ admins).** Faithful to "gate `main`, but let the trusted loop write the ledger"; keeps `verify` mandatory for ordinary contributor PRs. REQUIRES the install-time bot-identity feature above; cannot be done as a static reconcile. Recommended END state once that feature exists.
- **Option B — no ruleset, classic `strict: true` only. ADOPTED NOW.** Unblocks the loop + admins immediately; `main` keeps force-push/deletion protection + "be up to date", but loses the `verify` requirement on PR merges. The pragmatic interim.
- **Option C — keep `main` hard-gated, give the loop a non-direct landing path.** Strongest protection; largest engineering (see the second residue bullet). Deferred.

## Provenance / refs

- Failing run: https://github.com/wighawag/dorfl/actions/runs/29189533059 (3/4 concurrent legs).
- `src/advance-treeless-publish.ts` (`pushTreelessResult`, the classifier; the module header describing the direct `HEAD:main` push + the C2 rebase-until-real retry).
- `src/install-ci-branch-protection.ts` (module header: classic PUT with EMPTY `checks`; required check in a RULESET with `do_not_enforce_on_create: true`; `VERIFY_CHECK_CONTEXT = 'verify'`).
- SPEC `work/specs/tasked/ci-advance-surfaces-questions-not-only-builds.md` ("tree-less ledger writes go straight to `main` in both modes"; per-sidecar PRs explicitly out of scope).
- Live protection state 2026-07-12: BEFORE reconcile, classic `contexts:["verify"]`, no ruleset; AFTER reconcile (this session), classic `checks:[]` + `strict:true`, no ruleset (Option B). The GH013 finding: `do_not_enforce_on_create` is create-only, rulesets need explicit `bypass_actors` (verified live — an admin push was rejected with an empty bypass list).

## Note on scope

The classifier fix is uncontested and wanted regardless (a terminal rejection must not spin the liveness ceilinig). The protection reconcile is an operational config change on this one repo. The two residue questions (install-ci reconcile-vs-add idempotency; a second landing path for a legitimately-gated `main`) are the real design residue captured for a human.

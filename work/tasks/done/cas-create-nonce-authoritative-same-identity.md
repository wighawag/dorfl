---
title: cas-create-nonce-authoritative-same-identity — make the ledger-write CAS authoritative for SAME-IDENTITY, SAME-CONTENT racers by stamping each `applyTransition` attempt with a per-attempt random nonce (so two concurrent racers can NEVER build the same commit sha), and harden the post-push verify so an "up-to-date / no change of our making" outcome is classified REJECTED, not published — at the shared write seam, so create / claim / slicing-lock / advancing-lock / needs-attention all benefit
slug: cas-create-nonce-authoritative-same-identity
blockedBy: []
covers: []
---

> Self-contained PRODUCT-FIX slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): the residual "2 winners" CAS-race flake that SURVIVED `triage-cas-race-test-models-real-contention` (PR #90, in `work/done/`).
>
> This SUPERSEDES/EXTENDS `triage-cas-race-test-models-real-contention` (#90) AT THE PRODUCT LAYER. #90 hardened the TEST (distinct racer identities ⇒ distinct shas); this slice fixes the PRODUCT so the CAS is correct even when racers are NOT distinct. Do NOT weaken the one-winner invariant. Do NOT remove `racerEnv`/`raceClone` (keep them; reframe their docstring).

## The defect (verify against current code before fixing)

The same-slug CAS-race "2 winners" flake survived its own fix. #90 made the racing tests use DISTINCT committer identities (`racerEnv`/`raceClone` in `packages/dorfl/test/helpers/gitRepo.ts`) so the two racers' commits get distinct shas and the loser loses through the real CAS. That fixed the TEST but not the PRODUCT: it rests on the assumption — stated verbatim in the `racerEnv` docstring (`gitRepo.ts` ~L46-53) — that "in PRODUCTION two racers are distinct principals on distinct machines, so their commits carry distinct identities/timestamps ⇒ distinct shas." **That assumption is FALSE in real scenarios:**

- One runner (`run --advance` / drive-backlog) advancing two same-slug items, or two workers under ONE bot identity, produces SAME-identity concurrent racers; and
- git commit timestamps have 1-second resolution, so **same identity + same tree + same message + same base within one second ⇒ IDENTICAL sha in production too.**

So the create-CAS can yield two winners with same-identity racers, and #90 only HID it (it removed the fixture's sha-collision, not the product's exposure to one).

**The actual mechanism (verified against current `src/`):** `packages/dorfl/src/ledger-write.ts` `currentLedgerWrite.applyTransition` (~L343-391) is the CAS: it pushes `<localBranch>:main --force-with-lease=main:<expectedBase>`, then on push success FETCHes and verifies `arbiterHead === head`. When two racers build the SAME commit sha X off the same base:

1. the first push fast-forwards `main` to X;
2. the second racer's push of the SAME X degrades to "Everything up-to-date" — git exits 0, and `--force-with-lease=main:<base>` has nothing to reject because the desired tip is ALREADY there;
3. the verify `arbiterHead === head` is then `X === X` ⇒ TRUE, so BOTH racers return `published`.

The post-push verify cannot distinguish "I won the push" from "someone else's IDENTICAL commit was already there." In `packages/dorfl/src/advancing-lock.ts` `createAttempt` (~L767-855), the create commit is built with the DETERMINISTIC message `advance: create ${path} (by ${ctx.by})` (~L805) off `${arbiter}/main` — exactly the same-sha-prone input — and its publish comment (~L820-825) asserts "our lease fails ⇒ rejected", which is precisely the assumption that breaks under same-identity racers. The same degeneracy exists for EVERY caller of `applyTransition`, since any two racers building identical commits hit the same "up-to-date" no-op.

## What to build

This is a PRESCRIPTIVE fix, not a reproduce-then-decide investigation. Make each CAS attempt's commit sha UNIQUE by injecting a per-attempt RANDOM nonce into the transition commit, so two concurrent same-identity racers can NEVER produce the same sha. With distinct shas, the second racer's `--force-with-lease=main:<base>` push finds `main` already advanced past `<base>` and is genuinely REJECTED (not a no-op "up-to-date"), and the `arbiterHead === head` verify then correctly fails for the loser. This makes the lease + verify authoritative for the same-identity / same-content case WITHOUT relying on identity/timestamp distinctness and WITHOUT weakening the one-winner invariant.

1. **Add a per-attempt random nonce wherever the transition commit MESSAGE is composed.** Inject it so EVERY caller's CAS commit sha is unique (create, claim, slicing-lock, advancing-lock, needs-attention surface), not just the create path. State the exact mechanism in a `## Decisions` block: prefer a `CAS-Nonce: <random>` trailer line appended to the commit message (a real git trailer so it round-trips and is greppable), or an equivalent message suffix. Use a strong-enough random source (e.g. `crypto.randomUUID()` / `randomBytes`) that collision is impossible in practice, and make sure each ATTEMPT (each retry of the outer refetch loop) gets a FRESH nonce, not one per process. The nonce must change the commit object's sha (so it belongs in the commit message/metadata, not an untracked file).

   - **Important — the `applyTransition` seam does NOT build the commit.** Verify this first: `ApplyTransitionInput` (`src/ledger-write.ts` ~L221) takes a `localBranch` + an already-built `head` sha and only PUSHES it; the transition commit is composed and committed by EACH CALLER *before* `applyTransition` (`createAttempt`'s `git commit -m 'advance: create …'` ~L804; `claim-cas.ts` ~L327; `slicing-lock.ts` ~L277/L703; `advancing-lock.ts` ~L288/L573; `needs-attention.ts`; the `*-persist.ts` helpers). There is **no single shared commit-building helper today**. So "inject at the seam" is NOT a free single chokepoint — the seam would have to amend/rewrite the caller's tip before pushing. Decide and document the injection strategy in `## Decisions`, choosing the one that covers ALL five callers with the least surface: either (a) introduce/route through ONE shared commit-message helper that every transition commit uses and stamp the nonce there (the true single chokepoint, but it means touching the call sites to adopt it), (b) stamp the nonce at each commit site, or (c) have the seam amend the tip's message (append the trailer) just before the CAS push. A create-only patch is explicitly OUT of scope — confirm by inspection that whichever strategy you pick covers create / claim / slicing-lock / advancing-lock / needs-attention.

2. **Harden the verify's intent (state the invariant, the nonce makes it naturally distinguishable).** After a successful-looking push, "up-to-date with no change of our making" must be treated as REJECTED, not published. With the nonce, a no-op up-to-date push can only mean "someone else's commit (different nonce ⇒ different sha) is already there" — which is a LOSS. Assert the invariant in the seam: the loser must come back `rejected` both because the push is genuinely rejected by the lease AND because the post-push verify no longer spuriously passes. Keep the existing "push reported success but `<arbiter>/main` is not our commit ⇒ rejected" guard and make sure it now FIRES for the loser instead of being bypassed by the sha coincidence.

3. **Test the fix at the PRODUCT layer (the INVERSE of #90).** Add a regression test that races two creators/promoters with IDENTICAL committer identity (NOT `raceClone`/`racerEnv` distinct identities — same `GIT_*` env / same local `user.*`) against the same slug/base, and asserts EXACTLY ONE winner deterministically. This is the scenario #90's helper assumed away; it must now pass because the CAS itself serialises via the nonce, not via sha-distinctness. Mirror the existing same-slug race tests:
   - `packages/dorfl/test/advance-triage.test.ts` (~L379-414, "a same-slug new-item race ⇒ exactly one promote creates") — add the identical-identity variant alongside the distinct-identity one;
   - `packages/dorfl/test/triage-persist.test.ts` (~L203-240, the sibling two-racing-promote test) — same.
   - Register the new identical-identity test so it runs under REAL contention (full parallel load). Today `advance-triage.test.ts` and `triage-persist.test.ts` are NOT in `RACE_SENSITIVE` in `packages/dorfl/vitest.config.ts` (they run in the `parallel` project). To model contention faithfully, either add the relevant file(s) to `RACE_SENSITIVE` or place the new test where it runs under the `sequential` race-sensitive project — decide and document which, and ensure the `won/lost.toHaveLength(1)` invariant holds with NO identity distinctness.

4. **Reframe the `racerEnv`/`raceClone` docstring** (`gitRepo.ts` ~L40-82) so it no longer claims "distinct identities in production ⇒ distinct shas." The helper is now a CONVENIENCE for modelling distinct principals, NOT the thing that makes the CAS correct. Document that the CAS is correct ON ITS OWN (via the nonce) even under IDENTICAL identities; `racerEnv`/`raceClone` remain available for tests that want to model distinct principals.

5. **Reconcile any test that pins a specific commit sha.** A nonce makes commit shas non-deterministic BY DESIGN. Audit the suite for any assertion that depends on a deterministic transition-commit sha and reconcile it (assert on message/trailer prefix or on the ref outcome, not the literal sha). Do not break an existing assertion to ship the nonce.

## Scope

- IN: a per-attempt random nonce injected at the SHARED CAS write seam (covering create / claim / slicing-lock / advancing-lock / needs-attention); the post-push "up-to-date / no change of our making ⇒ rejected" hardening with the invariant stated; a new same-identity-racer regression test (advance-triage + triage-persist) under real contention asserting exactly-one-winner; the `racerEnv`/`raceClone` docstring reframed; reconciliation of any sha-pinning test.
- OUT: weakening the one-winner invariant (`won.toHaveLength(1)` / `lost.toHaveLength(1)`) in any form (no `>= 1`, no retry-until-pass); removing `racerEnv`/`raceClone`; a create-ONLY patch that doesn't cover the other four callers; changing the lease mechanism itself (`--force-with-lease=main:<base>` stays — the nonce just makes it authoritative); the residual harness-timing concerns #90 already addressed.

## Acceptance criteria

- [ ] A per-attempt random nonce is added to the transition commit's MESSAGE (wherever it is composed) so two concurrent same-identity, same-content racers ALWAYS get DISTINCT shas. The exact mechanism (trailer line `CAS-Nonce: <random>` / message suffix) AND the injection strategy (shared message helper / per-site stamp / seam amends the tip) are stated in a `## Decisions` block, acknowledging that `applyTransition` only pushes an already-built `head` and so is NOT a free single chokepoint. A FRESH nonce is used per attempt (per retry of the refetch loop), not once per process.
- [ ] The loser of a same-sha-prone race is now GENUINELY REJECTED: a "push reported up-to-date / no change of our making" outcome is classified `rejected`, never `published`. Both the push-rejected path AND the post-push verify path are asserted (the loser loses via the lease, and the `arbiterHead === head` verify no longer spuriously passes).
- [ ] A new regression test races two creators with IDENTICAL identity (same `GIT_*` env / same local `user.*`) against ONE slug ⇒ exactly one winner, one loser-via-CAS, DETERMINISTICALLY. It runs under the full parallel suite / `RACE_SENSITIVE` registration so it models real contention. `won.toHaveLength(1)` / `lost.toHaveLength(1)` holds with NO identity distinctness. (Added to both `advance-triage.test.ts` and `triage-persist.test.ts`.)
- [ ] The `racerEnv`/`raceClone` docstring (`gitRepo.ts`) is reframed: it no longer claims production racers have distinct shas; it is documented as modelling distinct PRINCIPALS, with a note that the CAS is correct even under identical identity VIA THE NONCE.
- [ ] The fix is at the SHARED CAS seam so create / claim / slicing-lock / advancing-lock / needs-attention surface all benefit (NOT a create-only patch). The slice confirms by inspection which callers route through `applyTransition` and that the nonce covers all of them.
- [ ] No test that pins a deterministic transition-commit sha is left broken — any such assertion is reconciled to the nonce'd reality (assert on message/trailer or ref outcome, not literal sha).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green; the full suite is run SEVERAL times to confirm the same-slug-race flake is gone (now IMPOSSIBLE via the nonce-serialised CAS, not merely improbable).

## Blocked by

- None — can start immediately. It SUPERSEDES/EXTENDS the already-landed `triage-cas-race-test-models-real-contention` (#90, in `work/done/`) at the product layer; no in-flight slice blocks it.

## Prompt

> Make the dorfl ledger-write CAS AUTHORITATIVE for SAME-IDENTITY, SAME-CONTENT racers. Today the same-slug "2 winners" race can still happen in PRODUCTION (PR #90 only fixed the TEST): when two racers share one bot identity and build the SAME tree + message off the SAME base within one second (git timestamps are 1-second resolution), they produce an IDENTICAL commit sha X. The first push fast-forwards `main` to X; the second push of the SAME X degrades to "Everything up-to-date" (git exits 0, the lease has nothing to reject), and the post-push verify `arbiterHead === head` is `X === X` ⇒ TRUE — so BOTH return `published`. This is a PRODUCT defect, not a test artifact. This is a PRESCRIPTIVE fix: implement the nonce, do not re-litigate.
>
> THE FIX: inject a per-attempt RANDOM nonce (e.g. a `CAS-Nonce: <random>` trailer in the transition commit message, via `crypto.randomUUID()`/`randomBytes`) wherever the transition commit MESSAGE is composed, so EVERY `applyTransition` caller's commit sha is unique. Two concurrent same-identity racers then get DISTINCT shas, the loser's `--force-with-lease=main:<base>` push is GENUINELY REJECTED (main moved past `<base>`, not a no-op up-to-date), and the verify correctly fails for the loser. Use a FRESH nonce per ATTEMPT (per retry of the refetch loop), not once per process. ALSO harden the verify intent: a "push reported up-to-date / no change of our making" outcome must be classified REJECTED, never published (the nonce makes this naturally distinguishable — state the invariant).
>
> MIND THE SEAM SHAPE: `applyTransition` (`src/ledger-write.ts`) does NOT build the commit — it takes a `localBranch` + already-built `head` sha and only pushes it; the transition commit is composed and committed by EACH CALLER first, and there is NO shared commit-building helper today. So "nonce at the seam" is not a free single chokepoint. COVER ALL FIVE CALLERS — inspect `src/advancing-lock.ts`, `src/slicing-lock.ts`, `src/claim-cas.ts`, `src/needs-attention.ts`, and the create path — and pick (in a `## Decisions` block) the least-surface strategy that covers all of them: (a) route every transition commit through ONE shared message helper and stamp the nonce there, (b) stamp it at each commit site, or (c) have the seam amend the tip's message before the CAS push. A create-only patch is NOT acceptable.
>
> READ FIRST: `src/ledger-write.ts` `currentLedgerWrite.applyTransition` (~L343-391 — the push + `--force-with-lease=main:<base>` + `arbiterHead === head` verify; the home of the nonce + the reject-on-up-to-date hardening); `src/advancing-lock.ts` `createAttempt` (~L767-855 — the DETERMINISTIC `advance: create ${path} (by ${by})` commit + the "our lease fails ⇒ rejected" comment to correct); `test/advance-triage.test.ts` (~L379-414, the same-slug promote-creates race — add an IDENTICAL-IDENTITY variant); `test/triage-persist.test.ts` (~L203-240, the sibling two-racing-promote test — same); `test/helpers/gitRepo.ts` (`racerEnv`/`raceClone` ~L40-82 — REFRAME the docstring); `vitest.config.ts` (`RACE_SENSITIVE` — note `advance-triage`/`triage-persist` are NOT in it today; register the new test under real contention). Background: the shipped `work/done/triage-cas-race-test-models-real-contention.md` (#90, which this supersedes at the product layer).
>
> TEST AT THE PRODUCT LAYER (the INVERSE of #90): add a regression test that races two creators/promoters with IDENTICAL committer identity (same `GIT_*` env / same local `user.*` — NOT `raceClone`/`racerEnv` distinct identities) against ONE slug/base, asserting EXACTLY ONE winner / ONE loser-via-CAS DETERMINISTICALLY, under the full parallel / `RACE_SENSITIVE` load. It must pass because the CAS serialises via the NONCE, not via sha-distinctness. Keep `racerEnv`/`raceClone` (reframe the docstring to "models distinct principals; the CAS is correct even under identical identity via the nonce"). A nonce makes transition-commit shas non-deterministic BY DESIGN — audit the suite for any test that pins a specific commit sha and reconcile it (assert on message/trailer or ref outcome, not the literal sha).
>
> SCOPE FENCE: do NOT weaken the one-winner invariant (`won/lost.toHaveLength(1)` — no `>= 1`, no retry-until-pass); do NOT remove `racerEnv`/`raceClone`; do NOT change the lease mechanism itself (the nonce makes the existing `--force-with-lease` authoritative); the fix must be at the shared seam so create / claim / slicing-lock / advancing-lock / needs-attention all benefit. "Done" = the nonce is at the shared seam, the up-to-date-no-op is rejected, the identical-identity race is exactly-one-winner deterministically, the docstring is reframed, no sha-pinning test is left broken, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green across SEVERAL full-suite runs (the flake is now impossible, not merely improbable).

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim cas-create-nonce-authoritative-same-identity --arbiter origin
# then start work on the updated main:
git fetch origin && git switch -c work/cas-create-nonce-authoritative-same-identity origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/cas-create-nonce-authoritative-same-identity.md work/done/cas-create-nonce-authoritative-same-identity.md
```

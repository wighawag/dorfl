---
title: triage-cas-race-test-models-real-contention — make the two-racing-promote CAS tests DETERMINISTIC (they flake "2 winners" under full-suite parallel load) by modelling real arbiter contention, NOT by weakening the one-winner invariant — the product CAS is sound, the TEST races
slug: triage-cas-race-test-models-real-contention
covers: []
---

> Self-contained TEST-HARDENING slice — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signals (all the same flake; discharge/mark-resolved on landing): `work/observations/advance-triage-same-slug-race-flaky-under-full-suite.md`, `work/observations/advance-triage-same-slug-cas-race-2026-06-11.md`, `work/observations/advance-triage-cas-race-flaky.md`, `work/observations/full-test-suite-flakes-under-parallel-load.md`.
>
> WHY THIS SLICE EXISTS: it BLOCKS `advance-drivers-and-gates` — that slice's work is green, but its acceptance gate red TWICE on THIS flake (1564/1565 then 1563/1565), routing good work to needs-attention. Fixing the flake unblocks `advance-drivers-and-gates` (rebuild it after this lands) and removes a recurring false-red from EVERY slice's full-suite gate.

## The diagnosis (settled — do NOT re-litigate the product CAS)

The same-slug new-item race test — "a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS" — intermittently sees **2 winners** (both `exitCode 0`) under the FULL `pnpm -r test` parallel load. It passes DETERMINISTICALLY in isolation (`vitest run test/advance-triage.test.ts` / `test/triage-persist.test.ts`).

**The product CAS is logically sound and is NOT the bug.** The lock/create publish is `git push <arbiter> <branch>:main --force-with-lease=main:<base>` followed by a post-push verify that `<arbiter>/main` is now exactly our commit (`src/ledger-write.ts` `applyTransition`). That is a server-side atomic ref update; git's ref-transaction locking is identical over `file://`, SSH, and HTTP — so a local `--bare`/`file://` arbiter enforces the CAS exactly as GitHub does. The maintainer confirmed the design intent: the lock must behave the same on a `file://` remote and a real git host, and it does. **DO NOT "fix" this by changing the product CAS, and DO NOT weaken the one-winner assertion** (`won.toHaveLength(1)` / `lost.toHaveLength(1)`) — that invariant is the whole point of the test.

**The flake is a TEST-HARNESS artifact.** Two suspected contributors, to be confirmed by the build agent (instrument, don't assume):

1. **`--force-with-lease` over the LOCAL transport.** The two racers are freshly-cloned working clones of the same `file://` bare arbiter; both start with the SAME `arbiter/main` remote-tracking ref. `--force-with-lease=main:<base>` is checked CLIENT-SIDE against the pusher's own tracking ref. Over git's local-transport optimisation this client-side lease check, plus the bare repo's ref-lock window, can let BOTH pushes believe their lease holds before either ref-update is observed by the other — so both `applyTransition` calls return `published` ⇒ both `created` ⇒ 2 winners. (Contrast: the lock tests `claim-cas`/`advancing-lock`/`slicing-lock` use the SAME `Promise.all` + `file://` shape but flake far less — pin down WHY the create/promote path is more exposed, e.g. its extra fetch/check-then-act window in `createAttempt` widens the race.)
2. **In-process `Promise.all` contention.** Running both racers in ONE Node event loop (interleaved awaits) is not how production races happen (separate processes/machines against a remote whose receive-pack strictly serialises). The in-process interleave can line the two pushes up inside the lease's blind spot.

The honest fix MODELS PRODUCTION (real, serialised arbiter contention) so the one-winner invariant is asserted under conditions that match reality — it does not paper over the race.

## What to build

Make the same-slug-race CAS tests DETERMINISTIC while still asserting EXACTLY ONE winner / ONE loser. The build agent should REPRODUCE the flake first (run the relevant files under load — e.g. repeated `vitest run` with high concurrency, or the full `pnpm -r test` a few times — and/or instrument `applyTransition` to log the lease outcome of each racer), CONFIRM which of the two contributors above is load-bearing, then apply the minimal fix that makes the assertion hold deterministically. Candidate fixes, cleanest first (pick by what the reproduction shows; justify in a `## Decisions` block):

- **(A) Make the lease genuinely server-authoritative in the test arbiter** so two concurrent local pushes cannot both win: e.g. configure the bare arbiter to reject non-atomic/racey updates, push with `--atomic`, or set `receive.denyNonFastForwards`/an `update` hook that serialises — whatever makes `file://` enforce the same one-winner outcome the smart protocol gives, WITHOUT changing product code. (Preferred if it makes the test model real-host behaviour.)
- **(B) Run the two racers as genuinely independent OS processes** (not in-process `Promise.all`) against the shared bare arbiter, so git's own receive-pack ref-lock arbitrates exactly as in production — the most faithful "model reality" fix. (A shared test helper, reused across the race tests.)
- **(C) Serialise the publish at the test seam** only if A/B prove impractical: a tiny mutex around the CAS push in the TEST harness (never in product code) so the two leases are evaluated one-at-a-time — acceptable only if it still exercises the real `applyTransition` lease (the loser must still LOSE via the lease/path-exists check, not via the mutex).

Apply the chosen fix as a SHARED helper so every two-racer CAS test that exhibits (or could exhibit) the flake benefits — at minimum `test/advance-triage.test.ts` and `test/triage-persist.test.ts`; audit `test/advancing-lock.test.ts`, `test/slicing-lock.test.ts`, `test/claim-cas.test.ts` (same `Promise.all` + `file://` shape) and apply it there too if they share the exposure.

## Scope

- IN: reproduce + confirm the flake's mechanism; a deterministic fix (A/B/C above) that PRESERVES the exactly-one-winner / one-loser assertion; applied as a shared helper across the affected two-racer CAS tests; the full suite stable across repeated runs.
- OUT: ANY change to the product CAS (`ledger-write.ts` `applyTransition`, `advancing-lock.ts` `createItemThroughCas`/`createAttempt`, the lock primitives) — they are SOUND; weakening the one-winner invariant; "fixing" by asserting `won.length >= 1` or retry-until-pass without a real serialisation; rebuilding `advance-drivers-and-gates` (separate — do that after this lands).

## Acceptance criteria

- [ ] The flake is REPRODUCED and its mechanism CONFIRMED (state which contributor was load-bearing in a `## Decisions` block) BEFORE the fix — not assumed.
- [ ] The same-slug-race tests in `test/advance-triage.test.ts` AND `test/triage-persist.test.ts` assert EXACTLY ONE winner (`exitCode 0`) and ONE loser (`exitCode 2`, outcome `lost`) and pass DETERMINISTICALLY — verified by running the full `pnpm -r test` suite several times (e.g. ≥5 consecutive green runs) with NO "2 winners" failure.
- [ ] NO product code changed — the diff is test-harness only (`test/**` + test helpers). `git diff --stat` shows no `src/**` change. (If the agent believes a product change is genuinely needed, that CONTRADICTS the diagnosis — STOP and surface it, do not proceed.)
- [ ] The one-winner INVARIANT is still genuinely asserted (the loser still LOSES via the real lease / path-exists CAS, not bypassed) — the test would still FAIL if the product CAS were broken to allow two winners.
- [ ] The fix is a SHARED helper reused across the affected two-racer CAS tests (not copy-pasted per file); any other `Promise.all` + `file://` race test sharing the exposure is migrated to it.
- [ ] `pnpm format:check && pnpm build && pnpm test` green (this repo's gate), and the full suite is stable across repeated runs.

## Prompt

> Make the same-slug-race CAS tests DETERMINISTIC. They intermittently see "2 winners" under full `pnpm -r test` parallel load (pass in isolation). The PRODUCT CAS IS SOUND — `git push --force-with-lease=main:<base>` + post-push verify (`src/ledger-write.ts` applyTransition) is a server-atomic ref update, identical on `file://` and GitHub; the maintainer confirmed this. DO NOT touch product code and DO NOT weaken the exactly-one-winner assertion. Sources: the four `work/observations/*flak*/*cas-race*/*parallel-load*` notes (READ them; mark resolved on landing).
>
> FIRST REPRODUCE + INSTRUMENT (don't assume): run `test/advance-triage.test.ts` + `test/triage-persist.test.ts` under load (repeated/high-concurrency vitest, and/or the full suite a few times) and/or log each racer's lease outcome in applyTransition, to CONFIRM whether the cause is the `--force-with-lease` LOCAL-transport client-side-lease blind spot (two fresh clones of the same `file://` bare arbiter both believing their lease holds) and/or the in-process `Promise.all` interleave (vs production's separate-process races). Record the finding in a `## Decisions` block.
>
> THEN FIX by MODELLING REAL CONTENTION, cleanest first: (A) make the test bare arbiter enforce the lease server-authoritatively (atomic push / receive config / update hook) so two concurrent local pushes can't both win; OR (B) run the two racers as genuinely separate OS processes against the shared bare arbiter so git's receive-pack ref-lock arbitrates as in production; OR (C, last resort) a TEST-only mutex around the publish that still routes the loser through the real lease/path-exists CAS. Apply as a SHARED helper across the affected two-racer CAS tests (advance-triage, triage-persist; audit advancing-lock/slicing-lock/claim-cas for the same shape).
>
> READ FIRST: `src/ledger-write.ts` applyTransition (the lease + post-push verify — the sound CAS, do NOT change); `src/advancing-lock.ts` createItemThroughCas + createAttempt (the check-then-act create path the promote uses — its fetch/path-exists window may widen the race); `test/advance-triage.test.ts` + `test/triage-persist.test.ts` (the flaky `Promise.all` two-racer tests + `won/lost.toHaveLength(1)` assertions); `test/helpers/*` `seedRepoWithArbiter`/`clone` (the `file://` bare arbiter + working clones); `test/advancing-lock.test.ts`/`slicing-lock.test.ts`/`claim-cas.test.ts` (same shape, audit for the exposure).
>
> "Done" = the flake is gone (full `pnpm -r test` stable across ≥5 repeated runs, no "2 winners"), the exactly-one-winner/one-loser invariant is still genuinely asserted (loser loses via the real CAS), the diff is TEST-ONLY (no `src/**`), and the gate is green. If reproduction shows a genuine PRODUCT defect (the CAS really can yield two winners on a real remote, not just `file://` in-process), STOP and surface it — that contradicts the diagnosis and is a different, gated slice.

---

### Claiming this slice

```sh
dorfl claim triage-cas-race-test-models-real-contention --arbiter origin
git fetch origin && git switch -c work/triage-cas-race-test-models-real-contention origin/main
git mv work/in-progress/triage-cas-race-test-models-real-contention.md work/done/triage-cas-race-test-models-real-contention.md
```

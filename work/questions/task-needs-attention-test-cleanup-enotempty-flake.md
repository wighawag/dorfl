<!-- dorfl-sidecar: item=task:needs-attention-test-cleanup-enotempty-flake type=task slug=needs-attention-test-cleanup-enotempty-flake allAnswered=false -->

## Q1

**Which fix approach should the slice take for the cleanup race: (a) await/settle in-flight git/fs ops before rmSync, (b) retry rmSync on ENOTEMPTY (bounded retry/backoff), or (c) both? Pick one so the task has concrete acceptance criteria.**

> The source observation's applied answer (work/notes/observations/needs-attention-test-cleanup-enotempty-flake.md, 'Applied answers 2026-06-22') agreed 'promote-slice (small, localised)' and named two candidate fixes ('await in-flight ops before cleanup, or retry rmSync on ENOTEMPTY') without choosing between them. The promoted task body is still a bare stub ('draft this into a buildable task') with no ## What to build detail, no acceptance criteria, and no ## Prompt, so it is not claim-ready (REVIEW-PROTOCOL lens 3: a task's ## Prompt must be self-contained). The chosen approach decides the acceptance test.

_Suggested default: Retry rmSync on ENOTEMPTY with a short bounded backoff (simplest, localised, directly targets the observed failure) and only add awaiting of in-flight ops if the retry proves insufficient._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Approach (b): retry rmSync on ENOTEMPTY with a short bounded backoff. It is the simplest, most localised fix and directly targets the observed failure. Only add awaiting of in-flight ops (approach a) if the retry proves insufficient in practice.

## Q2

**The file/line references inherited from the observation are stale — should the task fix them to the real site(s)? The cited path 'test/needs-attention.test.ts'/'test/helpers/gitRepo.ts:102' is wrong: the files live under packages/dorfl/, and the cleanup() rmSync is at packages/dorfl/test/helpers/gitRepo.ts:152 (the applied answer said :150, also off by two).**

> Verified against the tree: the only test/helpers/gitRepo.ts is packages/dorfl/test/helpers/gitRepo.ts; cleanup() does rmSync(root,{recursive:true,force:true}) at line 152 (grep output lines 151-152). The observation cited :102, its applied answer corrected to :150, both are now stale. A task built on a stale premise is a block per REVIEW-PROTOCOL lens 1; the prompt must point at the real line.

_Suggested default: Yes — rewrite the task to reference packages/dorfl/test/helpers/gitRepo.ts cleanup() (currently line 152) and packages/dorfl/test/needs-attention.test.ts afterEach (line 47), and instruct the builder to re-confirm line numbers at build time rather than trusting the cited number._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes, fix the stale refs: rewrite the task to reference packages/dorfl/test/helpers/gitRepo.ts cleanup() (currently line 152) and packages/dorfl/test/needs-attention.test.ts afterEach, and instruct the builder to re-confirm line numbers at build time rather than trusting the cited number (the observation's :102 and the applied-answer's :150 are both stale).

## Q3

**Should the fix be applied only to the makeScratch().cleanup() helper, or generalised to every recursive force rmSync cleanup site that can hit the same race?**

> REVIEW-PROTOCOL core discipline 4 ('a second instance is a signal, generalise the fix'). makeScratch().cleanup() (gitRepo.ts:152) is the site the needs-attention test exercises via afterEach, but gitRepo.ts also does rmSync(dest,{recursive:true,force:true}) at :352 (seed/done helper). If the race is structural (git/fs ops still touching the tree on Linux), the same ENOTEMPTY can surface from other helpers; fixing only cleanup() may leave a latent flake.

_Suggested default: Fix the shared rmSync path once (e.g. a single safeRemoveDir helper used by both :152 and :352) rather than patching cleanup() in isolation, so the race cannot resurface at the other site._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Generalise. Fix the shared rmSync path once via a single safeRemoveDir helper used by both the cleanup() site (:152) and the seed/done helper (:352), rather than patching cleanup() in isolation. The race is structural (git/fs ops still touching the tree), so a localised patch would leave a latent flake at the other site. (REVIEW-PROTOCOL discipline 4: a second instance means generalise.)

## Q4

**How will the slice DEMONSTRATE the fix, given the failure is an intermittent race that passes on isolated re-run and only showed under full 'pnpm -r test'? What is the acceptance evidence — a deterministic regression test, repeated-run stress, or just 'verify stays green'?**

> The observation notes the flake was non-deterministic ('Re-running the file in isolation passes; full pnpm -r test was the failing site'). An intermittent race is hard to pin with a normal pass/fail test, so without an explicit acceptance signal the slice could merge green while the race survives. REVIEW-PROTOCOL lens 5 / discipline 6: name the proof or it cannot be judged done.

_Suggested default: Accept on: a hardened cleanup (retry-on-ENOTEMPTY or settle) plus a targeted unit test that exercises cleanup() against a deliberately-busy directory to assert it no longer throws ENOTEMPTY, with the normal verify floor (pnpm -r build && pnpm -r test && pnpm format:check) staying green._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Accept on: the hardened shared removal helper (retry-on-ENOTEMPTY) PLUS a targeted unit test that exercises it against a deliberately-busy directory to assert it no longer throws ENOTEMPTY, with the normal verify floor (pnpm -r build && pnpm -r test && pnpm format:check) staying green. A deterministic unit test on the helper is the honest proof; do not rely on "verify stays green" alone for an intermittent race.

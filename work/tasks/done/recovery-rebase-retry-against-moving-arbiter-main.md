---
title: 'Recovery/integration rebase retries against a CONCURRENTLY-MOVING arbiter/main before crying conflict'
slug: recovery-rebase-retry-against-moving-arbiter-main
blockedBy: [] # startable now; see "Relationship to disable-rename-detection-on-continue-rebase" before building
covers: []
---

## What to build

Make the runner's recovery / integration rebase tolerant of an `arbiter/main`
that is being rewritten by SIBLING runs WHILE it rebases, so a purely TRANSIENT
race no longer surfaces as a `rebase-conflict` / needs-attention.

The recovery tail (`recoverAlreadyCommitted` in the integration-core module,
`packages/dorfl/src/integration-core.ts`) does, today, a SINGLE shot:

```
git fetch <arbiter> +refs/heads/main:refs/remotes/<arbiter>/main
git rebase <arbiter>/main        # one attempt; on non-zero → abort → 'rebase-conflict'
```

It fetches `arbiter/main` ONCE, rebases ONCE, and on any non-zero rebase status
aborts and returns `outcome: 'rebase-conflict'` (the kept commit stays on the
branch, the human resolves and re-runs). That is correct for a GENUINE content
conflict. It is WRONG for the common case where `arbiter/main` is a moving
target: the project's own `advance` runs land `advance: surface observation:...`
commits onto `arbiter/main` in TIGHT BURSTS (each adds a file under
`work/notes/observations/` or `work/questions/`), so the single fetched base can
be stale-by-milliseconds, and the one-shot rebase conflicts against a main that
has already moved again. A re-run moments later (after the burst settles)
rebases CLEANLY against the SAME committed work — proving the conflict was the
moving base, not the code.

The slice: wrap the recovery rebase in a BOUNDED re-fetch + re-rebase retry. On
a conflicting rebase: `git rebase --abort`, RE-FETCH `arbiter/main` (it may have
advanced), and retry, up to a small bounded cap. ONLY after the cap is exhausted
— i.e. it STILL conflicts against a freshly-fetched, momentarily-stable main —
return `outcome: 'rebase-conflict'` and route to needs-attention exactly as
today. A clean rebase on any attempt integrates as today. This separates "main
moved under me" (a later attempt wins) from "genuine code conflict" (every
attempt against fresh main still fails → human), WITHOUT ever auto-resolving and
WITHOUT `--force`.

NOTE the loop CANNOT classify a conflict up front. Unlike the Race-1 loop — which
gets an unambiguous `non-fast-forward` contention SIGNAL from git — a rebase
CONFLICT carries no such signal: a moving-base race and a genuinely incompatible
edit look identical at the moment of conflict. So do NOT hunt for a way to detect
"is this contention?" (there isn't one). The bounded retry against a
freshly-fetched base IS the discriminator: transient → a later attempt is clean;
genuine → every attempt against fresh main still conflicts → cap exhausts → human.
The cap is the give-up bound, not a heuristic.

USE THE CONTENTION MODEL, NOT THE OUTAGE BACKOFF HELPER. The repo deliberately
keeps TWO distinct retry models, and they MUST NOT be conflated (see the
doc-comment at the top of `packages/dorfl/src/retry-backoff.ts`):

  - OUTAGE (`retryWithBackoff` / `DEFAULT_BACKOFF`): the remote is
    UNREACHABLE/flaky; wait with EXPONENTIAL temporal backoff because the remote
    may come back. Used by the needs-attention network ops (`github.ts`,
    `needs-attention.ts`, `integrator.ts`). This is NOT our case — do NOT reuse it.
  - CONTENTION (`claim-cas.ts`; and the Race-1 merge loop in this same
    integration-core module): a ref MOVED under us (a sibling advanced it); the
    fix is to RE-FETCH + REBUILD against the new base, retried INSTANTLY (no
    temporal backoff — there is no outage to wait out), bounded by a small cap.

Our moving-`arbiter/main` rebase conflict is CONTENTION (a sibling `advance` run
advanced the ref), so it follows the CONTENTION model: an instant re-fetch +
re-rebase loop, exactly like the Race-1 merge loop a few hundred lines up in this
file (`DEFAULT_MERGE_RETRIES`/`input.mergeRetries`, which on a non-fast-forward
re-runs the rebase and retries the push with NO sleep, citing `claim-cas.ts`).
Follow THAT pattern. Do NOT pull in `retryWithBackoff` / exponential backoff.
(You also need not fold into the Race-1 loop itself — that one keys off a
non-fast-forward PUSH; ours keys off a rebase CONFLICT — but mirror its instant,
capped, re-fetch-and-rebase shape and its needs-attention give-up.)

JITTER — a SMALL livelock-breaking SPREAD, not exponential backoff. Pure instant
retry has a failure mode you must guard against: two runners that begin retrying
at the SAME instant re-fetch and re-rebase in lockstep, each moving the base the
other just rebased onto, and can livelock. So insert a SMALL randomized delay
(jitter) before each re-attempt — just enough temporal SPREAD to de-correlate two
racers — NOT the exponential `retryWithBackoff` schedule (that is the outage
model, wrong here). Keep the jitter bounded and tiny (a few hundred ms order, a
contention nudge, not an outage wait), and put the SLEEP behind an INJECTABLE
seam (reuse the existing `Sleep`/`realSleep` seam from `retry-backoff.ts`, or the
same `sleep` seam `run.ts` uses) with the RNG also injectable/seedable, so tests
drive the timeline deterministically (inject zero/fixed jitter or a seeded RNG).
Record in Decisions that jitter here is contention-spread, explicitly NOT the
outage backoff.

### Why this was raised (the live incident, 2026-06-21)

`dorfl advance task:reaper-no-lock-outcome-benign-not-lost --propose
--watch --arbiter origin` ran under CI, built green (gate passed: build + 2407
tests + format), and then FAILED at the recovery-integration step with:

> Recovering 'reaper-no-lock-outcome-benign-not-lost': rebasing the kept
> work/task-reaper-no-lock-outcome-benign-not-lost onto origin/main conflicted;
> the rebase was aborted (never auto-resolved). ... Resolve against the latest
> main, then re-run. — exit 1.

The committed work (`feat(...)` commit) was intact on
`origin/work/task-reaper-no-lock-outcome-benign-not-lost`. Re-running the rebase
manually moments later against the SETTLED `origin/main` (tip `fb1a753`)
replayed CLEANLY and the full acceptance gate was green; the rebased tip was
pushed and integrates fast-forward. The committed tip `429a9cc` also rebases
cleanly onto `fb1a753` after the burst settled — so the conflict was NOT
reproducible from the committed state against the settled base, i.e. it was a
TRANSIENT race against an `origin/main` that was mid-burst of `advance: surface
observation:...` commits when the runner fetched its base. This non-determinism
means a re-run (option-1) under CI can hit the SAME race again, which is the
motivation for making the rebase absorb the burst itself.

### Relationship to `disable-rename-detection-on-continue-rebase` (READ BEFORE BUILDING)

> CORRECTION (2026-06-24): where this section (and the prompt below) says the
> sibling uses `-Xno-renames` / `merge.renames` / `diff.renames`, that is the WRONG
> git knob — it does NOT suppress the spurious DIRECTORY-rename conflict
> (`CONFLICT (file location)`), which is governed by `merge.directoryRenames`. The
> sibling's first attempt (PR #224) was closed unmerged for this reason and the
> task parked in `work/tasks/backlog/` with the correct mechanism
> (`-c merge.directoryRenames=false`, verified on git 2.47.3). This done record is
> left as-is otherwise (historical); read the parked sibling's CORRECTION banner
> for the right knob.

There is a SIBLING task, `disable-rename-detection-on-continue-rebase`, that
turns OFF git rename detection on the runner's continue/integration rebases. The
two are COMPLEMENTARY but NOT the same bug, and the builder of THIS task must not
duplicate or collide with it:

  - That task kills a class of SPURIOUS `CONFLICT (file location)` conflicts: a
    sparse-folder done-move (`work/tasks/todo → work/tasks/done`) read as a
    whole-DIRECTORY rename, so a main that ADDED files into a `work/` folder
    flags them as mislocated. Given the reaper commit's `git mv todo → done` and
    the `work/notes/observations/` churn on main, the 2026-06-21 incident may in
    fact have been THAT spurious-rename conflict — in which case rename-off
    ALONE makes the burst rebase cleanly and a retry is belt-and-braces.
  - THIS task targets the ORTHOGONAL "the base moved under me between fetch and
    rebase" race, which rename-off does NOT address (a genuinely-different base
    can content-conflict even with renames off).

FIRST STEP for the builder: determine whether `disable-rename-detection-on
-continue-rebase` has already landed. If it has, CONFIRM this retry is still
warranted as a distinct moving-base guard (it is — re-fetch-and-retry covers a
different failure mode) and ensure the retry loop's rebase invocations ALSO
carry rename-off (do not regress that fix inside the new loop).

ALSO DECIDE: the build-path retry deliberately re-runs `rebaseOntoMainWithReconcile()`
rather than a bare rebase, because "a bare re-rebase would MISS" the sibling-ledger
and divergent-done-move reconcile arms it carries. The recovery path
(`recoverAlreadyCommitted`) today uses a BARE `git rebase`. Since this task makes
it RE-FETCH a possibly-advanced `arbiter/main` mid-loop, the builder MUST
determine whether the recovery re-rebase now needs those reconcile arms too (a
sibling could have advanced the ledger between attempts) or is deliberately bare
(the recovery tail integrates an already-done-moved branch, so the arms may not
apply) — and RECORD the decision with its reasoning in the Decisions block. Do
NOT silently leave it bare without having asked the question. If it has NOT
landed, keep the two tasks separable: this task adds the bounded retry; the
sibling adds rename-off; the retry loop should be written so rename-off slots in
cleanly (whichever lands second adds its option to the shared rebase call).

## Acceptance criteria

- [ ] The recovery rebase in `recoverAlreadyCommitted` (integration-core) retries
      on a conflicting rebase: `--abort`, RE-FETCH `<arbiter>/main`, re-rebase, up
      to a small bounded cap. It follows the CONTENTION model (instant re-fetch +
      re-rebase, like the Race-1 merge loop / `claim-cas.ts`), NOT the OUTAGE
      `retryWithBackoff` exponential-backoff helper (which is for an unreachable
      remote, a different failure class the codebase keeps separate). It is also
      NOT folded into the Race-1 non-fast-forward-push loop itself (different
      trigger: rebase conflict vs non-ff push) — it mirrors that loop's shape.
- [ ] A SMALL randomized JITTER (livelock-breaking SPREAD, NOT exponential
      backoff) is inserted before each re-attempt so two runners that start
      retrying at the same instant do NOT re-fetch/re-rebase in lockstep and
      livelock on the same `main` advance. The jitter is bounded and tiny (a
      contention nudge, not an outage wait). Both the SLEEP and the RNG are behind
      INJECTABLE seams (reuse the existing `Sleep`/`realSleep` seam) so tests stay
      deterministic (inject zero/fixed jitter or a seeded RNG).
- [ ] Only after the cap is exhausted does it return `outcome: 'rebase-conflict'`
      and route to needs-attention (the EXISTING behaviour/shape is preserved for a
      genuine, persistent conflict). The kept commit always stays intact on the
      branch; the rebase is ALWAYS `--abort`ed on conflict (never left mid-rebase),
      and main is NEVER `--force`d.
- [ ] A clean rebase on ANY attempt integrates through the SAME
      `applyCompleteTransition` primitive as today (no new integrate path).
- [ ] The `already-integrated` no-op short-circuit (kept tip already reachable on
      `<arbiter>/main`) is unchanged and still checked BEFORE the retry loop.
- [ ] Test: a recovery where `<arbiter>/main` ADVANCES with a non-conflicting
      commit BETWEEN the first (failing) and a later (succeeding) rebase attempt
      integrates cleanly within the cap and does NOT route to needs-attention —
      i.e. a moving-but-compatible base is absorbed, not surfaced. (Drive the
      "advance main mid-loop" via the test's own seam/hook, e.g. a fetch/rebase
      shim or an arbiter that gains a commit between attempts.)
- [ ] Test: a GENUINE same-path content conflict that persists across every
      re-fetched attempt STILL exhausts the cap and STILL returns
      `'rebase-conflict'` / needs-attention — the retry must NOT mask a real
      conflict, and must NOT loop unboundedly.
- [ ] Test: jitter is present and de-correlates re-attempts. With the injected
      `sleep` seam capturing the per-attempt delays, assert a non-zero randomized
      spread is applied before re-attempts (NOT a fixed/zero delay, and NOT an
      exponential `delay * 2` schedule — it is a small contention jitter), and that
      with a fixed/seeded jitter injection the captured timeline is reproducible.
- [ ] The recovery re-rebase's need (or deliberate non-need) for the sibling-ledger
      / divergent-done-move reconcile arms (the ones the build-path
      `rebaseOntoMainWithReconcile()` carries) is explicitly DECIDED and recorded
      in the Decisions block — not silently left bare. If the decision is "needs
      them", the recovery loop reuses the SAME reconcile path (no second copy); if
      "deliberately bare", the reason is stated.
- [ ] If `disable-rename-detection-on-continue-rebase` has landed, the retry loop's
      rebase invocations carry rename-off too (no regression of that fix); if it
      has not, the loop is written so rename-off slots in cleanly. State which case
      held in the done record.
- [ ] A `## Decisions` block records: the retry cap chosen and why; that this is
      the CONTENTION model (instant re-fetch+re-rebase, like `claim-cas.ts` / the
      Race-1 loop) and explicitly NOT the OUTAGE `retryWithBackoff` exponential
      backoff, with WHY the two are distinct; the JITTER as a small
      livelock-breaking contention spread (not outage backoff); that re-fetch
      happens on EACH attempt (a stale single fetch is the root cause); that a
      persistent conflict across fresh fetches is treated as genuine (→ human)
      while a transient one is absorbed; the reconcile-arms decision (above); and
      the relationship to the rename-detection task (orthogonal failure modes).
- [ ] Tests use throwaway git repos + a local `--bare` `file://` arbiter; nothing
      writes outside its own temp fixtures (mirror the existing
      `makeScratch`/`seedRepoWithArbiter`/`gitIn`/`gitEnv` helper style).

## Blocked by

- None — can start immediately. See the "Relationship to ..." section above for
  how to compose with the sibling rename-detection task (not a hard block).

## Prompt

> Goal: make the runner's recovery/integration rebase absorb a CONCURRENTLY-MOVING
> `arbiter/main` so a purely TRANSIENT race stops surfacing as a `rebase-conflict`
> / needs-attention, while a GENUINE persistent conflict still routes to the human.
> Read "What to build", "Why this was raised", and "Relationship to
> disable-rename-detection-on-continue-rebase" above — they are self-contained.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm `recoverAlreadyCommitted` in
> `packages/dorfl/src/integration-core.ts` still does a SINGLE
> fetch-then-rebase and returns `outcome: 'rebase-conflict'` on the first non-zero
> rebase. ALSO check whether `disable-rename-detection-on-continue-rebase` has
> landed and whether the recovery rebase already carries `-Xno-renames` /
> `merge.renames=false`. If the machinery moved or a prior slice already added a
> retry, do NOT build on the stale premise — route to needs-attention with the
> discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Where to look (by concept, not brittle line numbers):
>   - `recoverAlreadyCommitted` (integration-core) — the recovery TAIL. It already:
>     fetches `+refs/heads/main:refs/remotes/<arbiter>/main`; short-circuits
>     `already-integrated` via `isAncestor` (KEEP this before the loop); then does
>     `const rebase = await gitSoft(['rebase', '<arbiter>/main'], ...)` and on
>     `status !== 0` does `gitSoft(['rebase','--abort'])` + returns
>     `'rebase-conflict'`. Wrap THAT rebase in the bounded re-fetch+retry.
>   - The integrate primitive `ledgerWrite.applyCompleteTransition` — unchanged; a
>     clean rebase on any attempt flows through it exactly as today.
>   - The git runners `gitSoft`/`gitHard` and the exact fetch refspec already used
>     in this function — REUSE them for the per-attempt re-fetch (do not invent a
>     new fetch shape).
>   - RETRY MODEL — use CONTENTION, not OUTAGE. Read the doc-comment at the top of
>     `src/retry-backoff.ts`: it spells out that `retryWithBackoff` is for the
>     OUTAGE/unreachable case (exponential temporal backoff, the remote may come
>     back) and DELIBERATELY NOT for CONTENTION (a moved ref), which `claim-cas.ts`
>     handles by INSTANT re-fetch+rebuild against the new base. Our rebase conflict
>     is CONTENTION (a sibling `advance` advanced `main`). So do NOT use
>     `retryWithBackoff`. Mirror the CONTENTION pattern instead: the Race-1 merge
>     loop in this same module (`DEFAULT_MERGE_RETRIES`/`input.mergeRetries`) which,
>     on a non-fast-forward, re-runs the rebase and retries INSTANTLY with NO sleep,
>     citing `claim-cas.ts`. Do NOT fold into that loop (it keys off a non-ff PUSH;
>     ours keys off a rebase CONFLICT) — copy its instant, capped,
>     re-fetch-and-rebase shape and its needs-attention give-up. NOTE WHY that loop
>     re-runs `rebaseOntoMainWithReconcile()` not a bare rebase: it carries
>     sibling-ledger + divergent-done-move arms a bare re-rebase would MISS — you
>     must DECIDE whether the recovery re-rebase needs those arms (see "Reconcile
>     arms" below).
>   - Note there are OTHER rebase sites on the continue/integration path (the
>     continue-branch module's `rebaseContinuedBranchOntoMain` and its stale-lease
>     retry loop, and any Race-1 merge-push retry). This task's REQUIRED scope is
>     the `recoverAlreadyCommitted` recovery rebase. If the SAME moving-base race
>     applies one-shot at another of those sites, you MAY extend the same bounded
>     re-fetch+retry there too, but keep it minimal and call it out in the done
>     record; do NOT refactor those loops' existing semantics.
>
> The change: replace the single `fetch → rebase → (conflict ⇒ abort+return)` with
> a bounded CONTENTION loop — for up to a small cap: re-fetch `<arbiter>/main` (it
> may have advanced), rebase; on clean → break and integrate; on conflict →
> `--abort`, a SMALL jitter sleep, try again. After the cap is exhausted and it
> STILL conflicts → return `'rebase-conflict'` / needs-attention exactly as today.
> ALWAYS `--abort` on conflict (never leave mid-rebase); NEVER `--force`; NEVER
> auto-resolve. The `already-integrated` short-circuit stays BEFORE the loop. This
> is the instant-retry contention shape (re-fetch + rebuild against the new base),
> NOT exponential outage backoff.
>
> JITTER (REQUIRED — concurrent-runner livelock break, NOT outage backoff): pure
> instant retry has a real hazard — two runners that begin retrying at the same
> instant re-fetch and re-rebase in lockstep, each moving the base the other just
> rebased onto, and can livelock. So insert a SMALL randomized delay (jitter)
> before each re-attempt: just enough temporal SPREAD to de-correlate two racers,
> bounded and tiny (a few-hundred-ms-order contention nudge), explicitly NOT the
> exponential `retryWithBackoff` schedule. Put the sleep behind an INJECTABLE seam
> (reuse `Sleep`/`realSleep` from `retry-backoff.ts`, or the `sleep` seam `run.ts`
> uses) and make the RNG injectable/seedable, so a test injects zero/fixed jitter
> or a seeded RNG and drives the timeline deterministically. Do NOT make jitter
> non-injectable/non-deterministic for tests.
>
> RECONCILE ARMS (REQUIRED decision): the recovery tail uses a BARE `git rebase`
> today; the build path uses `rebaseOntoMainWithReconcile()` because a bare
> re-rebase MISSES the sibling-ledger + divergent-done-move arms. Now that this
> loop re-fetches a possibly-advanced main mid-loop, DECIDE whether the recovery
> re-rebase needs those arms (reuse the SAME path — no second copy) or is
> deliberately bare (the recovery tail integrates an already-done-moved branch, so
> they may not apply), and RECORD the decision + reasoning in Decisions. Do not
> leave it bare by accident.
>
> Compose with rename detection: if `disable-rename-detection-on-continue-rebase`
> has landed, ensure each rebase invocation INSIDE the loop carries the same
> rename-off option (don't regress it); if not, write the rebase call so the option
> slots in cleanly later. The two fixes target ORTHOGONAL failure modes
> (spurious-directory-rename conflict vs moving-base content race) — keep them
> separable.
>
> Test seams (throwaway repos + local `--bare` `file://` arbiter, mirror
> `integration-core.test.ts` / `autonomous-recovers-stranded-done.test.ts` helper
> style):
>   1. MOVING-BUT-COMPATIBLE base is absorbed: arrange the recovery so the first
>      rebase conflicts but a re-fetched later attempt is clean (e.g. main gains a
>      non-conflicting commit between attempts via a fetch/rebase shim or an arbiter
>      that advances between attempts), and assert it integrates within the cap and
>      does NOT route to needs-attention.
>   2. GENUINE persistent conflict is preserved: a real same-path content conflict
>      that re-occurs on every fresh-fetched attempt STILL exhausts the cap and
>      STILL returns `'rebase-conflict'` / needs-attention; assert it does not loop
>      unboundedly and the kept commit is intact on the branch.
>   3. JITTER de-correlates re-attempts: with the injected `sleep` seam capturing
>      delays, assert a non-zero randomized spread is applied before re-attempts
>      (NOT a fixed/zero delay, and NOT an exponential `delay * 2` schedule — a
>      small contention jitter), and that a fixed/seeded jitter injection keeps the
>      captured timeline reproducible.
>
> RECORD the in-scope decisions in a `## Decisions` block (done record / PR, or an
> ADR if it meets the ADR gate per `ADR-FORMAT.md`): the cap and why; that this is
> the CONTENTION model (instant re-fetch+rebuild, like `claim-cas.ts` / Race-1) and
> NOT the OUTAGE `retryWithBackoff` exponential backoff, with WHY they are distinct;
> the JITTER as a small livelock-breaking contention spread (not outage backoff);
> that re-fetch happens EACH attempt (stale single fetch is the root cause); the
> transient-vs-genuine split (absorb moving base, surface persistent conflict); the
> reconcile-arms decision; and the orthogonality to the rename-detection task.
>
> Done = the recovery rebase absorbs a transient moving-`arbiter/main` race within a
> bounded re-fetch+retry; a genuine persistent conflict still routes to
> needs-attention; the `already-integrated` no-op is unchanged; main is never
> forced and conflicts are never auto-resolved; all three tests above pass; the
> exit/contract decisions are recorded; and `pnpm -r build && pnpm -r test &&
> pnpm format:check` is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim recovery-rebase-retry-against-moving-arbiter-main --arbiter <remote>
# then start work on the updated main:
git fetch <remote> && git switch -c work/recovery-rebase-retry-against-moving-arbiter-main <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/recovery-rebase-retry-against-moving-arbiter-main.md work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md
```

---

## Decisions

> **Note.** This block is a POST-HOC transcription added by the follow-up task
> `transcribe-recovery-rebase-retry-decisions-block` (Gate-2 review of PR #225
> flagged that the acceptance criterion's `## Decisions` block was recorded ONLY
> in code comments inside `packages/dorfl/src/integration-core.ts`, not on this
> done-record). The task was already merged as PR #225 (commit `d1ab93c`, body
> empty); this record is the protocol-native home for the decisions. Wording is
> sourced verbatim from the code comments where practical.

### Cap chosen and why

`DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts). Ratified as a
conservative CONTENTION cap; overridable via `params.recoveryRebaseRetries`.
From the doc-comment on the constant:

> Small on purpose — a few attempts ride out an `advance` burst (each burst is
> tens of commits over a few seconds); a real conflict surfaces fast. […] Tests
> inject `recoveryRebaseRetries: 0` (no retry — the legacy one-shot shape) or a
> small explicit cap (assert the cap exhausts deterministically).

Deliberately a DIFFERENT shape from the Race-1 merge-push cap
(`DEFAULT_MERGE_RETRIES = 1000`, a liveness ceiling on a `non-fast-forward`
contention loop). Revisit only if a real incident shows bursts outlasting 5
fresh-fetched attempts.

### Contention vs. outage

Verbatim from the doc-comment on `DEFAULT_RECOVERY_REBASE_RETRIES` and the
block-comment above the recovery retry loop:

> This is the CONTENTION model (instant re-fetch+rebuild, like `claim-cas.ts`
> and the Race-1 merge loop above), NOT the OUTAGE model in `retry-backoff.ts`
> (exponential temporal backoff, the remote may come back). The two failure
> classes are deliberately kept SEPARATE; do not substitute `retryWithBackoff`
> here.

And, on WHY re-fetch happens on EACH attempt:

> On each conflict `--abort`, sleep a small jitter, RE-FETCH `<arbiter>/main`
> (it may have advanced — `advance` runs land bursts of `advance: surface
> observation:…` commits on main, so a one-shot rebase against a stale fetched
> base can conflict against a main that already moved AGAIN), then re-rebase.
> Only after the cap exhausts (a freshly-fetched main STILL conflicts on every
> attempt) do we surface `rebase-conflict` (never auto-resolved, NEVER `--force`
> to main — the kept commit stays on the branch, recoverable; the human
> resolves and re-runs).

Transient (moving base) is absorbed by a later attempt; genuine (persistent
conflict against fresh main) exhausts the cap → needs-attention. The bounded
retry against a freshly-fetched base IS the discriminator; there is no
up-front classification signal (a rebase CONFLICT carries no `non-fast-forward`
analogue).

### Jitter

`DEFAULT_RECOVERY_REBASE_JITTER_MS = 100`. Verbatim from its doc-comment:

> **Default max jitter (ms)** between recovery-rebase attempts — a SMALL
> livelock-breaking SPREAD between concurrent runners (NOT exponential outage
> backoff). Pure instant retry has a real hazard: two runners that begin
> retrying at the same instant re-fetch and re-rebase in LOCKSTEP, each moving
> the base the other just rebased onto, and can livelock. A uniformly-random
> `[0, mergeJitterMs]` ms sleep before each re-attempt de-correlates the two
> racers. Bounded and tiny — a contention nudge, not an outage wait. Tests pass
> `recoveryRebaseJitterMs: 0` for a deterministic latency-free loop, OR inject
> the `sleep`/`random` seams to drive the timeline reproducibly with a seeded
> RNG.

Sleep is behind the INJECTABLE `Sleep`/`realSleep` seam from `retry-backoff.ts`
(`params.recoveryRebaseSleep`); the RNG is behind `params.recoveryRebaseRandom`.

### Reconcile-arms decision (recovery re-rebase is deliberately BARE)

Verbatim from the block-comment above the retry loop:

> RECONCILE ARMS DECISION (this task): the recovery rebase is deliberately
> BARE — it does NOT layer the sibling-ledger / divergent-done-move arms the
> build path's `rebaseOntoMainWithReconcile()` carries. Reasoning: this tail
> integrates a branch whose done-move was ALREADY committed in a prior run, so
> there is no first-time slug relocation on THIS commit for the divergent-
> done-move reconcile to act on, and a sibling-slug ledger conflict on the
> re-fetched main is the same shape it would have hit on the original run (the
> recovery is not the place to grow new reconcile semantics).

Ratified as load-bearing. If a divergent-done-move case is later observed IN
the recovery path, reuse the SAME `rebaseOntoMainWithReconcile()` path — do NOT
fork a second copy.

### Rename-detection orthogonality

Status at the time of this transcription (2026-07-07) — the world moved between
PR #225 landing and this transcription; the current reality is recorded here
rather than the launch-time snapshot:

- The initial sibling attempt, PR #224
  (`disable-rename-detection-on-continue-rebase`), was CLOSED UNMERGED because
  it used the WRONG git knob (`-Xno-renames` / `merge.renames=false` /
  `diff.renames=false` do NOT suppress the observed DIRECTORY-rename conflict
  `CONFLICT (file location)`; only `-c merge.directoryRenames=false` does,
  verified on git 2.47.3). The task was parked in
  `work/tasks/backlog/disable-rename-detection-on-continue-rebase.md` with a
  CORRECTION banner.
- The CORRECTED sibling has since landed as PR #256
  (`feat(disable-rename-detection-on-continue-rebase)`, commit `808e77c7`),
  slotting `-c merge.directoryRenames=false` into the `rebaseArgs()` thunk this
  task left in `recoverAlreadyCommitted`. At the moment of this transcription
  the thunk therefore reads:

  ```ts
  const rebaseArgs = (): string[] => [
      '-c', 'merge.directoryRenames=false',
      'rebase', `${arbiter}/main`,
  ];
  ```

  Verbatim from the current in-code block-comment (post PR #256):

  > Content-rename detection (`-Xno-renames`/`merge.renames`/`diff.renames`) is
  > the WRONG knob and was verified ineffective for this directory-rename
  > conflict; only `merge.directoryRenames=false` suppresses it. NEVER a
  > persistent `git config` write — the repo's config stays clean. A GENUINE
  > same-path content conflict still surfaces and still routes to
  > `rebase-conflict` (the user's interactive `git rebase` is unaffected).

Orthogonality of the two failure modes is preserved: rename-off kills spurious
directory-rename conflicts; the bounded re-fetch+retry absorbs moving-base
races. Neither masks the other.

> Deviation note for the reviewer: the parent task's Context section (written
> before PR #256 landed) said "the `rebaseArgs()` thunk this task left in
> `integration-core.ts` on `main` therefore does NOT yet carry any rename-off
> option". That premise is now stale — the corrected sibling has since landed
> and the thunk carries `-c merge.directoryRenames=false` today. This block
> records CURRENT reality (which the code comments now describe) rather than
> the launch-time snapshot.

## Follow-ups (opportunistic, low priority — no dedicated task)

- **Unify the Race-1 merge-push jitter onto the injectable `Sleep` seam.** The
  Race-1 loop currently uses the local non-injectable `sleepMs` helper in
  `integration-core.ts` (kept for byte-for-byte compatibility with existing
  tests, per its doc-comment: *"The recovery-rebase loop uses the INJECTABLE
  `Sleep` seam from `retry-backoff.ts` instead, so its timeline is
  test-driveable."*). The new recovery seam is strictly better (RNG also
  injected/seedable). Fold Race-1 onto the same `Sleep`/`random` seams NEXT
  TIME that code is touched. Not worth minting dedicated work for.

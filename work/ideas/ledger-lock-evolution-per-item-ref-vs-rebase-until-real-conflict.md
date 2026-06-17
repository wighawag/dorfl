---
title: Evolving the ledger LOCK/CLAIM mechanism, resolve false contention + branch-inheritance + cross-action exclusion, weighing rebase-until-real-conflict vs per-item refs vs the decided co-located .lock.md
slug: ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict
type: idea
status: incubating
---

> Design exploration (2026-06-17). DESIGN ONLY, no lock/CAS code was touched. Weighs every candidate
> on record (current flat marker; the DECIDED co-located `.lock.md`; the earlier-REJECTED off-main ref
> D4; the rebase-until-real-conflict CAS) plus ones derived here, against the core tension (in-tree
> visibility vs freedom-from-whole-ref-contention-and-branch-inheritance) and the must-preserve
> invariants. Ends in a recommendation, the cross-action-exclusion answer, a migration story, and an
> explicit statement of what it supersedes. Becomes a PRD only on maintainer confirmation (it proposes
> RETIRING a decided PRD decision, see `## Supersedes`). The recommendation was adversarially
> stress-tested (an oracle pass) and the write-up below already folds in the three honesty corrections
> that pass produced, they are flagged inline as "(corrected after adversarial review)".
>
> Evidence read first (all verified against code 2026-06-17): the four observations
> (`advancing-lock-cas-false-conflicts-on-shared-main-ref-under-high-parallelism`,
> `ledger-cas-leases-on-whole-main-ref-so-nonconflicting-claims-falsely-contend-rebase-until-real-conflict-may-fix-in-tree`,
> `work-branch-carries-stale-advancing-marker-and-on-branch-needs-attention-move-not-dropped-on-continue`),
> `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`, `work/prd/folder-taxonomy-reorg-and-rename.md`,
> `work/prd/branch-carries-code-not-ledger-status-main-owns-status.md`, and the code: `ledger-write.ts`
> (`currentLedgerWrite.applyTransition`, the whole-ref lease, `stampNonce`, `publishSurfaceCommit`),
> `advancing-lock.ts`, `claim-cas.ts`, `slicing-lock.ts`, `retry-backoff.ts`, `drop-bookkeeping-rebase.ts`,
> `docs/adr/claim-ledger-vs-protected-main.md`.

## TL;DR (the recommendation up front)

**Adopt "rebase-until-real-conflict" as the contention-retry model FOR THE FOUR ACQUIRE/CREATE PATHS
(claim, slicing-acquire, advancing-acquire, create), and KEEP every lock/marker/move in main's tree.**
For those four paths a "real conflict" is an EXACT same-path existence check the code already runs
each attempt, so a losing replay is provably clean and should loop to success rather than count
against a tiny give-up budget. This dissolves the false-contention problem (issue 1) at the single
primitive, with NO new ref, NO loss of in-tree visibility, NO provider story to rewrite, and NO change
to atomicity/crash-safety. It is the one move that fixes the verified, biting failure (CI exit-3 under
~33-way parallelism) at its root rather than papering it with backoff+jitter+budget tuning.

It does NOT, by itself, fix branch-inheritance (issue 2). But issue 2 is **already owned and nearly
solved** by `branch-carries-code-not-ledger-status-main-owns-status` (status lives on main; branch
carries code). The ONE residual gap is that that PRD removes on-branch *needs-attention* moves but
not the inherited *advancing marker*. The elegant closure is to **fold the advancing marker into the
branch-carries principle's drop-set** (a kept branch's tree never legitimately carries a
`work/advancing/*` marker, so strip it on continue/rebase). No marker moves off main.

For **cross-action exclusion** (issue 3): a single unified per-item lock is **NOT needed**. Keep the
three distinct locks; add an ADVISORY precedence rule at the existing eligibility gate (one action per
item), and name the slicing-release content-identity stale check as the one ATOMIC backstop. This
closes the common case; the advance∥claim simultaneous-acquire race is a documented, recoverable
residual (truly-atomic exclusion there WOULD need a narrow shared per-item key, the one place the
rejected unification has a real argument, but is deferred as rare + recoverable, not free).

**This RETIRES the decided co-located `<slug>.lock.md` relocation** (taxonomy PRD US #10–14, the
`LEADING RESOLUTION` in the taxonomy idea) as a *contention/inheritance* fix, because it fixes
neither (it is still a tree file on main, arguably MORE exposed to inheritance). It MAY survive purely
as an *ergonomics* choice if the maintainer still wants it, decoupled from this concurrency work. See
`## Supersedes`.

## The problem space, restated precisely (what the code actually does)

ONE primitive underlies every ledger mutation: `ledgerWrite.applyTransition` (`ledger-write.ts`). It
stamps the prepared micro-commit with a per-attempt `CAS-Nonce` trailer (so the pushed sha is unique , 
correct, and orthogonal to contention) and pushes:

```
git push <arbiter> <nonced>:main --force-with-lease=main:<expectedBase>
```

then verifies `<arbiter>/main === <nonced>`. The lease is on the **whole main ref**: it rejects if
main moved AT ALL since `<expectedBase>`, regardless of which path changed. The *caller* (claim /
slicing / advancing / create) owns the retry loop: on `rejected`, re-fetch, re-branch off the new
main, re-stage the SAME move/marker, re-push, capped at `retries` (default **3**), with **NO backoff
and NO jitter** (confirmed: `retry-backoff.ts` is explicitly NOT used for the contention loop, it is
for network OUTAGE only). Exhausting the cap → exit 3 `push rejected N times (main is contended)`.

Three interacting issues, all verified:

1. **FALSE CONTENTION.** Two writers touching DIFFERENT files (claim of A; claim of B; advancing
   marker for C) both lease against the same base; the first ff's main, the rest are rejected by the
   whole-ref lease even though nothing tree-conflicts. Under ~33-way CI parallelism the 3-retry budget
   is exhausted → exit 3. The losing re-stage is, for the acquire paths, ALWAYS a clean replay (a
   move/marker for X never tree-conflicts with main advancing because of Y), so the contention is a
   **budget artifact, not a fundamental conflict**.

2. **BRANCH INHERITANCE.** Lock markers / status files live in main's TREE. A work branch cut from
   main inherits whatever was in main's tree at the branch point, including a `work/advancing/<entry>.md`
   marker committed onto main while the lock was held at claim time. `drop-bookkeeping-rebase.ts`
   strips the on-branch `route-to-needs-attention` move by trailer but has **NO** advancing-marker
   handling, so a continue/rebase hits a rename/rename ledger conflict. (CONFIRMED gap: the
   `branch-carries-code...` PRD removes the on-branch needs-attention move but does not mention the
   advancing marker.)

3. **NO CROSS-ACTION EXCLUSION.** claim / slicing / advancing are independent markers/moves on
   DISTINCT branches+refs (`claim/<slug>`, `slicing/<slug>`, `advancing/<entry>`) that do not read
   each other. So an item could be claimed-and-built while it is being advanced (answered/triaged),
   risking loss of the advance's edit. Open question, not a fixed requirement.

## The must-preserve invariants (the scoring axes)

- **A, Atomicity / no lost update.** Exactly one winner per genuine conflict; a loser is cleanly told
  "lost" and never silently overwrites. (`CAS-Nonce` + post-push verify make this authoritative , 
  preserve it.)
- **B, Crash-safety.** A failed run never orphans a lock in a corrupt state; recovery exists
  (`advancing-lock-release-crash-safe` landed; `release-advancing <slug>` + `gc --ledger` report).
- **C, Human-recoverability.** A stuck lock is nameable and clearable; the report surfaces it
  (`ledger-lint.ts` `listAdvancingMarkers` → `gc --ledger`).
- **D, Provider-agnosticism.** Works on a bare `--bare file://` arbiter, not just GitHub. KILL
  CRITERION per the ADR.
- **E, Visibility.** A human reads `work/` to see backlog / in-progress / advancing. Load-bearing for
  slices/PRDs; negotiable for advancing (per the maintainer).
- **F, NEVER `--force` to main.** Only leased CAS fast-forwards of throwaway-off-main ledger commits.
- **G, Elegance / one-primitive.** Prefer ONE primitive that dissolves multiple problems over a stack
  of mitigations. The fallback to BEAT is backoff+jitter+budget+stale-marker-cleanup+concurrency-cap.

## The candidates

### C0, CURRENT (flat marker, whole-ref CAS, give-up-after-N). The baseline to beat.

Flat `work/advancing/<entry>.md`; claim/slicing are `git mv` on main; all ride the whole-ref lease
with a 3-retry give-up.

- A ✔ B ✔ C ✔ D ✔ E ✔ F ✔, all invariants hold TODAY. The ONLY defects are issues 1–3.
- G ✘, the contention failure is real and biting (exit 3 at 33-way). Branch-inheritance is real.

### C1, INELEGANT MITIGATION STACK (the fallback to beat).

Bigger retry budget + exponential backoff WITH jitter + a concurrency cap on the CI matrix
(`max-parallel`) + stale-marker GC.

- A ✔ B ✔ C ✔ D ✔ E ✔ F ✔.
- G ✘✘, it does not fix the contention, it *raises the ceiling and slows the herd*. Every knob is a
  tuning liability against an unknown future matrix width; the concurrency cap throws away parallelism
  the design otherwise supports; it leaves a KNOWN-clean replay able to fail. **Reject as the primary
  fix.** (A modest budget bump + jitter survives as a SECONDARY *inside* C2, see C2's liveness note , 
  but never as the model.)

### C2, REBASE-UNTIL-REAL-CONFLICT (keep everything in tree; change only the retry semantics). ★

> **SCOPE (load-bearing, corrected after adversarial review): C2 applies to the FOUR ACQUIRE/CREATE
> paths ONLY**, claim, slicing-acquire, advancing-acquire, create. For these, "real conflict" is an
> EXACT same-path existence check (`cat-file -e` of the target path on the new main) that the code
> already runs every attempt, so a clean replay is provably conflict-free. **The SLUG-RELOCATION
> family (needs-attention surface, requeue, resolve, slicing RELEASE) is DELIBERATELY EXCLUDED from
> "loop-until-clean."** Those relocate a slug FROM wherever it is on main TO a target folder
> (`publishSurfaceCommit` force-removes the slug from every `WORK_FOLDERS` entry and re-adds at the
> target), so their genuine conflict is "the slug is no longer in the SOURCE folder I expect" (a
> concurrent requeue/resolve/complete moved it), NOT same-path existence. An unbounded replay there
> would CLOBBER a concurrent legitimate same-slug transition (a lost-update, violating invariant A).
> They keep their EXISTING bounded loops, and each MUST re-assert its source-folder precondition on
> every replay (surface proceeds only if the slug is still in `in-progress/`; else real conflict →
> stop, do not clobber). So C2 is NOT "make every loop patient"; it is precisely "make the four
> same-path-keyed ACQUIRE loops loop on clean replays, and leave the slug-relocation moves as the
> bounded, precondition-checked operations they already are."

Keep all markers/moves as files on main (full visibility). Change the caller-side retry FOR THE FOUR
ACQUIRE/CREATE PATHS from "optimistic whole-ref lease, give up after N" to: on a `rejected` push,
**re-fetch the new main and REPLAY the prepared move/marker onto it; only give up if the replay hits a
GENUINE same-path conflict** (the slug you are claiming was claimed by someone else; the marker you
are adding already exists; the PRD you are locking left `prd/`). A clean replay is NOT counted against
the genuine-conflict budget, you loop until you land, hit a real conflict, or hit the liveness ceiling.

Crucially, the "real conflict" is **already detectable without git's 3-way merge**, by the existing
pre-CAS claimability checks every acquire path already does:
- `claim-cas.ts` `attempt()` re-checks `cat-file -e <arbiter>/main:work/backlog/<slug>.md` each
  attempt, if gone, it returns **`lost` (exit 2)** definitively, NOT contended. So a claim ALREADY
  distinguishes "main moved, my file still claimable" (false conflict, retry) from "my file is taken"
  (real conflict, stop).
- `advancing-lock.ts` `acquireAttempt()` re-checks marker absence; `createItemThroughCas` re-checks
  path absence; `slicing-lock.ts` `acquireAttempt()` re-checks the PRD still in `prd/`. Same shape.

So the change is SMALL and LOCAL: in each of the four acquire loops, a `rejected` push whose next
claimability re-check still shows the target FREE should LOOP (not count against a tiny budget); a
real conflict already short-circuits to `lost`. The defect today is purely that the loop is capped at
3 and counts every false conflict toward the cap.

**Liveness, the HONEST guarantee (corrected after adversarial review).** Termination is provable in
the pure cases: N contenders for N DIFFERENT items each land in turn (worst case N serialized
round-trips); N for the SAME item → N-1 get a definitive `lost` on their next re-check. BUT the
realistic CI case is MIXED: N writers on N different items WHILE main also advances from unrelated
integration merges (the observation names a sibling job's integration as the trigger). In that mixed
regime the bare loop has no fairness guarantee, a slow loser can be rejected by a DIFFERENT winner
each round as long as other successful pushes arrive faster than its own fetch→stage→push round-trip.
That is classic CAS livelock/starvation on a single hot ref. So the honest claim is NOT "no budget, no
exit-3 ever." It is: **a clean replay never consumes the genuine-conflict budget (the categorical
defect C2 removes), and a SEPARATE large liveness ceiling bounds the pathological livelock tail.** The
win is decisive, exit-3 stops being a ROUTINE contention signal (which it is today at 33-way, because
every false conflict counts against a budget of 3) and becomes a RARE livelock signal, but it is a
change of KIND in the common case plus a change of MAGNITUDE in the tail, not the literal elimination
of any ceiling. **Jitter on the refetch is therefore load-bearing, not belt-and-braces:** under
sustained 33-way load an instant lockstep refetch→push loop maximises mutual rejection (a thundering
herd), fattening the tail; modest jitter desynchronises the herd. This is the ONE part of C2 that
overlaps C1. The part that makes C2 CORRECT rather than merely tuned is the termination CONDITION (the
existing `lost` re-check is the real terminator; clean replays do not count), categorically different
from C1's "raise the budget + add backoff + cap the matrix."

- **A ✔**, unchanged: nonce + verify still make each landing authoritative; a real same-slug race
  still yields exactly one winner (the loser's re-check sees the file taken → `lost`). (A is at risk
  ONLY if the slug-relocation family is wrongly folded in, which the SCOPE box forbids.)
- **B ✔ C ✔**, crash-safety/recoverability are about the release path + the GC report, neither touched.
- **D ✔**, still `--force-with-lease` to main on any arbiter incl. `--bare file://`. No new ref, no
  server rules.
- **E ✔✔**, FULL in-tree visibility preserved. `work/` still shows everything.
- **F ✔**, still leased CAS ff, never `--force`.
- **G ✔✔**, ONE retry-semantics change dissolves issue 1 for claim AND slicing-acquire AND
  advancing-acquire AND create at once, no new concepts. This is the elegant fix for issue 1.

Does it fix issue 2 (branch-inheritance)? **No**, a marker committed onto main is still inherited by
a branch cut from main. Separate axis, closed by C5.

Does it fix issue 3 (cross-action exclusion)? **No**, orthogonal (see `## Cross-action exclusion`).

### C3, OFF-MAIN PER-ITEM REF (the earlier-REJECTED D4, reopened).

Move the advancing marker (and potentially claim/slicing) OFF main's tree onto dedicated git refs , 
e.g. `refs/agent-runner/advancing/<entry>` whose existence IS the lock (create-only push). No file in
main's tree.

- **A ✔**, a create-only / CAS ref push is atomic (one winner).
- **B / C**, recoverability becomes "delete the ref"; a NEW recovery surface + a new GC scan (enumerate
  refs) to build.
- **D ✔**, ref pushes work on `--bare file://`. Passes the kill criterion (why D4 was a *musing*, not
  impossible).
- **E ✘**, DESTROYS in-tree visibility for whatever moves off-main. The maintainer's REOPENING says
  advancing-visibility is recoverable as a GENERATED VIEW (a `status`/`scan` enumerating the refs).
  True, but that is a new command + you can no longer just `ls work/advancing/`. For ADVANCING only,
  acceptable. For CLAIM/SLICING NOT (in-progress / being-sliced visibility are load-bearing).
- **G partial**, it DOES fix BOTH issue 1 (a per-item ref never contends with another item's ref) AND
  issue 2 (nothing in main's tree to inherit) for the things moved off-main. But ONLY for those things,
  and the things that MUST stay in-tree for visibility (claim, slicing) are exactly what issue 1 also
  afflicts, so per-item refs would have to move claim+slicing off-main too to fix THEIR contention,
  sacrificing the visibility the maintainer will not give up.

Verdict: C3 is the right shape for ADVANCING *alone* as an issue-2 alternative, but the WRONG shape
for claim/slicing (kills E). C2 fixes issue-1 contention for ALL of them WITHOUT the visibility cost,
and C5 gives advancing's issue-2 closure for free. So C3 is **dominated by C2+C5** for the in-tree
things and only worth keeping as a fallback if C5's drop-set proves harder than expected.

### C4, DECIDED CO-LOCATED `<slug>.lock.md` (taxonomy PRD US #10–14).

The marker moves from flat `work/advancing/<entry>.md` to a companion `<item-dir>/<slug>.lock.md`
beside the item. Item never moves.

- **A ✔ B ✔ C ✔ D ✔ F ✔**, same CAS, same recovery, same provider story (SAME mechanism, different path).
- **E ✔ (ergonomics)**, one `ls` shows item + lock; an `observations/` item can be locked without
  flowing. The only thing C4 buys.
- **G ✘ for THIS problem**, STILL a tree file on main. Does **NOT** fix issue 1 (still whole-ref-leased
  → false contention) and does **NOT** fix issue 2 (a co-located `tasks/backlog/<slug>.lock.md` is
  inherited by a branch cut from main EXACTLY as the flat marker is, arguably WORSE, since it sits in
  `backlog/` next to the item the branch definitely carries). The taxonomy idea concedes this: "STILL
  a tree file on main, so it does NOT fix contention or branch-inheritance."

Verdict: an **ergonomics/taxonomy** change misfiled as adjacent to a concurrency fix. Must NOT be sold
as fixing issues 1–2. See `## Supersedes`.

### C5, FOLD THE ADVANCING MARKER INTO branch-carries-code (the issue-2 closure). ★

`branch-carries-code-not-ledger-status-main-owns-status` already establishes: **the work branch carries
CODE plus only the atomic `→done` move; main owns ALL ledger status, transitioned tree-lessly.** The
advancing marker is ledger status. The CONFIRMED gap: the PRD enumerates the needs-attention move but
not the advancing marker, and `drop-bookkeeping-rebase.ts` only knows the needs-attention trailer.

The closure (pick one form when slicing):
- **C5a (preferred): extend the `drop-bookkeeping-rebase` drop-set to also strip any `work/advancing/*`
  marker from the kept branch tree** on continue/rebase, keyed STRUCTURALLY (path under the advancing
  namespace), not by a fragile trailer. A stale advancing marker in an inherited tree is, by
  definition, not code, so under the branch-carries principle it belongs in the drop-set. This is the
  SHORT-TERM fix the observation already suggests, made principled by the PRD.
- **C5b (root): main owns the advancing marker tree-lessly; never written through a worktree a branch
  could inherit.** The acquire/release ALREADY use a THROWAWAY scratch branch cut from `<arbiter>/main`
  (confirmed: `acquireAttempt` detaches onto `arbiter/main`, makes a fresh `advancing/<entry>` branch,
  CAS-pushes, then `cleanup` returns + deletes it). So the marker is already authored off the work
  branch. The inheritance happens because a LATER claim branches from a main whose tree still contains
  a marker from an UNRELEASED or crash-orphaned lock, so C5b is C5a's drop-set PLUS making
  `gc --ledger` + `release-advancing` the standing reaper so orphans don't accumulate on main to be
  inherited.

- A ✔ B ✔ C ✔ D ✔ E ✔ F ✔, nothing weakened; pure inheritance-hygiene.
- G ✔, reuses the branch-carries ONE principle + the existing drop-rebase machinery; adds no new
  concept. This is the issue-2 fix. It pairs with C2 (issue 1); they are independent.

## Scoring summary

| Candidate | A atom | B crash | C recov | D bare | E vis | F no-force | G elegance | fixes #1 | fixes #2 | fixes #3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C0 current | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| C1 mitigation stack | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘✘ | ~ ceiling | ✘ | ✘ |
| **C2 rebase-until-real (4 acquire paths)** | ✔ | ✔ | ✔ | ✔ | ✔✔ | ✔ | ✔✔ | **✔** | ✘ | ✘ |
| C3 off-main ref | ✔ | ~ new | ~ new | ✔ | ✘ (moved) | ✔ | ~ | ✔ (moved) | ✔ (moved) | ✘ |
| C4 co-located .lock.md | ✔ | ✔ | ✔ | ✔ | ✔ ergo | ✔ | ✘ here | ✘ | ✘ | ✘ |
| **C5 fold into branch-carries** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | **✔** | ✘ |

The winning COMBINATION is **C2 + C5**: C2 dissolves false contention in-tree (issue 1) with full
visibility; C5 closes branch-inheritance (issue 2) by reusing the branch-carries principle. Neither
needs an off-main ref; neither sacrifices visibility. C3 is dominated. C4 is retired as a concurrency
fix and demoted to optional ergonomics.

## Cross-action exclusion (issue 3), the answer: a unified per-item lock is NOT needed

The maintainer's question: should "advancing", "slicing", "implementing" be mutually exclusive on one
item, possibly by collapsing the three locks into ONE per-item hold? **Answer: no unification; close
the one genuinely-unsafe pair with an ADVISORY precedence rule + the existing atomic backstop.**

Why not collapse into one lock:
- The three holds are SEMANTICALLY different and key DIFFERENTLY. claim and slicing ARE lifecycle moves
  (the file moves `backlog→in-progress`, `prd→slicing`); advancing is a file-ORTHOGONAL marker (item
  never moves) precisely so it can lock items resting in MANY folders (a backlog slice, a `prd/` PRD,
  an `observations/` note) with one mechanism. Collapsing re-introduces the "which folder does the
  move encode" problem the taxonomy idea's `OPEN FORK` rejected (return-destination ambiguity,
  position-shadowing, the observations-don't-flow blocker). One move-based lock cannot represent "this
  backlog slice is being answered AND is still a backlog slice."
- They are already on DISTINCT branches/refs by design, so they never collide at the CAS layer.
  Unifying them onto one ref would make them falsely contend with EACH OTHER, issue 1 at finer grain.

Which overlaps are dangerous, and the minimal closure:
- **claim ∥ slicing on the same slug**: a slice and a PRD can share a slug but are DIFFERENT items
  (`slice:<slug>` vs `prd:<slug>`), disambiguated by the namespace resolver (`slug-namespace.ts`). Not
  a dangerous overlap. ✔ already safe.
- **advance ∥ claim on the SAME item** (the real risk): an item is being answered/triaged (advance
  edits the body / `needsAnswers`) WHILE it is claimed-and-built, the build could integrate over the
  advance's edit. The minimal, in-grain closure (no new lock primitive):
  - **Make holding an advancing marker an ELIGIBILITY/READINESS bar to claiming, and vice-versa.** The
    claim path already has a readiness guard (`resolveReadiness`, human path) and the autonomous runner
    already filters eligibility upstream. Add: an item with a live `work/advancing/<entry>.md` marker on
    main is NOT claim-eligible (autonomous) / is REFUSED with a clear message (human, overridable like
    `blockedBy`). Symmetrically, the advance rung should not take a marker on an item in `in-progress/`.
  - **HONEST about what this rule IS (corrected after adversarial review): ADVISORY mutual exclusion,
    NOT atomic.** It reuses the existing eligibility machinery (no new ref, no unified lock, keeps the
    three holds distinct), BUT it is check-then-act, and the two holds write DIFFERENT paths
    (`work/in-progress/<slug>.md` vs `work/advancing/<entry>.md`), so the whole-ref lease serialises
    them only if their push orderings line up. There is a genuine TOCTOU window: a claim that checks
    "marker absent," then wins its main CAS, can coexist with an advance that acquired the marker in
    the gap (the advance's CAS landed on a different path). So the rule CLOSES THE COMMON CASE (marker
    already present when the claim checks) but does NOT make simultaneous-acquire impossible. Making it
    TRULY atomic would require the two operations to share a CAS keyed on the ITEM, exactly the narrow
    per-item unification this section otherwise rejects. That is the ONE place the rejected unification
    has a real argument; it is deliberately NOT taken because the residual race is rare and the
    dangerous edit is recoverable (next), not because it is free.
  - **The only ATOMIC backstop today covers advance∥SLICING, not advance∥CLAIM.** The slicing-release
    content-identity stale check (`slicing-lock.ts`, exit 4 `stale`) genuinely detects a concurrent
    edit landed under the slicing lock and fails loud, an atomic backstop for advance∥slicing. There
    is NO equivalent atomic backstop for advance∥claim today: the advisory bar closes the common case,
    and the simultaneous case relies on the build's integration-time rebase surfacing a conflict (or,
    accepted residual risk, the advance edit overwritten by a concurrent build and detected only at
    integration). So the rule is "at most one ACTION per item, enforced ADVISORILY at the eligibility
    gate, with the slicing-release stale check as the one atomic backstop", precedence, not fusion.

So the cross-action answer: **keep three distinct locks; add an advisory precedence rule (one action
per item) reusing readiness/eligibility; lean on the slicing-release stale check as the already-built
atomic backstop; document the advance∥claim simultaneous-acquire race as a rare, recoverable
residual.** Do NOT collapse into one lock. If the maintainer later wants a single "is this item held
by anything?" view, that is a generated VIEW over the three refs/markers, not a unified lock. And IF
truly-atomic advance∥claim exclusion is later judged necessary, the narrow answer is a shared per-item
CAS key for that one pair, a targeted unification, not a collapse of all three.

## Migration / compat story for in-flight markers

- **C2 (rebase-until-real-conflict)** is a pure retry-semantics change with NO on-disk format change,
  so there is NOTHING to migrate: existing markers/moves are untouched; the only observable change is
  that legs that USED to exit-3 under contention now land. Backward-compatible by construction.
- **C5 (advancing marker in the drop-set)**: the drop-set keys on the *structural* "lives under the
  advancing-marker namespace" via the existing `advancingMarkerPath`/`listAdvancingMarkers` seam (the
  single source of marker addressing, built by the crash-safety slices precisely so the location can
  move in one place). In-flight stale markers on existing kept branches are stripped on the next
  continue/rebase, exactly the recovery the observation wanted; no manual migration. Orphan markers
  already on main are cleared by `release-advancing <item>` + surfaced by `gc --ledger`.
- **No marker moves off main**, so there is no "drain the off-main refs" migration, no dual-read
  window, no `--bare` re-test of a new substrate. A major simplicity win of C2+C5 over C3.

## Supersedes / relationship to existing artifacts

- **RETIRES the co-located `<slug>.lock.md` relocation as a contention/inheritance fix** (taxonomy PRD
  `folder-taxonomy-reorg-and-rename` US #10–14; the `LEADING RESOLUTION 2026-06-16` and marker-format
  decision in `folder-taxonomy-and-prd-edit-handshake.md`). It fixes neither issue 1 nor issue 2 (still
  a tree file on main, by its own admission, and arguably MORE inheritance-exposed). RECOMMENDATION:
  drop US #10–14 from the taxonomy PRD's concurrency justification. The co-location MAY remain as a pure
  *ergonomics* item IF the maintainer still values it, then a cosmetic sibling of the folder reorg, NOT
  part of this concurrency work, NOT required by it. Decision left to the maintainer; this idea's stance
  is "decouple it; it was solving the wrong axis."
- **REOPENS and then RE-CLOSES the off-main ref rejection (D4)**: D4 was rejected for destroying
  visibility; reopened because advancing-visibility is recoverable as a view. This idea agrees D4 is
  *viable* for advancing alone (passes the `--bare` kill criterion) but concludes it is DOMINATED by
  C2+C5 (same two issues fixed WITHOUT a new ref, a new view command, or any visibility loss). So D4
  stays rejected, now on stronger grounds (a better in-tree option exists), not the old "visibility is
  sacred" grounds.
- **EXTENDS `branch-carries-code-not-ledger-status-main-owns-status`**: adds the advancing marker to
  that PRD's "main owns ALL ledger status, branch carries code" scope (C5). When that PRD is sliced,
  its drop-rebase removal/replacement should account for the advancing marker too. Coherent, not
  contradictory.
- **Composes with the taxonomy reorg's Phase-0 `work-layout` centralization**: C2/C5 do not depend on
  the reorg, but if its single-source path module lands, the drop-set's "under the advancing namespace"
  predicate reads cleaner from it. No ordering dependency either way.
- **Self-contained vs the crash-safety PRD**: that PRD has LANDED (`advancing-lock-release-crash-safe`,
  `advancing-lock-human-release-verb-and-surface`, `advancing-lock-borrow` in `work/done/`), so the
  `advancingMarkerPath`/`listAdvancingMarkers` seam C5 leans on already exists.

## Honest trade-offs of the recommendation (C2 + C5)

- **C2 raises the worst-case LATENCY of a heavily-contended claim** (more serialized round-trips instead
  of a fast give-up). Correct trade: a slow-but-successful claim beats a fast-but-failed one (exit 3
  today forces a CI re-run anyway, strictly slower AND noisier). The liveness ceiling bounds the
  pathological case.
- **C2 needs a crisp per-kind "genuine same-path conflict" = the EXISTING claimability re-check** (not a
  new git 3-way merge), or it risks treating a real conflict as replayable (lost-update, violates A).
  Mitigation: every acquire caller ALREADY has the right re-check; C2 must reuse it and add NO new
  conflict-detection path. This is the single careful spot; the test surface is the existing claim/CAS
  race tests extended to high fan-out (two racers same item → exactly one `lost`; two racers different
  items → both land, zero exit-3).
- **C2 must NOT be applied to the slug-relocation family** (surface/requeue/resolve/slicing-release).
  Those need a source-folder precondition recheck, not unbounded replay (see the SCOPE box). Folding
  them in is the one near-fatal mistake to avoid.
- **C5 leaves a window** where an orphaned advancing marker sits on main until a human runs
  `release-advancing` or it is dropped on the next continue. Unchanged from today (no heartbeat, no
  auto-reaper, by deliberate design, confirmed in `listAdvancingMarkers`' docstring). C5 only ensures
  it never CONFLICTS a rebase; it does not auto-clean main. Acceptable and consistent with the existing
  "human asserts liveness" model.
- **Issue 3's precedence rule is advisory for advance∥claim** (rare residual race), atomic only for
  advance∥slicing (via the existing stale check). Bundling truly-atomic advance∥claim exclusion would
  reopen a narrow unification and widen the blast radius; keep it deferred.

## Disposition

Incubates as an idea because it proposes RETIRING a decided PRD decision (the co-located `.lock.md`)
and EXTENDING another (branch-carries), both maintainer calls. On confirmation, the actionable form is
three slices (likely across one new PRD + the existing branch-carries PRD):

1. **C2 rebase-until-real-conflict (the four acquire paths)**, change the contention-retry semantics
   in the claim/slicing-acquire/advancing-acquire/create loops (or push a retrying variant into the
   `applyTransition` seam) so a clean replay (the existing claimability re-check still shows the target
   free) loops to success and only a genuine same-path conflict gives up; keep a large liveness ceiling;
   add modest refetch jitter. EXPLICITLY leave the slug-relocation family on their bounded,
   precondition-checked loops. Acceptance: existing race tests + a high-fan-out test proving N
   different-item writers all land with zero exit-3, and a same-item race still yields exactly one
   winner. Pure, gate-verifiable, no format change. **Highest-value, lowest-risk, directly kills the
   verified CI failure.**
2. **C5 advancing-marker inheritance closure**, fold the advancing marker into the branch-carries
   drop-set (strip `work/advancing/*` from a kept branch's tree on continue/rebase) via the existing
   `advancingMarkerPath`/`listAdvancingMarkers` seam; land WITH or AFTER the branch-carries PRD so they
   share the principle. Acceptance: a kept branch carrying a stale advancing marker continues/rebases
   cleanly (no rename/rename ledger conflict).
3. **Cross-action precedence (issue 3, optional/lower priority)**, an advancing-marker-held item is not
   claim-eligible and vice-versa, enforced ADVISORILY at the existing eligibility/readiness gate; the
   slicing-release stale check remains the atomic backstop; the advance∥claim simultaneous race is
   documented as a recoverable residual. Acceptance: a race between advance and claim on one item is
   serialized in the common case (one is refused/skipped), the advance edit is never silently lost in
   the common case.

Sequence 1 first (the biting failure, independent of everything). 2 with/after branch-carries. 3 last,
only if the maintainer wants the exclusion (the brief leaves "is it even necessary" open, the
recommendation is "nice-to-have, not urgent, cheap as a precedence rule, NOT worth a lock unification").

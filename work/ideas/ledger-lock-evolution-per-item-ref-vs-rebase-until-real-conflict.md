---
title: Evolving the ledger LOCK/CLAIM mechanism, resolve false contention + branch-inheritance + cross-action exclusion, weighing rebase-until-real-conflict (C2) vs the C5/C6 fork (drop-set vs a partial dedicated status ledger ref) vs per-item refs vs the decided co-located .lock.md
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

> **The answer is a FUNCTION of one dial: is HUMAN WORKING-TREE VISIBILITY (invariant E) required?**
> The document now derives the best design for BOTH requirement sets (see `## Requirement SETS`).
> - **Set 1 (E kept, default):** `C2 + (C5 or C6)`, keep status where a human can `ls` it; the C5/C6
>   fork is the only open call. Detailed below as the original analysis.
> - **Set 2 (E dropped, maintainer-requested exploration 2026-06-17):** `C2 + C7`, put the WHOLE `work/`
>   state machine on ONE dedicated ledger ref and make `main` code-only. This is strictly cleaner (it
>   deletes branch-inheritance, the `→done` on-branch exception, the drop-rebase machinery, and every
>   visibility-forced marker/move exception in one substrate move, and incidentally unblocks
>   protected-main), and is ONLY available because E is dropped. See `## Best design under Requirement
>   Set 2`.
> - **Common to BOTH sets: build C2 first.** It is the per-ref contention fix, needed on `main` (Set 1)
>   or the ledger ref (Set 2) either way, and it kills the verified CI failure immediately while
>   committing you to nothing about the visibility decision.

**[Set 1 framing] Adopt "rebase-until-real-conflict" as the contention-retry model FOR THE FOUR ACQUIRE/CREATE PATHS
(claim, slicing-acquire, advancing-acquire, create), and KEEP every lock/marker/move in main's tree.**
For those four paths a "real conflict" is an EXACT same-path existence check the code already runs
each attempt, so a losing replay is provably clean and should loop to success rather than count
against a tiny give-up budget. This dissolves the false-contention problem (issue 1) at the single
primitive, with NO new ref, NO loss of in-tree visibility, NO provider story to rewrite, and NO change
to atomicity/crash-safety. It is the one move that fixes the verified, biting failure (CI exit-3 under
~33-way parallelism) at its root rather than papering it with backoff+jitter+budget tuning.

It does NOT, by itself, fix branch-inheritance (issue 2). For issue 2 there are TWO live answers and
the maintainer is weighing them:
- **C5 (conservative, recommended interim):** fold the advancing marker into the
  `branch-carries-code-not-ledger-status-main-owns-status` principle's drop-set (a kept branch's tree
  never legitimately carries a `work/advancing/*` marker, so strip it on continue/rebase). No marker
  moves off main; ALL visibility kept; smallest surface.
- **C6 (structural, maintainer-raised 2026-06-17):** move the TRANSIENT STATUS files (in-progress,
  needs-attention, slicing, advancing markers) to a DEDICATED ledger ref where the CAS happens, keeping
  the REFERENCEABLE files (backlog, done, prd, prd-sliced) on `main` so dependency reads stay offline
  and human-glanceable. This DELETES the whole branch-inheritance class (nothing on main to inherit, so
  C5 becomes unnecessary) and decouples status-CAS from code-integration churn, at the price of
  transient-status visibility moving off the working tree (recovered via a `status` view) plus a
  second-ref reader/writer surface and a cross-ref reconciliation story. **C6 still wants C2 on the
  status ref**, so C2 is the right first step EITHER WAY. See `### C6` + the `## C2+C5 vs C6` head-to-head.

The pragmatic path: **land C2 first (valuable under both futures, kills the verified CI failure), then
decide C5 vs C6 for issue 2 as a separate, unforced call** priced purely on "is transient-status
visibility on the working tree worth keeping, vs a structural deletion of the inheritance class."

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

## Requirement SETS, the design is a function of which invariants are mandatory

The candidate that wins is a FUNCTION of which of A,G are mandatory. Most are non-negotiable
(A atomicity, B/C recovery, D bare-arbiter, F never-force are all hard), but **E (human visibility)
and G (elegance) are the dials** that actually move the answer. So rather than one global ranking, the
honest structure is: pick a REQUIREMENT SET, then derive the best design FOR that set. Two sets are
worth exploring; this document now covers both.

**A CRITICAL DISTINCTION that the visibility dial turns on (verified in code).** "Visibility" (E) is
NOT how the CODE reads state. Every machine reader ALREADY reads committed git via `ls-tree`/`show`
from a REF (a bare mirror's `main`), NOT from a working-tree `ls` (`ledger-read.ts`, `scan.ts`,
`status.ts`, `claim-cas.ts` all probe `<arbiter>/main:work/...` or `<mirror>/main:work/...`). And a
generated dashboard ALREADY exists (`agent-runner status` / `scan`) that humans run to see jobs +
needs-attention. So E is specifically "a HUMAN can `ls` the working tree and see status", which is
separable from both "the code can read status" (it reads a ref) and "a human can see status at all"
(they run `status`). Dropping E does NOT break any reader; it only removes the constraint that forced
status to live where a human could `ls` it. THIS is why dropping E opens the design space so much.

### Requirement SET 1, DEFAULT (E mandatory: a human can `ls work/` and see status)

This is the set the candidates above (C0,C6) were scored against. Under it, the winner is
**C2 + (C5 or C6)** with C6 only acceptable because it recovers status visibility via the generated
view. E being mandatory is exactly what KILLS C3 (per-item refs) and the literal D4 (off-main
advancing) and DEMOTES C6 to "a fork you pay a visibility cost for." The full analysis above stands
FOR THIS SET.

### Requirement SET 2, VISIBILITY DROPPED (E removed entirely)

> Maintainer decision 2026-06-17: explore the set where HUMAN WORKING-TREE VISIBILITY is NOT a
> requirement. Humans use `agent-runner status` (a generated view); they do NOT need to read raw
> `work/` status folders. The referenceable files (backlog/done/prd/prd-sliced) MAY still be glanceable
> as a convenience, but it is no longer a CONSTRAINT, so the design is free to put status anywhere the
> code can read it cheaply on a bare arbiter.

With E gone, the entire reason `main`-in-tree status existed collapses, and the rejections that leaned
on visibility (D4, C3, the ADR's P-opt-1) are REOPENED on their merits. The dominant force becomes
G (elegance) + A,D,F. The candidate that wins this set is NOT C2+C5 and NOT C6-as-described, it is a
cleaner thing, see `## Best design under Requirement Set 2` below.

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
as fixing issues 1, 2. See `## Supersedes`.

### C6, PARTIAL DEDICATED LEDGER REF: referenceable files stay on main, transient STATUS moves to its own ref. (maintainer-raised 2026-06-17) ★?

> Raised by the maintainer after the C2+C5 idea landed: a SHARPER form of the ADR's P-opt-2
> (`docs/adr/claim-ledger-vs-protected-main.md`). The ADR's P-opt-2 moved "the whole work/ folder tree,
> or just the intermediates" to one dedicated ref, lumped together. C6 makes the split PRINCIPLED along
> the regime seam the taxonomy idea already drew: the files that are REFERENCEABLE WORK-INPUT stay on
> `main`; only the TRANSIENT STATUS/LOCK state moves to a dedicated, agent-writable ledger ref where the
> CAS happens.

**The split, drawn on the property that actually matters (referenceable vs transient):**

- **Stays on `main` (referenceable, human-glanceable, dependency-resolving, useful as agent work-input):**
  `work/backlog/`, `work/done/`, `work/prd/`, `work/prd-sliced/`. VERIFIED these are exactly the files the
  dependency/eligibility reads target: `blockedBy` resolves against `work/done/` (`readiness.ts`,
  `eligibility.ts`); `sliceAfter` against `work/prd-sliced/` (`select-priority.ts`, `ledger-read.ts`);
  backlog enumeration against `work/backlog/`; PRD source `work/prd/`. So the things a claim/slice must
  READ to decide eligibility ALL stay on `main`: the partial split does NOT force those reads onto the
  network. This is the key advantage over the ADR's all-in-one P-opt-2.
- **Moves to a dedicated ledger ref (transient status + locks, where the CAS happens):** `work/in-progress/`,
  `work/needs-attention/`, `work/slicing/`, `work/advancing/` markers. These are the hot,
  frequently-mutated, contention-prone, branch-INHERITED files.

**Why this is genuinely attractive (it dissolves issues 1 AND 2 at once for the moved state, like C3 but
KEEPING the referenceable files visible on main):**

- **Issue 1 (false contention): REDUCED, not gone alone.** The dedicated ledger ref's CAS still leases
  the whole ref, BUT the ref now carries ONLY transient status, so two claims of different items still
  contend on it UNLESS the ledger ref's CAS is itself made rebase-until-real (C2 again). What C6 DOES
  remove is the biggest source the observation named: integration merges land on `main`, so they no
  longer advance the status ref, so unrelated code landings stop kicking the status CAS ("a sibling job's
  integration advancing main is exactly what triggers the rejection"). So C6 shrinks the status ref's
  writer set, but to fully kill same-ref false contention among status writers it STILL WANTS C2's
  rebase-until-real on the status ref. C6 does not REPLACE C2; it COMPOSES with it (and makes C2's job
  easier).
- **Issue 2 (branch-inheritance): GONE, structurally.** A work branch is cut from `main`. If in-progress
  / needs-attention / advancing markers are NOT on `main`, a branch cut from `main` CANNOT inherit them:
  there is nothing in main's tree to carry. Same win C3 gives, but C6 keeps backlog/done/prd/prd-sliced
  visible on main. **C6 makes C5 unnecessary** (no advancing marker on main means nothing to drop from a
  kept branch's tree), and it makes the branch-carries PRD's needs-attention-move removal moot for the
  SAME reason. C6 is a STRUCTURAL closure of the whole "branch carries ledger status" class, not a
  per-marker patch.

- **A atomicity OK**: a CAS on the dedicated ref is as authoritative as on main (same `--force-with-lease`
  + nonce + verify, different ref). One winner per genuine conflict.
- **B crash / C recov OK-ish**: recovery verbs (`release-advancing`, `requeue`, `gc --ledger`) repoint
  from `<arbiter>/main:work/...` to `<arbiter>/<ledger-ref>:work/...`. Mechanically the same, but every
  such reader/writer must learn the second ref (see cost).
- **D bare OK**: a dedicated ref is just a ref; CAS-push + `ls-tree`/`show` read work on `--bare file://`
  exactly as `main` does. Passes the kill criterion.
- **E visibility: LOST for the moved state (the cost YOU named).** A human reading the working tree on
  `main` no longer sees in-progress / needs-attention / advancing: they must look at the ledger ref (`git
  show <ledger-ref>:work/in-progress/`, or a generated `status`/`scan` VIEW). Backlog / done / prd /
  prd-sliced STAY glanceable on main. So the visibility loss is SCOPED to exactly the transient status,
  which is the negotiable half (the maintainer already said advancing-visibility is most negotiable;
  in-progress/needs-attention visibility is more valued but recoverable as a view). This is the central
  trade C6 asks you to accept: transient-status visibility moves from "ls the working tree" to "run a
  status command (or git show the ledger ref)."
- **F never --force OK**: leased CAS ff to the ledger ref, never `--force`.
- **G elegance: very strong for issue 2, partial for issue 1.** ONE structural move (relocate transient
  status to its own ref) dissolves the ENTIRE branch-inheritance class AND decouples status-CAS from
  code-integration churn: a deep, one-primitive simplification. It does NOT by itself finish issue 1
  (still wants C2 on the status ref), and it costs the second-ref reader/writer surface + the scoped
  visibility loss.

**The honest costs / risks specific to C6 (verified against code):**

1. **Every status reader/writer must learn the second ref.** Today `main` is the single source of truth
   the seam ADR deliberately preserved (`scan` is OFFLINE, reads `main`). C6 splits the source of truth:
   eligibility-input on `main`, status on the ledger ref. `ledger-read.ts` has BOTH a local-tree reader
   and an `<arbiter>/main:`-ref reader for each folder family; C6 doubles the status half onto a second
   ref. Tractable (the read seam ADR exists precisely so a future strategy can resolve some states
   elsewhere, and C6 IS that strategy) but it is the BIGGEST surface of any candidate here.
2. **`scan` and the autonomous selection loop go (partly) NETWORK-BOUND for status.** Today `scan` reads
   `main` offline. Reading in-progress/needs-attention from a dedicated ref means fetching that ref
   (network) or keeping a local tracking copy. The ADR flagged exactly this. For C6 it is PARTIAL:
   backlog/done/prd stay offline-on-main; only status needs the ref. Still, the offline-scan property the
   ADR prized is weakened for the status half.
3. **The `start --resume` cross-ref read (VERIFIED wrinkle).** `readSliceOnArbiter` (`ledger-read.ts`)
   reads the slice BODY from `work/backlog/` OR `work/in-progress/` on `<arbiter>/main`, because a resume
   reads the in-progress body. Under C6 the body lives in backlog on `main` but in-progress on the LEDGER
   REF, so this one reader must consult BOTH refs. Minor, but it is the kind of seam C6 sprinkles wherever
   a single read today spans a now-split folder set (the `['backlog','in-progress']` and `WORK_FOLDERS`
   enumerations are the grep anchors).
4. **Two refs to keep reconciled / clean up.** The ADR's open tension: "the intermediate signal and 'done
   on main' live on different refs/timelines; how are they reconciled if a PR merges but the intermediate
   wasn't cleaned up?" Under C6: a claim moves backlog(main) and in-progress(ledger-ref); a complete moves
   in-progress(ledger-ref) and done(main, atomic with code). So a single claim/build/done lifecycle now
   touches BOTH refs and must stay consistent (a crash between "remove from in-progress on ledger-ref" and
   "add to done on main" leaves a recoverable-but-split state). C2/C5 keep everything on ONE ref, so they
   have no cross-ref reconciliation at all: this is C6's distinctive new failure mode to design for (same
   CLASS as today's code-land/ledger-flip atomicity, now spanning two refs instead of branch-vs-main).

**Verdict on C6:** the STRONGEST structural answer to issue 2 (it deletes the whole branch-inheritance
class, making C5 unnecessary) and a MEANINGFUL reduction of issue-1 contention (by removing
integration-churn from the status ref's writer set), at the price of (a) scoped transient-status
visibility (the cost you named, mitigated by a generated view), (b) the biggest reader/writer surface of
any candidate, (c) partial network-bound status reads, and (d) a NEW cross-ref reconciliation failure
mode. It does NOT replace C2: the status ref still wants rebase-until-real to kill same-ref false
contention among status writers. So the real comparison is **"C2 + C5 (one ref, in-tree)" vs
"C2-on-the-status-ref + C6 (two refs, status off-tree)"**, head-to-head below.

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

## C2+C5 vs C6, the head-to-head (the decision now on the table)

Both are sound. They differ on ONE axis the maintainer must price: **is transient-status visibility on
main's working tree worth keeping?**

| dimension | C2 + C5 (one ref, status in-tree) | C2-on-status-ref + C6 (status off-tree) |
| --- | --- | --- |
| issue 1 false contention | fixed in-tree (rebase-until-real) | fixed AND reduced (status ref has fewer writers; still wants rebase-until-real) |
| issue 2 branch-inheritance | fixed by a per-marker drop-set (C5) | fixed STRUCTURALLY (nothing on main to inherit; C5 unnecessary) |
| transient-status visibility (in-progress/needs-attention/advancing) | KEPT (ls the working tree) | LOST from working tree, recovered via a status view (git show the ledger ref) |
| referenceable visibility (backlog/done/prd/prd-sliced) | KEPT | KEPT (the point of the PARTIAL split) |
| reader/writer surface | small (retry semantics + one drop-set) | LARGE (every status reader/writer learns a second ref) |
| offline `scan` | fully offline (reads main) | partial: status half network-bound |
| cross-ref reconciliation | none (one ref) | NEW failure mode (claim/complete span main + ledger-ref) |
| migration | trivial (no format change) | real (introduce the ref, repoint readers, backfill, dual-read window) |
| elegance | one retry change + one drop-set | one structural split that deletes a whole defect class |

**The honest read:** C6 is the more PROFOUND fix: it deletes the branch-inheritance class outright and
structurally separates "the serialization substrate" from "the code integration target," the clean
conceptual seam the original ADR was reaching for. C2+C5 is the more CONSERVATIVE, lower-risk,
lower-surface fix that keeps ALL visibility and the single-source-of-truth-on-main property. They are
NOT mutually exclusive in the way that matters: **C6 still wants C2's rebase-until-real on the status
ref**, so C2 is valuable under BOTH futures. The real fork is C5-vs-C6 for issue 2, and the
visibility/surface trade.

**A pragmatic sequencing that does NOT force the choice now (RECOMMENDED path through the fork):**
1. Land **C2** first regardless: it is valuable under both futures (the per-ref contention fix, needed on
   `main` today and on the status ref tomorrow), lowest-risk highest-value, and it kills the verified CI
   failure immediately. Landing C2 commits you to NOTHING about C5-vs-C6.
2. THEN decide C5 vs C6 for issue 2 as a separate, unforced call:
   - if transient-status visibility on the working tree is worth keeping and you want minimal surface:
     **C5** (the per-marker drop-set).
   - if you will trade transient-status visibility for a STRUCTURAL deletion of the whole inheritance
     class (and accept the second-ref surface + a generated status view): **C6**.
3. The seam to BUILD C6 cleanly ALREADY EXISTS: the read/write ledger seam ADR
   (`claim-ledger-vs-protected-main`) was created EXACTLY so "a future strategy could resolve some states
   from elsewhere without every reader knowing." C6 is the first real consumer of that seam, not a
   rewrite. (This is a strong argument that C6 is the INTENDED long-run shape and C5 is the tactical
   interim, but only the maintainer can price the visibility trade.)

## Scoring summary

| Candidate | A atom | B crash | C recov | D bare | E vis | F no-force | G elegance | fixes #1 | fixes #2 | fixes #3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C0 current | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| C1 mitigation stack | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘✘ | ~ ceiling | ✘ | ✘ |
| **C2 rebase-until-real (4 acquire paths)** | ✔ | ✔ | ✔ | ✔ | ✔✔ | ✔ | ✔✔ | **✔** | ✘ | ✘ |
| C3 off-main ref | ✔ | ~ new | ~ new | ✔ | ✘ (moved) | ✔ | ~ | ✔ (moved) | ✔ (moved) | ✘ |
| C4 co-located .lock.md | ✔ | ✔ | ✔ | ✔ | ✔ ergo | ✔ | ✘ here | ✘ | ✘ | ✘ |
| **C5 fold into branch-carries** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | **✔** | ✘ |
| **C6 partial dedicated ledger ref** | ✔ | ✔~ | ✔~ | ✔ | ✘ status only | ✔ | ✔✔ #2 / ~ #1 | ~ reduces (wants C2) | **✔✔ structural** | ✘ |

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
- **REOPENS the off-main ref rejection (D4) and SPLITS it into two distinct shapes.** D4 was rejected
  for destroying visibility. Reopened because transient-status visibility is recoverable as a view. The
  reopening resolves into TWO different proposals that must not be conflated:
  - the NARROW off-main idea (advancing marker ALONE to an off-main ref, the literal D4) stays DOMINATED
    by C5 (which closes advancing inheritance in-tree with zero visibility loss and a tiny surface).
  - the PRINCIPLED partial-split (C6: ALL transient status, not just advancing, to a dedicated ledger
    ref, while referenceable files stay on main) is a STRONGER, LIVE candidate the maintainer is now
    actively weighing. It is the sharpened form of the ADR's P-opt-2 and matches the ADR maintainer's
    own recorded lean ("preserve in-progress as a FILE on a dedicated ledger branch"). So D4-as-advancing
    -alone is dead, but D4's underlying intuition (status off main) is ALIVE as C6 and is the real fork
    against C5 for issue 2. The decision is the visibility/surface trade, not "is off-main viable" (it
    is, on `--bare` too).
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

## Best design under Requirement Set 2 (human working-tree visibility DROPPED)

With E removed, re-derive from scratch rather than re-scoring the SET-1 candidates. The forces left are
A (atomicity), B/C (recovery), D (bare arbiter), F (never-force), and G (elegance), and the code
ALREADY reads status from a ref via `ls-tree`/`show`. The question becomes purely: **what is the
cleanest serialization substrate, given no human must `ls` it?**

### The winning shape: C7, ONE dedicated ledger ref holding the WHOLE transient state machine (the full P-opt-2, now unblocked)

C6 was a PARTIAL split because E forced backlog/done/prd/prd-sliced to stay human-glanceable on main.
Drop E and that constraint vanishes, so the clean shape is the FULL split the ADR's P-opt-2 always
wanted: **`main` holds CODE only; a single dedicated, agent-writable ledger ref (`refs/agent-runner/ledger`,
or a `ledger` branch) holds the ENTIRE `work/` state machine** (backlog, in-progress, needs-attention,
done, slicing, prd, prd-sliced, advancing markers, everything). "Status = the folder" is PRESERVED in
full, just on the ledger ref instead of main. Every transition is a CAS `git mv`/marker on that ref via
`applyTransition` retargeted from `:main` to `:refs/agent-runner/ledger`.

Why this is STRICTLY cleaner than C2+C5 and than C6 once E is gone:

- **Issue 1 (false contention): the integration-churn source is GONE entirely**, not just reduced. The
  ledger ref is advanced ONLY by ledger transitions, never by code integration (which lands on `main`).
  So the ledger ref's writer set is exactly the ledger writers, no unrelated kicks. Combined with C2's
  rebase-until-real on the ledger ref (still wanted, the SAME primitive, retargeted), same-path false
  contention is killed. Cleaner than C6 because there is no longer a mixed main+ledger writer story to
  reason about per folder.
- **Issue 2 (branch-inheritance): DELETED, totally and by construction.** A work branch is cut from
  `main`, and `main` now holds NO `work/` ledger tree at all (only code), so a branch CANNOT inherit
  ANY ledger file (not advancing markers, not needs-attention moves, not done moves). The entire
  `drop-bookkeeping-rebase` machinery, the branch-carries PRD's needs-attention-move removal, AND C5
  all become UNNECESSARY in one move. The branch carries pure code; the `→done` move is no longer even
  a branch commit, it is a ledger-ref CAS like every other transition. This is the deepest possible
  closure of the whole class.
- **The atomic `→done` exception DISSOLVES.** The branch-carries PRD kept `→done` as the one on-branch
  move BECAUSE `main` had to show `done/` atomically with the code landing. Under C7, `done/` is on the
  ledger ref and the code is on `main`, they are DIFFERENT refs, so "done atomic with code" becomes a
  two-ref reconciliation (the same cross-ref story C6 introduced) rather than an on-branch move. This is
  the ONE place C7 trades a solved problem for a new one, see costs.
- **"status = the folder" is FULLY universal again.** No marker-vs-move exception forced by visibility,
  no partial split, no co-located `.lock.md`. Advancing can even become a real per-type STATUS folder on
  the ledger ref if desired (the taxonomy idea's `OPEN FORK` per-type-status proposal) because the
  observations-don't-flow and position-shadowing objections were about the MAIN working tree humans
  read, which no longer matters. (Still likely keep it a marker for the orthogonality reason, but the
  visibility blocker is gone.)

- A atomicity OK (same CAS+nonce+verify on the ledger ref). B/C recovery OK (verbs repoint to the
  ledger ref; mechanically identical). D bare OK (a ref is a ref; CAS-push + ls-tree on `--bare`). F
  never-force OK (leased ff to the ledger ref). G STRONGEST of all candidates: ONE substrate move
  deletes issue 2 + the done-exception + the drop-rebase machinery + the marker/move visibility
  exceptions, and hosts C2 unchanged. It is the design the read/write ledger seam ADR was BUILT for.

### The honest costs of C7 (the price of dropping E)

1. **A human can no longer `git clone` + `ls work/` and see the backlog/board.** They MUST run
   `agent-runner status`/`scan` (which already exist, but now become the ONLY way), or `git show
   refs/agent-runner/ledger:work/backlog/`. For a project whose CONTEXT.md prizes the readable `work/`
   tree this is the real loss, it is exactly the requirement we are dropping, named honestly.
2. **Cross-ref reconciliation is now the WHOLE lifecycle, not an edge.** Every claim (code branch off
   main + ledger move on the ref) and every complete (code merge to main + done move on the ref) spans
   two refs. The crash-safety story (code landed, ledger flip didn't, or vice versa) must be designed
   for the COMMON path, not just failures. This is genuinely more than C2+C5 (one ref, no cross-ref).
   It is the same CLASS the ADR flagged ("intermediate signal and done-on-main on different
   refs/timelines") and the same class C6 had, just now unavoidable rather than scoped.
3. **`scan` is fully network-bound for ALL state** (it must fetch the ledger ref), losing the
   offline-scan property the seam ADR prized. (C2+C5 keep it fully offline; C6 lost only the status
   half.) Mitigable with a local tracking copy of the ledger ref, but that is a freshness/caching story
   to design.
4. **Biggest reader/writer surface of all**, EVERY `work/` reader and writer retargets from `main` to
   the ledger ref. Tractable because the read/write seams already centralize this (that is what they
   were for), but it is the largest single migration here.
5. **Provider note:** on a protected-`main` repo this is actually a BONUS (the ledger ref can be
   agent-writable while `main` is protected, the exact contradiction the ADR opened with), so C7 also
   incidentally UNBLOCKS the protected-main case the seam ADR was created for. Worth noting as upside.

### Does C7 still want C2 and the issue-3 rule? Yes and yes.

- **C2 (rebase-until-real) is STILL wanted**, now on the ledger ref. Same primitive, retargeted. The
  ledger ref still has a whole-ref lease, so different-item writers still falsely contend without C2.
  So C2 remains the FIRST step under BOTH requirement sets, more evidence it is the right thing to
  build first regardless of the visibility decision.
- **Issue 3 (cross-action exclusion) is UNCHANGED in nature** (advisory precedence + the slicing-stale
  backstop), but slightly cleaner to host: all three holds now live on one ledger ref, so a future
  "one action per item" check reads one ref. The advance∥claim TOCTOU residual is the same.

### Set-2 recommendation

**C2 (on the ledger ref) + C7 (whole state machine on one dedicated ledger ref; `main` = code only).**
This is the most elegant design in the whole space (it deletes issue 2, the done-exception, the
drop-rebase machinery, and every visibility-forced marker/move exception in ONE substrate move, and
incidentally unblocks protected-main), and it is ONLY available because E is dropped. Its price is the
full cross-ref lifecycle, network-bound scan, and the largest reader retarget, all of which are
acceptable PRECISELY when human working-tree visibility is not required.

**Relationship to the Set-1 answer:** C7 SUPERSEDES C5, C6, the branch-carries PRD's on-branch-move
removal, AND the `→done` on-branch exception. C2 is common to both sets. So the only genuinely
set-dependent decision is C5/C6 (Set 1) vs C7 (Set 2), and that decision IS the visibility requirement
itself: keep E and you get C5/C6 (status stays where a human can read it); drop E and C7 is strictly
cleaner. The maintainer's 2026-06-17 choice to explore dropping E points at C7.

## Disposition

Incubates as an idea because it proposes RETIRING a decided PRD decision (the co-located `.lock.md`),
EXTENDING another (branch-carries), and leaves ONE open fork for the maintainer (C5 vs C6 for issue 2),
all maintainer calls. On confirmation, the actionable form is C2 first, then the C5/C6 fork, then
optionally issue 3:

1. **C2 rebase-until-real-conflict (the four acquire paths)**, change the contention-retry semantics
   in the claim/slicing-acquire/advancing-acquire/create loops (or push a retrying variant into the
   `applyTransition` seam) so a clean replay (the existing claimability re-check still shows the target
   free) loops to success and only a genuine same-path conflict gives up; keep a large liveness ceiling;
   add modest refetch jitter. EXPLICITLY leave the slug-relocation family on their bounded,
   precondition-checked loops. Acceptance: existing race tests + a high-fan-out test proving N
   different-item writers all land with zero exit-3, and a same-item race still yields exactly one
   winner. Pure, gate-verifiable, no format change. **Highest-value, lowest-risk, directly kills the
   verified CI failure.**
2. **Issue 2 (branch-inheritance), the OPEN FORK, decide C5 vs C6 (do NOT pre-slice both):**
   - **C5 (conservative)**: fold the advancing marker into the branch-carries drop-set (strip
     `work/advancing/*` from a kept branch's tree on continue/rebase) via the existing
     `advancingMarkerPath`/`listAdvancingMarkers` seam; land WITH or AFTER the branch-carries PRD.
     Acceptance: a kept branch carrying a stale advancing marker continues/rebases cleanly (no
     rename/rename ledger conflict). Keeps all visibility, smallest surface.
   - **C6 (structural)**: move transient status (in-progress, needs-attention, slicing, advancing) to a
     dedicated ledger ref; keep backlog/done/prd/prd-sliced on `main`; build it AS the first consumer of
     the existing read/write ledger seam (`docs/adr/claim-ledger-vs-protected-main.md`); add a generated
     `status` view to recover transient-status visibility; design the cross-ref reconciliation + the
     `--resume` cross-ref read. This is a larger, own-PRD effort that SUPERSEDES C5 (and most of
     branch-carries' needs-attention-move removal). Acceptance: nothing transient on main, a branch cut
     from main inherits no status, status reads/writes go through the ledger ref on `--bare` too, the
     claim/complete cross-ref lifecycle is crash-safe, and the status view shows in-progress/needs-attention/
     advancing. Decide this fork on the visibility/surface trade, NOT on viability (both are viable).
   The recommendation is **C5 as the interim, C6 as the likely long-run shape** (it is what the ledger
   seam was built to host and matches the ADR maintainer's recorded lean), but the choice is the
   maintainer's and is unforced by landing C2.
3. **Cross-action precedence (issue 3, optional/lower priority)**, an advancing-marker-held item is not
   claim-eligible and vice-versa, enforced ADVISORILY at the existing eligibility/readiness gate; the
   slicing-release stale check remains the atomic backstop; the advance∥claim simultaneous race is
   documented as a recoverable residual. Acceptance: a race between advance and claim on one item is
   serialized in the common case (one is refused/skipped), the advance edit is never silently lost in
   the common case.

Sequence 1 first (the biting failure, independent of everything). 2 with/after branch-carries. 3 last,
only if the maintainer wants the exclusion (the brief leaves "is it even necessary" open, the
recommendation is "nice-to-have, not urgent, cheap as a precedence rule, NOT worth a lock unification").

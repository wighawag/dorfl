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
> - **Set 2 (E dropped, maintainer-requested exploration 2026-06-17):** `C2 + C8` (the BREAKTHROUGH).
>   CONTENT always stays checked out on `main` (the full readable `work/` tree). The ONLY moves ever
>   made on `main` are the two REFERENCEABLE promotions `backlog→done` and `prd→prd-sliced` (exactly the
>   dependency-resolving transitions, verified). Everything transient, claim/in-progress,
>   needs-attention, slicing, advancing, becomes ONE lock per item on a dedicated lock ref, so the three
>   actions are MUTUALLY EXCLUSIVE BY CONSTRUCTION. This solves all THREE issues by construction (1 via
>   C2-on-the-lock-ref, 2 by locks-off-main, 3 by the single per-item mutex, NO advisory rule), keeps
>   content checked out + eligibility offline-on-`main`, and is the strongest candidate found. C7/C7-alt
>   are superseded (C7-alt rejected: it strips content from the checkout). See `## C8`.
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

With E gone, the reason transient STATUS lived in a human-`ls`-able tree collapses, and the rejections
that leaned on visibility (D4, C3, the ADR's P-opt-1) are REOPENED on their merits. IMPORTANT: dropping
E does NOT move CONTENT (backlog/prd/observations/findings/ideas) anywhere, agents still read/write
those as a readable tree; it only frees where STATUS lives. The dominant force becomes G (elegance) +
A,D,F, and the winner moves transient STATUS off `main` to a dedicated ledger ref while CONTENT stays
readable, see `## Best design under Requirement Set 2` below.

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

## Cross-action exclusion (issue 3), the answer: a unified per-item lock is NOT needed (UNDER SET 1)

> **SCOPE: this section reasons under SET 1** (status stays on `main`, three holds on three DISTINCT
> refs, so unifying them onto one ref would re-create false contention among them). Under SET 2 / C8
> the premise FLIPS: once status leaves `main` and lives on a lock ref, ONE lock per item is not only
> safe but the CLEANEST shape, and it solves issue 3 BY CONSTRUCTION (atomic exclusion, no TOCTOU,
> no advisory rule). So the "no unification" conclusion below is a SET-1 conclusion; C8 supersedes it
> under Set 2. The two are not contradictory, they answer the same question under different substrates.

The maintainer's question: should "advancing", "slicing", "implementing" be mutually exclusive on one
item, possibly by collapsing the three locks into ONE per-item hold? **Answer (SET 1): no unification;
close the one genuinely-unsafe pair with an ADVISORY precedence rule + the existing atomic backstop.
(SET 2: YES unify, see C8, it is the right move once the locks are off `main`.)**

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

> **CORRECTION 2026-06-17 (maintainer caught a conflation).** An earlier draft of this section said
> "`main` holds CODE only; the ENTIRE `work/` tree moves to the ledger ref." That OVERSHOT. Dropping
> HUMAN visibility (E) does NOT mean agents stop having a readable backlog / prd / observations /
> findings / ideas to work from, OF COURSE they still need those, agents read backlog+prd+findings as
> work INPUT and write observations/ideas as work OUTPUT. The corrected design below draws the line at
> the right place: **CONTENT vs STATUS**, not "code vs everything."

### The line that actually matters: CONTENT (agent work I/O) vs STATUS (serialization)

`work/` holds two DIFFERENT kinds of thing, and only ONE of them is what E ever governed:

- **CONTENT, the files agents read/write as work input and output.** Backlog slice BODIES, prd,
  prd-sliced, done records, AND the capture buckets observations / findings / ideas. An agent building
  a slice reads the slice body + the PRD + referenced findings; an agent advancing writes a new
  observation. These must stay REAL, READABLE, EDITABLE files in a normal tree. Dropping HUMAN
  visibility says NOTHING about these, they are not "status," they are the work itself.
- **STATUS, the serialization/lock state.** WHICH folder a slug currently sits in (backlog vs
  in-progress vs needs-attention vs done), plus the slicing lock and the advancing markers. This is the
  state the CAS serializes, and "a human can `ls` it" is the ONLY thing E was ever about.

**The hard wrinkle this exposes (VERIFIED, and it is the real design crux):** in the CURRENT model the
slice FILE *is* both content and status, ONE file, and its FOLDER encodes the status. A claimed slice's
BODY lives at `work/in-progress/<slug>.md`, so its content-location and its status ARE the same fact
(`readSliceOnArbiter` in `ledger-read.ts` reads the body from `backlog/` OR `in-progress/`, whichever
holds it). "Status = the folder" is elegant PRECISELY because the move IS the status change with no
separate record. So you cannot naively "move status to a ledger ref and leave content on main", because
for a backlog/in-progress slice the file is BOTH. Set 2 has to decide HOW to split a thing that is
currently one file. Two coherent ways:

### C7 (corrected): CONTENT on a readable tree; STATUS as a pointer/position on the ledger ref

- **CONTENT ref (readable, agent + optionally human):** keep backlog, prd, prd-sliced, done,
  observations, findings, ideas as a normal `work/` file tree, on `main` (simplest) OR on a dedicated
  content branch (a convenience choice now E is dropped, NOT load-bearing). An item's BODY lives here
  ONCE, at a status-NEUTRAL path (e.g. `work/items/<slug>.md` or its bucket), and does NOT move when
  its status changes.
- **STATUS/LEDGER ref (CAS serialization):** a dedicated agent-writable ref whose tree encodes ONLY
  position + locks, e.g. `in-progress/<slug>` (presence = claimed), `needs-attention/<slug>`,
  `slicing/<slug>`, `advancing/<entry>` markers, plus `done/<slug>`. These are POINTERS/markers keyed
  by slug, NOT the body. The CAS happens here; status = the marker's folder on the ledger ref.
- So a claim becomes "add `in-progress/<slug>` marker on the ledger ref via CAS" (the body stays put on
  the content ref); a complete becomes "code to `main` + `done/<slug>` marker on the ledger ref."

This is C6's content-vs-status split taken to its clean conclusion once E is dropped: ALL status on the
ledger ref (not C6's partial split), ALL content on a readable tree (agents keep everything they read).
The cost C6 paid (some status visibility lost) is now ACCEPTED by the requirement set, so the partial
compromise is unnecessary, the split goes fully clean.

> **The genuine tension C7 introduces (be honest):** today the BODY and the STATUS are one file, so
> there is exactly one source of truth per item and the move is atomic. Splitting body (content ref)
> from position (ledger ref) creates TWO records per item that must be kept consistent, the same
> cross-ref reconciliation C6 had, now intrinsic. AND it weakens "status = the folder" into "status =
> a marker on another ref that POINTS at a body living elsewhere." That is a real loss of the model's
> current elegance. Whether C7 is cleaner than C5/C6 OVERALL is therefore NOT obvious, it buys the
> deletion of branch-inheritance + the done-exception, but pays with body/position separation. See
> "Is C7 actually cleaner?" below.

### C7-alt: WHOLE `work/` (content AND status) on ONE dedicated ledger ref; `main` = code only

The other coherent Set-2 shape, and the one the earlier draft wrongly described as "C7": move the
ENTIRE `work/` tree (content files AND the status folders) onto one dedicated ledger ref, and make
`main` hold ONLY code. Agents read backlog/prd/findings and write observations FROM/TO the ledger ref
(via `ls-tree`/`show`/CAS, exactly as the code already reads `<mirror>/main:work/...` today, just
retargeted). Humans use `status`/`scan`.

- **PRO:** keeps "status = the folder" FULLY intact (the file is still both body and position, just on
  the ledger ref), so there is no body/position split and no new per-item dual-record, the SINGLE
  source of truth per item is preserved, only on a different ref. Branch-inheritance still DELETED
  (main has no `work/` tree). One substrate, one CAS, one place agents read+write all `work/`.
- **CON:** agents' work I/O is now ref-based (read backlog from the ledger ref, write an observation as
  a CAS commit to it), `scan` is fully network-bound, and the whole `work/` tree leaves `main`. It also
  re-raises a real question: capture buckets (observations/findings/ideas) and content do NOT want CAS
  serialization (they are not contended status), yet they would share the ledger ref's CAS substrate,
  mixing "serialized status" with "just files" on one ref (the same regime-mixing the taxonomy idea
  worked to AVOID). C7 (the split) keeps content OFF the CAS substrate, which is arguably more honest.

### Is C7 (split) actually cleaner than C7-alt (whole tree on the ledger ref)? The honest comparison

| aspect | C7 (content tree + status/pointer ledger ref) | C7-alt (whole work/ on ledger ref, main=code) |
| --- | --- | --- |
| "status = the folder" | WEAKENED (status is a marker pointing at a body elsewhere) | PRESERVED (file is body+position, on the ledger ref) |
| source of truth per item | TWO records (body + position) to reconcile | ONE record (the file), like today |
| content vs status regimes | cleanly SEPARATED (content not on the CAS ref) | MIXED (content shares the CAS substrate) |
| agent reads work-input from | a readable content tree (can stay on main) | the ledger ref (network) |
| branch-inheritance (issue 2) | DELETED | DELETED |
| done-exception | dissolves (done is a ledger marker) | dissolves (done is a ledger move) |
| cross-ref lifecycle | intrinsic (body ref + status ref) | only main(code) + ledger(work), but content+status co-located on ledger |

Neither is unambiguously best, they trade body/position-split (C7) against content-on-the-CAS-substrate
(C7-alt). **The decision hinges on a SECOND requirement we have not pinned:** do we want content (and
especially capture buckets) to stay on a NON-CAS, plain-file tree (favours C7), or is it acceptable for
all `work/` to live on the serialized ledger ref (favours C7-alt's single-source simplicity)? This is a
good candidate for the NEXT requirement-set exploration.

Why this is STRICTLY cleaner than C5/C6 on issue 2 (true for BOTH C7 variants):

- **Issue 2 (branch-inheritance): DELETED by construction.** A work branch is cut from `main`, and
  `main` now holds NO `work/` STATUS at all, so a branch CANNOT inherit any status file (advancing
  markers, needs-attention moves, done moves). The `drop-bookkeeping-rebase` machinery, the
  branch-carries PRD's needs-attention-move removal, AND C5 all become UNNECESSARY in one move.
- **The atomic `→done` exception DISSOLVES.** The branch-carries PRD kept `→done` on-branch BECAUSE
  `main` had to show `done/` atomically with the code. With status off `main`, `done` is a ledger-ref
  transition like any other, the code-vs-done atomicity becomes the cross-ref story (a cost, below).
- **Issue 1 (false contention): integration-churn source GONE.** The ledger/status ref is advanced
  ONLY by status transitions, never by code integration (which lands on `main`). Combined with C2 on
  the status ref, same-path false contention is killed.

- A atomicity OK (CAS+nonce+verify on the ledger ref). B/C recovery OK (verbs repoint to the ledger
  ref). D bare OK (a ref is a ref). F never-force OK (leased ff). G very strong on issue 2 (deletes the
  whole inheritance class + the done-exception), but C7 weakens "status = the folder" and C7-alt mixes
  content onto the CAS substrate, so the elegance is NOT free, it is bought with the costs below.

### The honest costs of the Set-2 shapes (the price of dropping E)

1. **A human can no longer `git clone` + `ls work/` and see the board.** They run `agent-runner
   status`/`scan` (which already exist, now the primary way), or `git show <ledger-ref>:work/...`. For a
   project whose CONTEXT.md prizes the readable `work/` tree this is the real loss, exactly the
   requirement being dropped, named honestly. (Agents are UNAFFECTED, they read content from the
   content tree either way, the correction this section makes.)
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
4. **Big reader/writer surface**, every STATUS reader/writer (C7) or every `work/` reader/writer
   (C7-alt) retargets from `main` to the ledger ref. Tractable because the read/write seams already
   centralize this (that is what they were for), but it is a large migration, larger for C7-alt (which
   also moves content).
5. **Provider note (PARTIAL upside):** on a protected-`main` repo, moving claim + intermediates off
   `main` removes the EXACT write the ADR's contradiction named (no agent can claim), a real win. But
   any state that STILL reaches `main` (for C7/C7-alt: nothing; for C8: the durable promotions) is
   still subject to protection. See C8's `### Pressure-test amendments` , Amendment 3 for the honest
   "tractable, not fully solved" verdict, this is NOT a free incidental unblock for designs that keep
   durable records on `main`.

### Do the Set-2 shapes still want C2 and the issue-3 rule? Yes and yes.

- **C2 (rebase-until-real) is STILL wanted**, now on the ledger ref. Same primitive, retargeted. The
  ledger ref still has a whole-ref lease, so different-item writers still falsely contend without C2.
  So C2 remains the FIRST step under BOTH requirement sets, more evidence it is the right thing to
  build first regardless of the visibility decision.
- **Issue 3 (cross-action exclusion) is UNCHANGED in nature** (advisory precedence + the slicing-stale
  backstop), but slightly cleaner to host: all three holds now live on one ledger ref, so a future
  "one action per item" check reads one ref. The advance∥claim TOCTOU residual is the same.

### Set-2 recommendation

**C2 (on the status/ledger ref) + the STATUS-off-`main` move.** Drop E and ALL transient status leaves
`main`, deleting issue 2 + the `→done` exception + the drop-rebase machinery, and incidentally
unblocking protected-main. AGENTS KEEP a readable content tree (backlog/prd/observations/findings/ideas)
throughout, that is the correction this section makes, dropping E touches HUMAN glanceability of status
ONLY, never agent work-input. The remaining Set-2 choice is the body/position question:
- **C7 (content tree + status pointers):** content stays a plain readable tree (on `main` or a content
  branch); the ledger ref holds only position/lock markers pointing at it. Keeps content OFF the CAS
  substrate and keeps agent work-input on a readable tree, but splits each item into a body record + a
  position record (cross-ref reconciliation; weakens "status = the folder").
- **C7-alt (whole `work/` on the ledger ref):** the file stays both body and position, just on the
  ledger ref; `main` = code only. Preserves single-source "status = the folder" and one record per item,
  but agents read/write all `work/` from the ledger ref (network) and content shares the CAS substrate.

Neither is unambiguously best; the tiebreaker is a SECOND, not-yet-pinned requirement (must content,
especially capture buckets, stay on a non-CAS plain-file tree?), a good next requirement-set to explore.

**Relationship to the Set-1 answer:** EITHER Set-2 shape SUPERSEDES C5, C6, the branch-carries PRD's
on-branch-move removal, AND the `→done` on-branch exception. C2 is common to both sets. So the only
genuinely set-dependent decision is C5/C6 (Set 1) vs the status-off-`main` move (Set 2), and that
decision IS the visibility requirement itself: keep E and you get C5/C6 (status stays where a human can
`ls` it); drop E and moving status off `main` is strictly cleaner on issue 2.

> **C7-alt is REJECTED (maintainer, 2026-06-17): it removes the CONTENT from the checked-out repo.**
> Putting the whole `work/` tree on the ledger ref means a normal `git clone` of `main` has no
> backlog/prd/observations/findings/ideas in its working tree at all, agents (and humans) would have to
> `git show <ledger-ref>:...` to read their own work-input. That is unacceptable: content must stay
> checked out on `main`. This rejection, plus the "one lock per item" idea below, produces a STRICTLY
> better Set-2 design, C8.

## C8 (Set 2, the breakthrough), ONE lock per item on a lock ref; `main` holds content + durable resting records, only TRANSIENT HOLDS leave `main`

> Maintainer-proposed 2026-06-17, thinking outside the box. This DISSOLVES more problems than any
> prior candidate and is the recommended Set-2 design. It rests on a VERIFIED structural fact (below)
> that none of C5/C6/C7 exploited.
>
> **PRESSURE-TESTED 2026-06-17 (adversarial oracle pass + maintainer questions). Four amendments
> folded in; no objection was fatal. Summary of the corrections (details in `### Pressure-test
> amendments`):**
> 1. **out-of-scope** is a FIFTH status folder this design first missed. The rule is NOT "two
>    promotions"; it is "`main` holds CONTENT + all DURABLE RESTING records (`done`, `prd-sliced`,
>    `out-of-scope`); the lock ref holds only TRANSIENT HOLDS." Three `main` move classes, not two.
> 2. **Lock schema is TWO axes** (`action: implement|slice|advance` AND `state: active|stuck`+reason),
>    not "action + optional reason" (else "advanced-and-stuck" is unrepresentable). The maintainer
>    called this: the lock must say WHAT it is locked on.
> 3. **Protected-main is PARTIALLY solved, not "incidentally unblocked."** C8 removes the
>    claim/intermediate writes from `main` (the ADR's actual boundary, genuinely valuable), but the
>    durable promotions still reach `main`, on a protected `main` those must route through the existing
>    PR-merge path. C8 makes protected-main TRACTABLE, it does not fully solve it for free.
> 4. **Lock ref = `refs/agent-runner/locks` (a HIDDEN, non-branch ref), NOT a branch.** Accidental
>    deletion = "all locks released," RECOVERABLE (work is safe on the `work/<slug>` branches + `main`),
>    blast radius FAR smaller than a `--force` to `main`. Plus one selection-hot-path retarget
>    (`backlog/` is no longer the clean claimable pool; readers must subtract lock-held slugs).

**The verified fact that unlocks it:** dependency/eligibility resolution targets ONLY two folders,
`blockedBy` , `work/done/` (`eligibility.ts`, `readiness.ts`) and `sliceAfter` , `work/prd-sliced/`
(`select-priority.ts`, `ledger-read.ts`). NOTHING resolves a dependency or eligibility decision against
`in-progress/` or `needs-attention/` (a full grep finds only ONE incidental line, reading a slice
BODY from backlog/ OR in-progress/, never a STATE check). So `in-progress` and `needs-attention` are
PURELY OPERATIONAL status (consumed by `status`/`scan`/recovery), NOT referenceable lifecycle state.
The two referenceable resting states are EXACTLY `done` and `prd-sliced`. That is the natural cleave
line, and it is the one the maintainer drew.

**The design, two independent moves that compose:**

1. **CONTENT always stays checked out on `main`** (kills C7-alt). The full readable `work/` content tree
   (backlog, prd, prd-sliced, done, observations, findings, ideas) lives on `main` as today, a normal
   `git clone` has it all in the working tree. Agents and humans read/write it directly.
2. **`main` holds CONTENT + all DURABLE RESTING records; only TRANSIENT HOLDS leave `main`** (amended
   per pressure-test objection 1). The `main` move classes are the THREE durable transitions:
   `backlog/<slug> , done/<slug>`, `prd/<slug> , prd-sliced/<slug>`, and `backlog/<slug> ,
   out-of-scope/<slug>` (the permanent "won't do" record, a sibling of `done`, NOT dependency-resolving
   but a durable human-browsable file). These are rare and rest as files humans/agents reference.
   Everything TRANSIENT that is today a `main` folder-move (claim , in-progress, surface ,
   needs-attention, slicing-lock , slicing/) STOPS being a `main` move and becomes lock-ref state. The
   clean rule: **durable resting record , stays a file on `main`; transient hold , the lock ref.**
3. **ONE lock per item, on a dedicated lock ref (`refs/agent-runner/locks`).** Claiming/implementing a
   slice, slicing a PRD, and advancing (answering/triaging) an item ALL acquire THE SAME lock, keyed on
   the item identity (`<type>-<slug>`). The lock ref holds one entry per HELD item; the CAS happens
   here. They are the SAME lock, so they are MUTUALLY EXCLUSIVE BY CONSTRUCTION. **The lock entry is a
   TWO-AXIS record** (amended per pressure-test objection 2, the maintainer's "it must say what it is
   locked on"):
   - `action: implement | slice | advance` , WHAT holds the lock (this is the "what it is locked on").
   - `state: active | stuck` (+ `reason` + `since` + `holder`) , whether the hold is healthy or stuck.
   The two axes are INDEPENDENT: "in-progress" = `action:implement, state:active`; "needs-attention" =
   `state:stuck` for WHATEVER action held it (so "advanced-and-stuck" and "building-and-stuck" are BOTH
   representable, which a single action-field could not do); "slicing" = `action:slice, state:active`.
   The existing `advancingMarkerBody` (`advancing-lock.ts`) already writes a frontmatter body, so this
   is a mechanical extension from one field to two.

**What this dissolves (more than any other candidate):**

- **Issue 1 (false contention): killed, and at LOW volume.** Locks live on a dedicated ref advanced
  only by lock acquire/release, never by code integration NOR by the two `main` promotions. Apply C2
  (rebase-until-real) on the lock ref and same-path false contention is gone. The lock ref's writer set
  is just the lock writers, the smallest contended surface of any candidate.
- **Issue 2 (branch-inheritance): DELETED by construction.** A work branch cut from `main` inherits no
  lock state (locks are on the lock ref, not in main's tree) and no in-progress/needs-attention/slicing
  folder (those are not on `main` anymore). The ONLY `main` `work/` files are content + the two
  promotions, none of which a mid-build branch carries as status. `drop-bookkeeping-rebase`, the
  branch-carries PRD's needs-attention-move removal, and C5 ALL become unnecessary.
- **Issue 3 (cross-action exclusion): DISSOLVED, atomically, not advisorily.** This is the big win over
  the Set-1 answer. Because advance/slice/claim share ONE per-item lock, you CANNOT advance an item
  that is being implemented, or claim one that is being advanced, the second acquirer loses the SAME
  CAS. No TOCTOU window (the exclusion IS the lock, not a check-then-act eligibility bar), no
  slicing-release stale-check needed as the only backstop. The maintainer's original instinct ("one
  lock per item makes advancing/slicing/implementing mutually exclusive") is REALISED here, and it is
  the FIRST candidate where issue 3 is solved by construction rather than mitigated.
- **The `→done` on-branch atomicity exception SURVIVES, cleanly, and is now the ONLY main move class.**
  Unlike C7/C7-alt (which dissolved `→done` into a cross-ref reconciliation), C8 KEEPS `backlog→done`
  (and `prd→prd-sliced`) as real `main` moves, atomic with the code/slices they assert, exactly as the
  branch-carries PRD wants for done. So there is NO new cross-ref reconciliation for the referenceable
  promotions, they stay single-ref on `main`. The cross-ref surface shrinks to just "hold/release a
  lock on the lock ref around a `main` promotion", which is the SAME shape as today's claim-then-build
  -then-complete, only the intermediate hold moved off `main`.

**What `in-progress` and `needs-attention` BECOME (the honest mapping):**

- **in-progress** = the item's lock is HELD (for the `implement` action). `status`/`scan` read the lock
  ref to list held items, exactly as they read `<mirror>/main:work/...` today, retargeted to the lock
  ref. The item's CONTENT stays at `work/backlog/<slug>.md` on `main` (it does NOT move on claim), so
  the `--resume` body read (`readSliceOnArbiter`) reads from `backlog/` on `main` PLUS checks the lock
  ref for held-ness, no body relocation, the body never leaves `backlog/` until the `→done` promotion.
  This is actually SIMPLER than today (today claim MOVES the body to in-progress/; here it does not).
- **needs-attention** = the lock is held in a STUCK sub-state, the lock entry carries the reason (body
  prose) and a `stuck: true`-style marker. A human picks it up by resolving the stuck lock (or
  `requeue` = release the lock, leaving the item in `backlog/` where it already is). The recoverable
  WORK still lives on the kept `work/<slug>` branch (unchanged). So needs-attention stops being a
  `main` folder and becomes a state of the per-item lock, the surface is read from the lock ref by
  `status`.

**The costs / open questions C8 must answer (honest):**

1. **`status`/`scan` read the lock ref for operational status** (held/stuck items), so that read is
   ref-based (the code already reads refs, so this is a retarget, not a new mechanism) and, if the lock
   ref is remote, network-bound for the operational view. The REFERENCEABLE state (backlog/done/prd/
   prd-sliced) stays offline-on-`main`, so eligibility/selection stay offline, only the
   "what's-in-flight" view needs the lock ref. Better than C7-alt (all reads off-main) and even C6
   (which moved status folders off main); C8 moves only the LOCKS off main and keeps ALL content +
   both referenceable promotions ON main.
2. **One lock per item means an item can hold ONLY ONE action at a time, BY DESIGN.** Confirm this is
   desired for every pair. Advance-while-claimed and slice-while-claimed are CORRECTLY excluded (the
   point). The one case to check: does any legitimate workflow need TWO actions on one item
   concurrently? (e.g. advancing a PRD while it is `prd-sliced`?) The taxonomy idea noted an item has
   multiple orthogonal actions OVER ITS LIFE (answer it, later build it), but never SIMULTANEOUSLY, so
   one-lock-at-a-time is right. Record this as the load-bearing assumption: actions over an item are
   SEQUENTIAL, never concurrent, so a single mutex per item is correct.
3. **The lock entry now carries semantic payload** (which action holds it; the stuck reason). It is no
   longer a pure presence marker, it is a small state record (action + holder + optional stuck reason).
   Fine (the advancing marker body already carries holder/since/reason), but it means the lock ref's
   entry format is a designed schema, not just "file exists."
4. **Crash-safety / recovery** repoints to the lock ref: a crashed hold leaves a lock entry (today's
   `release-advancing` + `gc --ledger` generalise to `release-lock <item>` + a stuck-lock report).
   The kept `work/<slug>` branch still holds recoverable work. Mechanically the same as the
   already-landed advancing-lock crash-safety, generalised from one action to all three.
5. **Migration:** the two promotions already exist as `main` moves (keep them). Claim/surface/slicing
   STOP moving `main` folders and START holding the per-item lock, the in-progress/needs-attention/
   slicing folders are RETIRED from `main` (their state moves to the lock ref). This is a real
   migration (every claim/surface/slicing-lock call site retargets), but the read/write ledger seams
   exist precisely to localize it, and the lock ref work already exists (advancing-lock) to generalize.

**Why C8 is the best Set-2 design (and arguably the best overall):**

- It is the ONLY candidate that solves all THREE issues BY CONSTRUCTION (1 via C2-on-the-lock-ref,
  2 by locks-off-main, 3 by one-lock-per-item-atomic-exclusion), with NO advisory mitigations and NO
  cross-ref reconciliation for the durable promotions.
- It KEEPS content checked out on `main` (fixes C7-alt's fatal flaw) and keeps the referenceable
  resting states (`done`, `prd-sliced`) AND the durable terminal record (`out-of-scope`) as real `main`
  files, so eligibility/dependency resolution stays offline + on the same ref it is today, ZERO change
  to `blockedBy`/`sliceAfter`.
- It shrinks `main`'s `work/` churn to the THREE rare durable transitions, the smallest possible `main`
  write surface, which ALSO eases (does NOT fully solve, see amendments) the protected-main story: only
  durable resting records reach `main`, and on a protected `main` those route through the existing
  PR-merge path while claim + intermediates never touch `main` at all.
- The "status = the folder" invariant is PRESERVED where it is referenceable (`done`/`prd-sliced` ARE
  folders on `main`) and DELIBERATELY replaced by "status = the per-item lock state" where it is
  transient (in-progress/needs-attention/slicing/advancing), which is HONEST: those were never
  referenceable states, so encoding them as folders was the overload C8 removes.

The one thing C8 trades away is exactly the dropped requirement, a human can no longer `ls work/` and
see in-progress/needs-attention (they run `status`, which reads the lock ref). Content, backlog, done,
prd, prd-sliced all stay `ls`-able on `main`. So C8 is the precise, minimal expression of "drop ONLY
transient-status human-visibility, keep everything else."

**Set-2 recommendation (UPDATED): C2 (on the lock ref) + C8.** C7/C7-alt are superseded by C8
(C7-alt rejected for removing content from the checkout; C7's body/position split is unnecessary once
you see in-progress/needs-attention are not referenceable and can be pure lock state). C8 is the
recommended Set-2 design and the strongest candidate found.

### Pressure-test amendments (adversarial pass + maintainer questions, 2026-06-17)

The four amendments summarised at the top of C8, in full. None is fatal; all are folded into the
design above. Two more (objections 5, 6) are recorded here.

**Amendment 1, out-of-scope is a third durable `main` record (objection 1).** Verified
`LEDGER_STATUS_FOLDERS = backlog/in-progress/needs-attention/done/out-of-scope` (`ledger-lint.ts`).
`out-of-scope/` is written by a `git mv` on `main` (`apply-persist.ts` `moveResolvedItemToTerminal`)
and nothing resolves against it, it is a permanent "won't do" record a human browses. So it is
neither referenceable-resting NOR transient: it is a DURABLE TERMINAL record. It STAYS a file on
`main` (a `backlog , out-of-scope` move), making THREE `main` move classes. NOTE the code today writes
`out-of-scope` and `needs-attention` through the SAME terminal-move helper, C8 must SPLIT that helper
(out-of-scope , `main`; needs-attention , a stuck lock on the lock ref). The governing rule replaces
the "two promotions" framing: **durable resting record (`done`/`prd-sliced`/`out-of-scope`) , `main`;
transient hold , lock ref.**

**Amendment 2, the lock entry is a two-axis record (objection 2, the maintainer's question).** Folded
into design point 3 above: `action: implement|slice|advance` (WHAT it is locked on) is INDEPENDENT of
`state: active|stuck`(+reason). A single "action + optional reason" field could not represent
"advanced-and-stuck" vs "building-and-stuck", two fields can. Subtlety: `needs-attention` is reachable
today from `in-progress` OR `done` (a rebase-conflict bounce moves `done , needs-attention` via
`publishSurfaceCommit`'s WORK_FOLDERS handling). Under C8 a `done` item is a resting file on `main`
with NO lock, so if it later needs attention you ACQUIRE a fresh stuck-lock for it, meaning `done` on
`main` + a stuck lock on the ref can legitimately co-exist. The recovery story must allow that combo.

**Amendment 3, protected-main is PARTIALLY solved (objection 3, the maintainer's question), the
sharpest correction.** The ADR's contradiction: on a protected `main` the server REJECTS direct pushes
to `main`, so the claim CAS (`...:main --force-with-lease`) is rejected , no agent can claim. C8's
effect on the `main`-write set:
- claim , lock ref. **Removed from `main`.** This DOES fix the ADR's named contradiction ("no agent can
  claim"), and matches the ADR's stated boundary exactly ("claim + in-progress + needs-attention served
  by a substrate that never writes `main`").
- in-progress / needs-attention / slicing / advancing , lock ref. **Removed from `main`.**
- BUT `done` / `prd-sliced` / `out-of-scope` STAY `main` writes. On a protected `main` those direct CAS
  pushes are ALSO rejected.
So C8 unblocks CLAIMING on a protected `main` (the bulk of the contradiction) but the DURABLE
PROMOTIONS still need `main`, and on a protected repo they must route through the EXISTING propose/PR
merge path (the ADR already anticipated "`done`/`backlog` reaching `main` via merged PRs"), NOT a
direct push. HONEST verdict: **C8 makes protected-main TRACTABLE (claim + all intermediates leave
`main` cleanly), it does NOT "incidentally unblock" it for free**, the done-via-PR-merge step is real
work and slightly re-introduces a done-vs-code reconciliation on protected repos (the PR merges code;
recording `done` rides that merge). On an UNPROTECTED `main` (the common case) the three promotions are
direct leased CAS ff as today, no PR needed. So: full win for claim everywhere; terminal promotions are
direct on unprotected `main`, PR-routed on protected `main`.

**Amendment 4, the lock ref is a hidden non-branch ref (objection 4, the maintainer's question).**
- **Use `refs/agent-runner/locks` (or similar), NOT `refs/heads/*`.** A branch shows in the GitHub UI
  branch list (noise), appears in `git branch -a`, is caught by "delete merged branches" automation,
  and invites manual deletion. `refs/agent-runner/*` is invisible to the GitHub UI and to a default
  `git clone` (default refspecs fetch only `refs/heads/*` + `refs/tags/*`), pushed/fetched only by the
  runner's explicit refspec. CAVEAT to verify before building: some hosts restrict pushing custom
  `refs/*` under an org ruleset, on a bare `file://` arbiter custom refs work freely (kill criterion
  safe); confirm GitHub accepts `refs/agent-runner/*` under the target ruleset, else fall back to a
  protection-exempt well-known branch.
- **Accidental deletion = "all locks released," RECOVERABLE, not catastrophic.** The WORK is safe (it
  lives on the `work/<slug>` branches; content on `main`), the lock ref holds only who-holds-what. Worst
  realistic case is a DOUBLE-CLAIM (two runners both see an item free), bounded: the re-created lock CAS
  re-serialises, and a double-build surfaces at integration (one-slug-one-folder / divergent-base
  guard). Blast radius is FAR smaller than today's forbidden `--force` to `main` (which destroys work);
  the lock ref loses only coordination state and is self-healing (re-acquired on next claim). Treat an
  absent lock ref as "no locks held" (exactly as `listAdvancingMarkers` treats an absent dir , `[]`).
  ONE hardening item: a runner whose OWN lock vanished mid-build must detect it (its release finds
  nothing) and abort/needs-attention rather than silently "clean-release."

**Amendment 5, the claimable-pool retarget (objection 5, understated scope).** Because the body stays
in `backlog/` while the lock is held, `backlog/` is NO LONGER the clean "claimable pool" it is today
(today claim MOVES the body out to `in-progress/`, so "in backlog" == "unclaimed"). Under C8 the
selection hot path (`scan.ts`, `select-priority.ts`, `mirror-pool-scan.ts`) and the claimability check
(`claim-cas.ts` ~L281) must read the lock ref and SUBTRACT lock-held slugs ("claimable = in `backlog/`
on `main` AND no lock held"). Atomicity HOLDS (the lock-ref CAS still picks one winner, invariant A
intact), the only cost is the enumerator is not transactional with the claim, so it can propose a
held item and waste a claim attempt that then loses the lock CAS, slightly MORE claim churn, which is
exactly why C2 on the lock ref is MANDATORY not optional. This is a broader retarget than "claim simply
stops moving the file", every reader that treats `backlog/` as the pool learns the lock ref.

**Amendment 6, cross-substrate crash-safety (objection 5 tail + invariants).** A complete is: hold
lock , land code+`done`-move on `main` , release lock. A crash between "done on `main`" and "release
lock" leaves a `done`-on-`main` item with a still-held lock, recovery must treat "item is in `done/` on
`main`" as authoritative and release/ignore the stale lock (the same shape as today's already-landed
advancing-lock crash-safety + `release-lock`/`gc --ledger` report, generalised). Invariants A (one
winner via the lock-ref CAS), D (custom-ref `--force-with-lease` push works on a bare `file://` arbiter
identically to `main`), and F (never `--force`, the lock ref uses a lease, `main` writes are leased ff
or PR-merge) all HOLD.

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

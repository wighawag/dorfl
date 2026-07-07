<!-- dorfl-sidecar: item=task:cross-job-ref-based-land-lock type=task slug=cross-job-ref-based-land-lock allAnswered=false -->

## Q1

**Stale-lock reclaim mechanism: what makes a ref-lock held by a crashed job reclaimable, so it does not become a self-inflicted deadlock strictly worse than the floor's spurious bounce? Pick one and justify: (a) TTL encoded in the lock-ref's value with a wall-clock check; (b) a holder-liveness check (against what signal? there is explicitly no heartbeat in the per-item lock model); (c) a human-only reclaim verb (release-lock-style) that refuses to ship without admin opt-in.**

> Pre-existing needsAnswers Q1 in the task body. CRITICAL conceptual-coherence context the codebase pins: the per-item lock recovery doctrine is already an accepted invariant. docs/adr/ledger-status-on-per-item-lock-refs.md states verbatim 'no liveness heartbeat, no auto-sweep (a human asserts a lock is dead)', realised as `release-lock <item>` + the `gc --ledger` stuck-lock report. claim-cas.ts (~L321) refuses auto-reclaim by holder identity precisely because 'holder ids are NOT unique (a CI bot claims many items under one user.name), so a release+re-acquire reclaim could let a concurrent LOSER release the WINNER's still-valid lock — and an automatic sweep contradicts the ADR's recovery model'. The landed `gc --ledger --reap-stale-locks` (tasks/done) is an OPT-IN, human-asserted, leased-delete sweep that only reaps locks whose item is already TERMINAL on main — it never guesses liveness. So option (b) has no signal to use and option (a)'s wall-clock TTL would be the first auto-liveness-guess in the system, in tension with the ADR. Option (c) is the only one coherent with existing doctrine, but a land-lock holder's item is NOT terminal-on-main while held, so the existing reaper's terminal-on-main eligibility does not directly apply — the reclaim story for a land-lock is genuinely new.

_Suggested default: Option (c): a human-mediated reclaim (release-lock-style verb / opt-in gc sweep), modelled on the existing `gc --ledger --reap-stale-locks` leased-delete, since it is the only option coherent with the ADR's no-auto-sweep/no-heartbeat doctrine. A wall-clock TTL (a) should be rejected unless the ADR is deliberately revised, because it introduces auto-liveness-guessing the system explicitly forbids._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Option (c): a human-mediated reclaim (release-lock-style verb / opt-in gc sweep), modelled on the existing `gc --ledger --reap-stale-locks` leased-delete. It is the only option coherent with the ADR's no-auto-sweep / no-heartbeat doctrine. Reject (a) wall-clock TTL: it introduces the first auto-liveness-guess in the system, in direct tension with docs/adr/ledger-status-on-per-item-lock-refs.md. (b) has no signal to use (no heartbeat). Note the genuinely-new wrinkle: a held land-lock's item is NOT terminal-on-main, so the existing reaper's terminal-on-main eligibility does not directly apply, the reclaim story here needs new design, which feeds Q2. NOTE: this task is currently in tasks/cancelled/, so this answer informs the follow-on prd, not a live build.

## Q2

**In-scope-now vs follow-on: given the resolved reclaim mechanism, is this slice cheap enough to ship in this prd, or should it be split into a follow-on prd and this slice cancelled? The prd explicitly allows the latter.**

> Pre-existing needsAnswers Q2 in the task body, and it mirrors the prd's own gating condition. land-time-reverify-and-parallel-merge-ceiling Applied Answer q1 says verbatim: 'If a robust stale-lock story is not cheap, ship (a) scaled NOW and split (b) into a follow-on slice rather than ship a deadlock-prone lock.' The floor (merge-retries-gate-precedence, also covers:[5]) is the shipped serialiser regardless; THIS task is the OPTIONAL accelerator (b). So the honest decision depends entirely on Q1's answer: if the coherent reclaim is human-mediated (option c), it likely cannot fully reclaim a crashed land-lock holder cheaply/soundly (the held item is not terminal-on-main), which is exactly the 'not cheap' trigger the prd names for splitting out / cancelling.

_Suggested default: If Q1 resolves to a human-only reclaim that cannot soundly auto-reclaim a crashed holder cheaply, SPLIT this accelerator into a follow-on prd and cancel this slice now (ship only the scaled mergeRetries floor), per the prd's explicit allowance. Keep in this prd only if a sound, cheap reclaim is confirmed._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

SPLIT into a follow-on prd (which is effectively what the cancelled status already reflects). Given Q1 resolves to human-only reclaim that cannot soundly/cheaply auto-reclaim a crashed land-lock holder (the held item is not terminal-on-main), this hits exactly the "not cheap" trigger the parent prd named for splitting out. Ship only the scaled mergeRetries floor now (merge-retries-gate-precedence); keep the ref-based land-lock accelerator as a separate follow-on prd to be designed with a sound reclaim story.

## Q3

**Lock granularity: one global land-lock per repo, or per-target-branch?**

> Pre-existing needsAnswers Q3 in the task body. Per-repo is simpler; per-branch matches future multi-branch land flows. Note: the prd's stated scope lands onto a single `<arbiter>/main` (the floor/ceiling framing, the freshWorktreeGate rebase-onto-main, and the CAS push all target main), so multi-branch land is not exercised by anything currently in this prd — per-branch would be speculative now. The chosen ref name (the task suggests `refs/dorfl/land-lock`) should also sit coherently in the existing `refs/dorfl/lock/<entry>` namespace used by the per-item locks (scan.ts ~L185, status.ts), so it is reported/swept by the same machinery rather than forking a parallel ref convention.

_Suggested default: One global land-lock per repo (`refs/dorfl/land-lock` or a single entry under the existing `refs/dorfl/lock/*` namespace), since the prd only lands onto a single main today; defer per-branch until a concrete multi-branch land flow exists. (Moot if Q2 resolves to split/cancel.)_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

One global land-lock per repo, named to sit inside the existing `refs/dorfl/lock/*` namespace so it is reported/swept by the same scan/status/gc machinery rather than forking a parallel ref convention. The prd only lands onto a single main today, so per-branch would be speculative. (Largely moot given Q2 = split/cancel, but this is the intended shape for the follow-on prd.)

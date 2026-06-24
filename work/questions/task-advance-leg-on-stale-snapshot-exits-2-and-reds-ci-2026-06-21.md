<!-- dorfl-sidecar: item=task:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 type=task slug=advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 allAnswered=false -->

## Q1

**What is the exact new exit code for the 'item already in a terminal folder' (benign-skip) outcome, and how should the matrix workflow tolerate it?**

> The source observation's Q2 lean is 'a NEW distinct tolerated non-zero code', noting the codebase already uses exit 3 for `contended` (a tolerated 'this is fine' outcome) and the matrix workflow already tolerates `contended` legs. The slice needs a concrete number (e.g. exit 4 for 'gone-terminal'?) and a concrete tolerate-list change in `.github/workflows/advance-lifecycle.yml`. Refs: `src/claim-cas.ts:270`+`:332`, `src/do.ts` ~L553 (current `outcome:'lost'`→exit 2 mapping); ADR `ci-config-policy-and-gate-family` §7.

_Suggested default: Exit 4 with `outcome: 'gone-terminal'`, added to the workflow's tolerated-codes list alongside the existing `contended` (exit 3) tolerance; exit 2 stays reserved for 'no such slug anywhere on main' (genuine error)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**What is the precise three-way classification the claim-CAS pool-check must produce, and which `main`-side folders define each bucket?**

> The observation proposes distinguishing (a) terminal — `tasks/done/`, `tasks/cancelled/`, plus 'brief `tasked/`/`dropped/`'; (b) staged — `tasks/backlog/` 'exists but not claimable'; (c) nowhere — keep loud exit 2. The slice needs the canonical folder list per bucket (does `prds/dropped/` count as terminal for a PRD item? does `tasks/ready/` belong with backlog as 'staged but not pool', or IS it the pool?) so the check is unambiguous to implement and test.

_Suggested default: Terminal = `tasks/done/` ∪ `tasks/cancelled/` (and `prds/done/` ∪ `prds/dropped/` for PRDs); staged-but-not-pool = anything else under `tasks/`/`prds/` on `main` that the eligibility scan rejected; nowhere = slug absent from every `work/{tasks,prds}/**` path on `main`._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**What is the spelling, scope, and default of the opt-in flag that gates benign-skip behaviour, and where does CI set it?**

> Observation Q3 answer: flag-gated (e.g. `--quiet-if-gone`) set by the matrix leg; interactive default stays LOUD exit 2 on already-done. The slice must pin: the exact flag name; whether it applies to `advance` only or also `do`/`claim`/`scan`; whether it lives on the CLI surface or as an env var; and the exact `.github/workflows/advance-lifecycle.yml` line where the matrix leg passes it.

_Suggested default: `--quiet-if-gone` on `advance` only (the only verb the matrix leg invokes); off by default; passed explicitly in the `advance-propose` matrix leg (~L274) alongside `--propose --watch --arbiter origin`._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should the message-conflation fix (three distinguishable messages for terminal / staged / nowhere) ship as the SAME task as the exit-code + flag change, or be split into a smaller standalone task that lands first?**

> The observation's q1 answer notes 'the message-conflation fix is uncontested and wanted regardless' and 'INDEPENDENTLY and regardless of the flag, ALWAYS fix the message conflation'. The two changes touch the same two sites (`src/claim-cas.ts:270`/`:332`) and the same exit-mapping in `src/do.ts` ~L553, so coupling is cheap; but splitting would let the uncontested half land while exit-code semantics are still in review.

_Suggested default: Ship together as this one task — same two call sites, same mapping function, and the new exit code is what makes the three messages actually distinguishable to CI (not just to a human reading logs)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**What acceptance tests gate this task — specifically, is a reproduction of the enumerate→merge→fan-out race in CI required, or is unit coverage of the three claim-CAS branches + a workflow-level assertion that the tolerated exit code is in the matrix's allow-list sufficient?**

> The original failure (the run that triggered the observation) was a real cross-job race in `.github/workflows/advance-lifecycle.yml` between the `enumerate` job (~L174–223) and a fanned-out `advance-propose` leg (~L274). Reproducing that race deterministically in a test is non-trivial; unit-testing the pool-check branch in `src/claim-cas.ts` against a fixture `origin/main` tree is straightforward.

_Suggested default: Unit tests over the three claim-CAS branches (terminal / staged / nowhere) against a fixture worktree, PLUS a workflow lint/assert that the new tolerated exit code is in the matrix leg's tolerate list. No live race reproduction required — the ADR §7 already accepts the race as benign-by-design; the test target is the CLASSIFIER, not the race._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

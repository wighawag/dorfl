<!-- dorfl-sidecar: item=observation:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 type=observation slug=advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 allAnswered=false -->

## Q1

**Triage this observation: promote to a task, promote to an ADR, keep as a note, or drop?**

> The observation captures two defects in `dorfl advance`'s pool-check at `src/claim-cas.ts:270` and `:332` (both returning `{exitCode:2, outcome:'lost'}` with the literal `'<backlog>' not found on <arbiter>/main (already done/removed, or wrong slug).'`, mapped to exit 2 by `src/do.ts` ~L553):
>   1. a benign stale-snapshot matrix leg (item already in a terminal folder) reds CI — ADR `ci-config-policy-and-gate-family` §7 explicitly calls this race benign-by-design;
>   2. the message + exit conflate a benign already-done race with a real typo'd slug.
> An Applied-answers block (twice, on 2026-06-22) already records the human's judgement: `promote-slice` with Q2 (lean: a NEW distinct tolerated non-zero code, mirroring the existing `contended`=exit-3 pattern that the matrix already tolerates) and Q3 (flag-gated e.g. `--quiet-if-gone` set by the CI matrix leg; interactive default stays loud; and the message-conflation fix is wanted unconditionally) baked in for the slice spec. But: the observation still sits at `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` with `needsAnswers: false`, no task or brief has been created (`grep` across `work/tasks` and `work/briefs` finds no match for `stale-snapshot` / `quiet-if-gone` / `already done/removed`), and the answered disposition `promote-slice` is NOT in the engine's allowed set (`promote-task | promote-adr | keep | delete | dropped | needs-attention`) — so nothing has routed it. The residue is: confirm the disposition in an engine-recognised value so the observation can advance.

_Suggested default: promote-task — the human's recorded answer was `promote-slice`, which maps to `promote-task` in the engine's vocabulary. The slice should carry: (a) the message-disambiguation fix at `src/claim-cas.ts:270`/`:332` distinguishing terminal / staged-but-not-pool / nowhere (unconditional), and (b) a `--quiet-if-gone` (or equivalent) flag the workflow's matrix leg sets, mapping the already-terminal case to a NEW distinct tolerated non-zero exit (parallel to `contended`=exit 3) while the interactive default stays loud exit 2._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

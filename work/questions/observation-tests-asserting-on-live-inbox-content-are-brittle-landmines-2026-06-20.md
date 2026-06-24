<!-- dorfl-sidecar: item=observation:tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 type=observation slug=tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 allAnswered=false -->

## Q1

**The 2026-06-22 applied-answers block on this observation chose 'promote-slice (audit only)' — audit the test suite for any other assertion that reads the LIVE work/notes/ tree and convert each to a self-seeded throwaway-tree fixture — but no corresponding task/brief exists in work/tasks/ or work/briefs/, the observation still sits in the inbox, and a quick grep (`resolve(__dirname, '..')`-style scans of `work/notes/observations|findings|ideas` from test code) turns up no remaining offenders beyond the one already fixed on main. Has the audit effectively been completed by that one fix (so this observation should be deleted as discharged), or does a real task still need to be promoted to drive a deliberate sweep?**

> The observation body's 'Suggested disposition' lists (a) audit + (b) a lint guard; the applied-answers block promoted only (a) and explicitly deferred (b). The original RED (`observation-identity-roundtrip.test.ts`, 'MANY minted review-nits obs each round-trip' block) was fixed on main 2026-06-20 by rewriting it to self-seed. Searches for the bad pattern across `packages/*/test` (`grep -rn 'resolve.*__dirname.*\.\.' ... | grep -i 'work/notes'`) return no hits; all remaining `work/notes/...` references in tests are string literals written into scratch repos via helpers like `seedRepoWithArbiter` / `writeNote(repo, ...)`, not scans of the live repo. needsAnswers is already `false`, but the file is still in `work/notes/observations/` because the chosen disposition value ('promote-slice') is not one of the engine's allowed sidecar dispositions (`promote-task | promote-adr | keep | delete | dropped | needs-attention`), so nothing routed it.

_Suggested default: delete — the single instance has been fixed on main and a fresh scan finds no remaining live-inbox test assertions; record the hazard pattern in the existing observation/in the audit-already-done note rather than spawning a bounded task that would find nothing. Re-promote to a real `promote-task` only if the scan above missed a pattern (e.g. fs.readdirSync on a hard-coded repo-relative path that doesn't match the grep used)._

<!-- q1 fields: id=q1 disposition=delete -->

**Your answer** (write below this line):

delete. The single offending instance was fixed on main and a fresh scan finds no remaining live-inbox test assertions; the audit is effectively discharged by that one fix. The hazard pattern stays recorded in the audit-already-done note. Re-promote to a real task only if a later scan surfaces a pattern the grep missed.

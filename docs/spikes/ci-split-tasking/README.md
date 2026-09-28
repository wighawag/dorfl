# RED FIRST evidence for task `ci-split-tasking`

The task asks for the hostile-handoff tests to be shown failing FOR THEIR STATED REASON against a naive stub (not merely a missing-module error), as `docs/spikes/ci-split-intake/` did. This folder records that run against a deliberately naive stub of `packages/dorfl/src/ci-phase-tasking.ts`.

`naive-stub.patch` applies to the real implementation (`git apply docs/spikes/ci-split-tasking/naive-stub.patch` from the repo root) and makes the apply phase trust the handoff:

- `checkTaskingCandidate` returns the candidate exactly as the agent wrote it (no safe-slug, new-at-base, frontmatter-parse, boolean or stamp-overwrite check);
- `checkTrimmedSpecBody` returns the trimmed spec body exactly as the agent wrote it (no pinned gate keys, no required headings);
- the apply phase reads `handoff.json` with a bare `JSON.parse` (no `readHandoff` record validation, so a candidate key such as `../ready/evil` reaches the writer).

Run: `cd packages/dorfl && npx vitest run test/ci-phase-tasking.test.ts`, then `git checkout packages/dorfl/src/ci-phase-tasking.ts` to restore.

## Red (naive stub): 19 failed, 15 passed

- `a candidate outside work/tasks/backlog/` (`../ready/evil`, `../../../evil-root`, `work/tasks/ready/evil`): `expected 'landed' to be 'rejected'`. The stub integrated the run (`Tasked 'big-spec' -> 0 backlog tasks ... landed them on the arbiter main`) instead of refusing it.
- `a candidate that repeats originTrust: trusted cannot launder the stamp`: `expected 'trusted' to be 'untrusted'`. Today's `propagateOrigin` replaces only the first `originTrust:` line while `parseFrontmatter` keeps the last, so the duplicate survived (observation `tasker-drafted-duplicate-origintrust-launders-propagated-stamp`).
- `a candidate whose frontmatter does not parse` (an unclosed fence, no frontmatter, a non-boolean `needsAnswers`, a non-boolean `humanOnly`): `expected 'landed' to be 'rejected'` (`Tasked 'big-spec' -> 1 backlog task`).
- `an edit to a pre-existing staged task this run did not produce is rejected`: `expected 'landed' to be 'rejected'` (`Tasked 'big-spec' -> 2 backlog tasks`: the stub landed the edit to `old-task`).
- `a trimmed spec body that ...` (flips `originTrust`, drops the origin stamp, adds `needsAnswers`, changes `taskedAfter`, changes `issue`, repeats `humanOnly`, drops the User Stories heading, drops the Solution heading, has no frontmatter): `expected 'landed' to be 'rejected'` for all nine.
- `tasking-surface: saves the checked candidates on the work branch and surfaces the spec`: `expected undefined to be 'untrusted'` (the saved candidate carried no stamp because the stub did not overwrite it).

The 15 that pass under the stub do not depend on how the handoff is trusted: the valid-handoff merge and propose lands, the stale-lock refusals, the agent-result cases (failure, timeout, cancel), the agent-phase and lock-phase cases, the blocked-verdict-in-`tasking-land` case (its record check sits outside the stubbed functions), and `a candidate that sets its own originTrust lands under the spec's stamp`, which today's first-line `propagateOrigin` already fixes for a single stamp line (the duplicated-line case above is the one it cannot).

## Green (real implementation, restored byte-identical, sha256 `5a212452…`)

`test/ci-phase-tasking.test.ts` and `test/ci-phase-tasking-e2e.test.ts`: 35 passed. Full gate `pnpm -r build && pnpm -r test && pnpm format:check`: 271 files, 3994 of 3995 tests passed, Prettier clean. The one failure is the known environmental timeout `do-remote.test.ts > the real ~/.dorfl/ and ~/.pi/agent/sessions/ are UNTOUCHED` (it walks the developer's real `~/.dorfl`; observation `do-remote-untouched-dirs-test-walks-the-real-dorfl-home`), which is unrelated to the tasking code and passes on its own with `--testTimeout=180000`.

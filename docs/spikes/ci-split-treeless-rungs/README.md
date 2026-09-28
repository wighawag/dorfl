# RED FIRST evidence for task `ci-split-treeless-rungs`

The task asks for the hostile-handoff tests to be shown failing FOR THEIR STATED REASON against a naive apply stub that trusts the record (not merely a missing-module error), as `docs/spikes/ci-split-intake/` and `docs/spikes/ci-split-tasking/` did. This folder records that run against a deliberately naive stub of `packages/dorfl/src/ci-phase-treeless.ts`.

`naive-stub.patch` applies to the real implementation (`git apply docs/spikes/ci-split-treeless-rungs/naive-stub.patch` from the repo root) and makes the apply phase trust the handoff: `readTreelessHandoff` reads `handoff.json` with a bare `JSON.parse`, so there is no `readHandoff` record validation (the item, the intent kind for the rung, the `outcome` / `disposition` enums, the safe `slug`, the `<task|spec|observation>:<slug>` target) and none of the apply-side rules on top (the rung's own intent kind, an auto-disposition only under `observationTriage: auto`, a target that is not the note itself). Everything downstream is the real code: the checked record is replayed into the same rung body.

Run: `cd packages/dorfl && npx vitest run test/ci-phase-treeless.test.ts`, then restore the file (`git checkout` once it is committed, or reverse the patch with `git apply -R`).

## Red (naive stub): 10 failed, 9 passed

- `an apply-decision naming another item` (the record's `item` is `observation:other-note`): `expected 'applied' to be 'rejected'`. The stub applied the `dispose` verdict to the run's own note (`applied observation:noisy-flake → deleted (source git rm-ed ...)`).
- `an apply-decision minting at a path outside its own` (`../../../evil-root`, `../ready/evil`, `work/tasks/ready/evil`): `expected 'applied' to be 'rejected'`. The stub promoted the note under the sanitised slug (`CREATED work/tasks/ready/evil-root.md`, `ready-evil.md`, `work-tasks-ready-evil.md`) and deleted it, where the real phase rejects the unsafe slug outright.
- `an apply-decision whose outcome is outside APPLY_ALLOWED_OUTCOMES` (`bounce`): `expected 'rung-failed' to be 'rejected'`. The stub replayed an outcome it does not know (`the decision agent produced no usable verdict (Cannot read properties of undefined (reading 'outcome'))`) and never surfaced the note.
- `a triage disposition outside its enum` (`promote`, `delete`): `expected 'applied' to be 'rejected'`. The stub auto-disposed the note by deletion (`auto-triaged observation:noisy-flake → promote of task:fix-the-flake: DELETED the note`), a disposition the triage gate can never emit (the triage rung never promotes).
- `a triage target that is a path, not an item` (`../../README.md`): `expected 'applied' to be 'rejected'` (`duplicate of ../../README.md: DELETED the note`).
- `a triage auto-disposition when observationTriage is not auto`: `expected 'applied' to be 'rejected'`. Under `ask` the rung never consults the triage gate, so the stub silently surfaced the question instead of refusing a disposition no gate produced.
- `an intent of another rung (a surface record on the apply rung)`: `expected 'rung-failed' to be 'rejected'` (the stub read a `surface` record on the `apply` rung and failed downstream).

The 9 that pass under the stub do not depend on how the handoff is read: the agent-result cases (failure, timeout, a real cancel, a failing rung in the agent phase), the publish-scope refusal, the lock-phase refusals (an answered `kind: merge`, a pending sidecar), the stale-lock refusal and the `advance --phase` routing.

## Green (real implementation restored)

`test/ci-phase-treeless.test.ts` (19) and `test/ci-phase-treeless-e2e.test.ts` (12 three-process scenarios, each compared with the laptop path's end state): 31 passed. Full gate `pnpm -r build && pnpm -r test && pnpm format:check`: 273 files, 4025 of 4026 tests passed, Prettier clean. The one failure is the known environmental timeout `do-remote.test.ts > the real ~/.dorfl/ and ~/.pi/agent/sessions/ are UNTOUCHED` (it walks the developer's real `~/.dorfl`; observation `do-remote-untouched-dirs-test-walks-the-real-dorfl-home`), unrelated to this code, which passes on its own with `--testTimeout=180000`.

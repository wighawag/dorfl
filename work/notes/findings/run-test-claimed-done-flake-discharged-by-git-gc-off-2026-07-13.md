# Findings: `run.test.ts` `claimed-done` flake is discharged on main

Date: 2026-07-13
Task: `harden-run-test-claimed-done-flaky-under-full-suite`
Discharging artifact: commit `4fb7d87d` — "test: kill the ENOTEMPTY teardown flake at the root (disable git auto-gc)"

## What was checked

The task's re-scope (2026-07-13) asked: before inventing a fix, verify whether
the flaky assertion at `packages/dorfl/test/run.test.ts:~633`
(`expect(result.items[0].status).toBe('claimed-done')`) still reproduces under
full-suite parallelism on current main. If 3 consecutive `pnpm -r build && pnpm -r test`
runs are green FOR THAT ASSERTION, the flake is discharged by the git-auto-gc-off
root fix in `gitEnv` (commit `4fb7d87d`) and no code change is warranted.

## Recipe

Full-suite loop on the runner (Linux, GitHub-hosted, 4-core class):

```
for i in 1 2 3; do
  pnpm -r build && pnpm -r test
done
```

Each `pnpm -r test` fans out to vitest's default per-file parallelism (216 test
files, ~3080 tests, ~5–6 min per invocation).

## Result — the `claimed-done` assertion: 3 / 3 GREEN

Run 1: GREEN (all 3080 tests passed).
Run 2: RED — but on a DIFFERENT assertion in a DIFFERENT file (see below).
       The `claimed-done` assertion in `run.test.ts` did NOT fire.
Run 3: GREEN.

So the target assertion this task was created for did not flake in any of 3
consecutive full-suite runs. That matches the task's re-scoped "already
discharged" branch: `run.test.ts` uses the SHARED `gitEnv()` from
`packages/dorfl/test/helpers/gitRepo.ts`, which is the site that `4fb7d87d`
patched (`gc.auto=0` + `maintenance.auto=false` + `gc.autoDetach=false` +
`rmrf` budget bump from 10×50ms to 50×100ms). The `claimed-done` line was
one adjacent face of the same background-repack-vs-teardown race that
`4fb7d87d` extinguished.

Per the task Prompt step 4 — "If 3 consecutive `build && test` runs are GREEN
with no code change, the flake is already discharged … do NOT invent a fix
for a flake that no longer bites" — no code change is made for the
`claimed-done` line in `run.test.ts`.

## Sibling observation (out of scope for this task)

Run 2's red bounce was on `packages/dorfl/test/prd-to-spec.test.ts` with
`ENOTEMPTY: directory not empty, rmdir '.../fixture-.../.git/objects'` — the
SAME class of teardown race, but that file has its OWN local `gitEnv()`
defined at line 47 which never received the `4fb7d87d` fix (no
`GIT_CONFIG_COUNT`/`gc.auto=0` threading). That's a duplicate `gitEnv` that
drifted from the shared helper. Recorded as an observation for whoever picks
that up next:
`work/notes/observations/prd-to-spec-test-has-duplicate-local-gitenv-missing-gc-auto-off-fix-2026-07-13.md`.
It is deliberately NOT fixed here (out of this task's scope; the task is
explicitly the `run.test.ts` `claimed-done` line, and the task's guidance is
"do not expand scope, drop a note").

2026-06-17 — observed once: `test/do.test.ts` ("do prd:<slug> dispatches to
the slicing path … autoSlice OFF") failed during scratch cleanup with
`ENOTEMPTY: rmdir '/tmp/agent-runner-do-…/project-work.git'` from
`test/helpers/gitRepo.ts:102` (Scratch.cleanup). A retry of the same
`pnpm -r test` invocation passed cleanly. Suggests an intermittent
not-fully-released filehandle in a child git process — worth keeping an eye on
if it reappears.

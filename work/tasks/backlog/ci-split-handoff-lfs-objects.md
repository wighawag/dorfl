---
title: 'Carry new Git LFS objects through the handoff, validate them strictly and push them before any ref'
slug: ci-split-handoff-lfs-objects
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-apply-rejects-hostile-bundle, ci-split-landed-vs-gated-report]
covers: [8]
---

## What to build

Add full Git LFS support to the split (decision 6):

- agent side: the agent job checks out with `lfs: true` and runs `git lfs install --local`, so a commit of an LFS-tracked path stores a pointer and the object under `.git/lfs/objects/`. The handoff writer scans the blobs added or changed by the new commits for LFS pointers (a blob that parses as a pointer counts, whatever `.gitattributes` says; a legitimate text file that parses as one is treated as one) and copies every referenced object to `lfs/<oid>`, including objects the agent copied from elsewhere in the repository;
- apply side: a strict pointer parser (spec v1: at most 1024 bytes, `version https://git-lfs.github.com/spec/v1`, `oid sha256:<64 hex>`, `size <n>`, keys in order, nothing else); every pointer's object must exist in `lfs/`, be a regular file, have exactly `size` bytes and hash to `oid`; unreferenced extra objects are rejected; size limits apply; objects are pushed with `git lfs push --object-id <arbiter> <oids>` from the apply job's checkout of the trusted base (so `.lfsconfig` comes from `main`), before any ref; every other apply-side git command runs with `GIT_LFS_SKIP_SMUDGE=1`.

### Design reference (carried verbatim from the spec)

- `lfs/<oid>`: every object referenced by an LFS pointer blob added or changed in the bundle's new commits, copied from the agent job's `.git/lfs/objects/`. Every such oid must be present, including one the agent copied from elsewhere in the repository (the agent job's checkout fetched it), so the apply job never has to ask the LFS server what exists.

LFS in the agent job: the checkout uses `lfs: true` (read token), and the setup runs `git lfs install --local` so a commit of an LFS-tracked path stores a pointer and the object under `.git/lfs/objects/`, as on a laptop. dorfl's handoff writer finds the pointers by scanning the blobs of the new commits (a blob that parses as a pointer counts, whatever `.gitattributes` says), not by trusting `git lfs ls-files`. Accepted consequence: a legitimate text file that happens to parse as a pointer (a test fixture, say) is treated as one, and its object must be present or the handoff is rejected.

- **LFS** (decision 6): the apply job scans every blob added or changed by the new commits for LFS pointers with a strict parser (the spec v1 format: at most 1024 bytes, `version https://git-lfs.github.com/spec/v1`, `oid sha256:<64 hex>`, `size <n>`, keys in order, nothing else). For every pointer, `lfs/<oid>` must exist, be a regular file, have exactly `size` bytes and hash to `oid`; a missing, extra, oversized or mismatching object rejects the whole handoff. Files in `lfs/` that no pointer references are rejected too (they would only consume LFS quota). The objects are pushed with `git lfs push --object-id <arbiter> <oids>` from the apply job's checkout of the trusted base (so `.lfsconfig` and the LFS endpoint come from `main`, never from the bundle), before any ref is pushed, so a ref never lands pointing at a missing object. Every other git command in the apply job runs with `GIT_LFS_SKIP_SMUDGE=1`. Because the LFS endpoint is configured by `.lfsconfig`, it joins the protected paths of decision 3 (an agent that changed it in merge mode could redirect a later push). Content addressing means a hostile object can only be itself: it cannot overwrite another object.

6. **Git LFS.** Decided: full LFS support in this spec (not fail-closed). See task `ci-split-handoff-artifact-format` and task `ci-split-apply-rejects-hostile-bundle` for the handoff and the validation; the LFS path gets its own hostile-artifact tests.

## Acceptance criteria

- [ ] Hostile tests, RED FIRST (written and run before the implementation, the failing run quoted in the report; arbiter unchanged, reason names the rule): a pointer with no object; an object whose hash or size does not match its pointer; a malformed pointer; an unreferenced extra object; an object over the size limit; a `.lfsconfig` change (rejected by the protected-path rule).
- [ ] An end-to-end LFS build case: the stub agent commits a file under an LFS-tracked pattern; the arbiter is a local bare repository served through git-lfs's standalone file transfer (`file://`); the test asserts the object reached the arbiter's LFS store BEFORE the ref, and that the agent-phase clone uploaded nothing. The case needs `git-lfs`: it must not silently skip in CI (GitHub-hosted runners have it); locally it may skip with a message naming the missing binary.
- [ ] Tests cover the new behaviour; the acceptance gate is green.
- [ ] Objects are pushed before the ref for EVERY code-carrying intent, not only `integrate`: the WIP branch pushes of `needs-attention`, `deadline-checkpoint`, `stop` and `agent-failed` go through the same ordered push; a three-process `needs-attention` case with a new LFS file asserts the object reached the LFS store before the WIP ref. (The answered-merge push reuses this in task `ci-split-answered-merge-action`.)

## Blocked by

- `ci-split-apply-rejects-hostile-bundle`
- `ci-split-landed-vs-gated-report`

## Prompt

> Add Git LFS objects to the CI handoff: the writer in the agent phase, the strict validation and the ordered push in the apply phase, plus the LFS hostile tests and the end-to-end LFS build case. Build on the handoff module, the bundle validation and the build-path split (the task's blockers). Follow the reference text.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

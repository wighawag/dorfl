---
title: review-gate non-blocking nits for 'autoslice-lock' (Gate 2 approve)
date: 2026-06-07
status: open
slug: autoslice-lock
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'autoslice-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The releaseSlicingLock `lockedBlob` JSDoc claims that if `lockedBlob` is omitted, release 'falls back to a rebase-conflict-only check (which can MISS a clean rename+edit merge).' That is inaccurate: when `lockedBlob === undefined` the code skips the stale check ENTIRELY and unconditionally restores `slicing/ → prd/`, silently carrying any concurrent edit into prd/ — exactly the 'never silently overwrite the edit' behaviour the slice forbids. Correct the docstring (and ideally make the omitted-blob path refuse rather than silently overwrite) before the `do prd:<slug>` command slice consumes this primitive.
  (packages/agent-runner/src/slicing-lock.ts — ReleaseSlicingLockOptions.lockedBlob JSDoc vs runRelease/releaseAttempt: the stale check is guarded by `if (lockedBlob !== undefined)`, with no else/fallback. No live caller today (do prd: is not wired), so non-blocking, but it is a latent footgun the JSDoc actively masks.)
- `acquireSlicingLock`/`releaseSlicingLock` are not re-exported from packages/agent-runner/src/index.ts, unlike the direct analog `performClaim` (claim-cas.ts). Intentional? In-package callers can import via './slicing-lock.js', so nothing is blocked, but it breaks public-API parity with the claim primitive.
  (index.ts exports `performClaim` from './claim-cas.js' (line 150); grep finds no slicing-lock export. run.ts imports performClaim via the relative path, so the future command can likewise import the lock primitives directly — hence no live consumer is blocked.)
- Release is documented (in the releaseAttempt JSDoc) as 'REBASE that restore onto the CURRENT arbiter main,' but the implementation does not rebase — it checks out fresh on current main and restores directly after a content-identity stale check. The chosen content-identity mechanism is correct and arguably stronger than the spec's 'rebase + conflict' (it catches the silent rename+edit clean-merge case a textual rebase would miss), but the 'rebase' wording in both the slice text and this docstring no longer matches the code and could mislead a future reader. Consider aligning the prose to 'content-identity stale check + leased CAS restore.'
  (packages/agent-runner/src/slicing-lock.ts releaseAttempt JSDoc says 'then REBASE that restore onto the CURRENT <arbiter>/main'; the code does `checkout -b releaseBranch arbiter/main` + `git mv` + leased push, with the blob-identity check as the staleness gate. Behaviourally satisfies criterion 4 (tested: exit-4 stale, arbiter untouched); this is a wording-vs-implementation mismatch, not a behavioural defect.)

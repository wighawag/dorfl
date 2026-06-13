---
title: review-gate non-blocking nits for 'ledger-one-slug-one-folder-lint-and-sweep' (Gate 2 approve)
date: 2026-06-13
status: open
slug: ledger-one-slug-one-folder-lint-and-sweep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'ledger-one-slug-one-folder-lint-and-sweep' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: `gc --ledger` exits non-zero (process.exit(1)) when the ledger is corrupt. This is an in-scope decision the slice did not specify (it said 'REPORT, never auto-delete' but not the exit code). A fail-loud exit is reasonable and is justified in-code as mirroring the integration core's refusal, but it is a new user-visible behaviour on the `gc` command that a script wrapping `gc --ledger` will now see. The agent did not record this in a Decisions block (the diff is uncommitted with no PR description yet).
  (cli.ts gc action: `process.exit(result.duplicates.length > 0 ? 1 : 0)` inside the `if (flags.ledger !== undefined)` branch. The non-ledger worktree-reaper path is unaffected.)
- Ratify the read-source split: `scan`/`status` lint the registered mirror's committed `main` ref, but `gc --ledger [repoPath]` lints a LOCAL working tree (cwd by default), not the arbiter. This means a corruption that exists on the arbiter `main` but not in your local checkout is caught by scan/status but NOT by `gc --ledger`, and vice-versa. The choice is coherent (gc is a cwd/local command) but is an unstated design decision worth a human nod.
  (cli.ts uses `sweepLedgerDuplicates(repoPath)` → `lintLocalLedger` (readdirSync of the working tree), whereas scan.ts/status.ts use `lintRefLedger('main', mirrorPath, ...)` (git ls-tree of the bare mirror ref).)
- Minor inconsistency in slug derivation between the two readers: the LOCAL reader keys on frontmatter `slug:` (falling back to filename), while the REF reader keys on the FILENAME only (it deliberately skips reading each blob to avoid an extra `git show`). For a ledger where claim/done moves always name files after the slug this is equivalent, but a hand-edited file whose frontmatter slug differs from its filename would be detected by `gc --ledger` and missed by `scan`/`status` (or vice-versa). Documented in-code as an intentional cost trade-off; flagging so the human can confirm filename==slug is a safe assumption for the ref path.
  (ledger-lint.ts `readLocalFolderSlugs` uses `fm.slug ?? basename(file, '.md')`; `readRefFolderSlugs` comment: 'reading the blob to confirm frontmatter slug: would cost an extra git show per file ... the duplicate set is keyed on the filename the transition wrote.' The ledger-lint.test.ts 'resolves the slug from frontmatter, not the filename' test only exercises the LOCAL path.)
- Coverage gap (not blocking, gate is green): the new CLI wiring `gc --ledger` (the flag parse, the JSON branch, and the process.exit(1) corrupt-ledger contract) has no test — gc.test.ts does not reference --ledger. The underlying `sweepLedgerDuplicates`/`formatLedgerSweep` are well-covered in ledger-lint.test.ts, and scan/status integration is covered, so the slice's acceptance criteria are met; only the thin CLI adapter + its exit code are unexercised. Consider a follow-up test asserting `gc --ledger` exits non-zero on a corrupt fixture.
  (grep of packages/agent-runner/test/gc.test.ts for 'ledger'/'--ledger'/'sweepLedger' returns nothing; the new behaviour lives in cli.ts.)

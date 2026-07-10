## Why

Two sibling observations (2026-06-20) surfaced the same underlying gap from two angles:

1. `release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries-2026-06-20` — `release-lock <item>` (and the reaper, and `gc --ledger`'s report) key off the CURRENT namespace mapping (`task:<slug>` → `task-<slug>`, `brief:<slug>` → `brief-<slug>`, `obs:<slug>` → `observation-<slug>`). Locks minted BEFORE the slice→task / spec→brief vocabulary cutover carry OLD entry names (`slice-<slug>`, `prd-<slug>`). There is no item-form that produces those entries anymore, so such locks are UN-NAMEABLE through `release-lock`. The only current recourse is raw `git push origin --delete refs/dorfl/lock/slice-<slug>` — exactly the manual git plumbing the protocol tells operators to avoid. Observed incident: orphaned `refs/dorfl/lock/slice-claim-cas-spinner` (held 2026-06-19 across the cutover), cleared by raw ref-delete 2026-06-20.
2. Sibling `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20` — same orphan, other angle: the reaper leaves certain terminal-orphan lock entries in place forever. A separate task is being minted for the reaper CONTRACT change (auto-reap behaviour); THIS task is the HUMAN escape hatch to name/release such an entry by hand. They compose.

The trust model is "a human clears an orphaned lock by NAMING it via release-lock; the tool never guesses liveness." A lock whose entry name is not derivable from any current item-form defeats that model. An escape hatch that lets the human assert liveness against a LITERAL entry name preserves the trust model — the human still asserts liveness, the tool just stops assuming the entry name is derivable from a current item-form.

The 2026-06-22 disposition on the source observation was promote-slice shipping (b) + (c) together, leaving migration (a) as a follow-up only if more pre-cutover orphans surface. That disposition was never actually shipped (confirmed: no `--entry` option exists on `release-lock` today, and `gc --ledger`'s report does not surface literal entry names in the release-lock verb suggestions). This task ships it.

## What to build

### (b) `release-lock --entry <literal>` escape hatch

- Extend the `release-lock` CLI to accept EITHER an item-form (existing behaviour: `task:<slug>` / `brief:<slug>` / `obs:<slug>` / bare-slug, resolved through the namespace mapping in `packages/dorfl/src/slug-namespace.ts` + `packages/dorfl/src/item-lock.ts`) OR `--entry <literal-entry-name>` which BYPASSES the namespace mapping entirely and targets `refs/dorfl/lock/<literal>` directly.
- Argument shape: `dorfl release-lock --entry slice-claim-cas-spinner` (no item positional required when `--entry` is given; error if BOTH an item positional AND `--entry` are provided, or if neither is).
- Deletion path: reuse the SAME leased-delete plumbing the item-form path uses (same lock-lease acquisition against the arbiter, same push, same absent-is-success no-op semantics, same exit codes and messages, same mirror handling). The only difference is the ref name is taken literally instead of derived. Do NOT invent a second delete path.
- Success/absent-on-origin message should print the LITERAL entry name (`refs/dorfl/lock/<literal>` is already absent on origin — "all locks released", recoverable) so operators can copy-paste it back into a `--entry` invocation.
- Validation: `<literal>` must be a plausible entry-name shape (non-empty, no slashes, no whitespace, matches the character class the minting side allows — probably `[A-Za-z0-9._-]+`). Reject anything that could escape the `refs/dorfl/lock/` namespace. Add a targeted unit test for the validator.

### (c) `gc --ledger` literal-entry reporting

- The reap output already shows literal entry names like `slice-claim-cas-spinner`. Extend `gc --ledger`'s REPORT (the non-reaping listing path) to ALSO surface the literal entry names it finds, alongside (not instead of) any item-form it can reverse-derive. Where an entry has no current-namespace item-form (pre-cutover `slice-`/`spec-` prefixes), print ONLY the literal name and hint at the `release-lock --entry <literal>` invocation.
- Where a literal name has no current item-form, include a one-line hint next to it, e.g. `  # no current item-form; clear with: dorfl release-lock --entry slice-claim-cas-spinner`.

### Docs / workaround note

- Add a short note (in the CLI help for `release-lock` AND in whichever operator-facing doc covers lock recovery — grep for existing release-lock docs) that: (i) `--entry` exists for locks whose entry name is not derivable from any current item-form (pre-vocabulary-cutover `slice-`/`spec-` prefixes, or any future rename), and (ii) until an eventual one-time migration lands, this is the supported way to clear such orphans — the raw `git push origin --delete refs/dorfl/lock/…` plumbing is no longer required.

### Out of scope (explicitly deferred)

- (a) The one-time MIGRATION renaming `refs/dorfl/lock/slice-<slug>` → `task-<slug>` and `prd-<slug>` → `brief-<slug>` on arbiter + mirrors. Leave as a follow-up observation/task only if MORE pre-cutover orphans actually surface after this ships. The escape hatch is sufficient for the small residual set.
- The reaper CONTRACT change (auto-reap of terminal-orphan lock entries). Being minted separately from the sibling observation `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`. This task is the HUMAN escape hatch; that task is the AUTOMATIC reap. They compose; do not merge them here.

## Refs

- `packages/dorfl/src/cli.ts` — `release-lock <item>` handler and the `gc --ledger --reap-stale-locks` block (extend both).
- `packages/dorfl/src/item-lock.ts` — `lockEntryFor` / `itemLockRef` (the item-form → entry derivation; the `--entry` path bypasses this).
- `packages/dorfl/src/slug-namespace.ts` — the post-cutover namespace resolver (unchanged; `--entry` sidesteps it).
- Sibling task: reaper terminal-orphan auto-reap (minted from `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`). Cross-reference from this task's PR.
- Source observations (both dated 2026-06-20): `release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries` and `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever`.

## Acceptance

- `dorfl release-lock --entry slice-claim-cas-spinner` deletes `refs/dorfl/lock/slice-claim-cas-spinner` via the same leased-delete path used by the item-form; absent-on-origin is a recoverable no-op with a message referencing the literal entry name.
- Providing BOTH an item positional AND `--entry`, or NEITHER, is a clear usage error (non-zero exit, actionable message).
- `--entry` argument is validated against a strict character class; a slash or whitespace in the literal is rejected before any git operation.
- `gc --ledger`'s report lists literal entry names; entries with no current item-form print a one-line hint suggesting the `release-lock --entry <literal>` invocation.
- Unit + integration tests cover: (i) `--entry` happy path deletes the literal ref; (ii) `--entry` absent-on-origin is a no-op success; (iii) invalid `--entry` value is rejected; (iv) mutual-exclusion with the item positional; (v) `gc --ledger` report surfaces literal names and the hint line for a `slice-`-prefixed fixture entry.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

> Build the task 'release-lock-entry-escape-hatch-and-literal-entry-reporting', described above.

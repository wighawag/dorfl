---
title: flag-cleanup-renames — return→requeue, drop --by, --ignore-not-ready only, advanced-tier help
slug: flag-cleanup-renames
prd: command-surface-phase-2
blockedBy: [registry-remote]
covers: [16, 17, 18, 19]
---

## What to build

The flag/name hygiene of ADR §7 (a pure CLI-surface cleanup):

- **`return` → `requeue`** — rename the verb that moves a resolved
  `needs-attention/` item back to `backlog/`. It names the defer-don't-finish
  action; its pair is `complete` (fixed it → finish) vs `requeue` (deferring → back
  to the queue). The underlying transition (the ledger write seam's
  return-to-backlog) is unchanged — only the verb name.
- **Remove `--by` ENTIRELY — flag AND the `(by ...)` commit-message suffix.** This
  is a deliberate behaviour change, not dead-code removal (so do it carefully).
  Today `--by` is LIVE: it feeds the claim COMMIT MESSAGE (`claim-cas.ts`:
  `claim: ${slug} (by ${by})`, `by` defaulting to git user.name/$USER), and
  `start.ts`'s `claimedByFromCommit` PARSES that `(by ...)` suffix back out (via
  `git log -1 --format=%s` + a `/\(by (.+)\)$/` regex) to report who holds an
  in-progress item. The DECISION (maintainer): the claimer does not belong in the
  commit-message header — git already records identity. So:
  1. Remove the `--by` option from `claim`/`start`/`work-on` + its
     `flags.by`→`performClaim/Start/WorkOn({by})` plumbing AND the `by`/`resolveBy`
     handling in `claim-cas.ts`.
  2. Drop the `(by <by>)` SUFFIX from the claim commit subject — the message
     becomes plain `claim: <slug>`.
  3. Re-point `claimedByFromCommit` to derive the claimer from the commit's GIT
     IDENTITY instead of parsing the (now-gone) subject suffix — e.g.
     `git log -1 --format=%an` (author name) on the claim commit, NOT `%s` + regex.
     It stays advisory (folder is the source of truth; this only enriches the
     refusal message), so a best-effort identity read is fine.
  Per ADR §7 this is exactly the intent: "the claimer already shows in the claim
  commit + git committer identity." Do NOT leave `claimedByFromCommit` parsing a
  suffix you removed (it would silently always return empty).
- **Readiness override = `--ignore-not-ready` ONLY** — drop the `--force` spelling
  on `claim`/`start`/`work-on` (it merely overrides a readiness warning).
  **`--force` is reserved for the genuinely destructive `gc --force`** — different
  danger levels must not share a flag name. `gc --force` (with `--yes`) is
  untouched.
- **Advanced/plumbing tier in help** — de-emphasise (without removing) the
  plumbing verbs+flags: `claim`, `prompt`, `verify`, `gc`, `remote rm`, and
  `--skip-verify`/`--type`/`--message`/`--copy`/`--print-dir`. Headline tier: `run`,
  `do`, `work-on`, `start`, `complete`, `scan`, `status`, `remote add`/`ls`/`find`.
  The repo uses **commander `^14`** and has NO existing help customization yet, so
  this is greenfield: use a commander-v14 affordance that fits (e.g.
  `command.helpGroup(...)` / `program.configureHelp(...)` / `addHelpText('after',
  ...)` listing the advanced tier under a heading). Keep it minimal — the goal is
  the headline set reads as the surface; do not hand-roll a help renderer.

Mostly CLI-surface changes — the one genuine behaviour change is `--by` (above):
the flag AND the `(by ...)` commit-subject suffix are removed, and
`claimedByFromCommit` is re-pointed to read the commit's git identity (`%an`)
instead of parsing the suffix. The claimer lives in git identity, not the message
header.

## Acceptance criteria

- [ ] `requeue <slug>` does what `return` did (return-to-backlog via the ledger
      seam); `return` is removed (or kept only as a hidden alias if trivial — prefer
      removal per the ADR's "rename").
- [ ] `--by` is removed (flag + plumbing + `claim-cas.ts` `by`/`resolveBy`); the
      claim commit subject is plain `claim: <slug>` (no `(by ...)` suffix); and
      `start.ts`'s `claimedByFromCommit` derives the claimer from the commit's git
      identity (`git log -1 --format=%an`), NOT from parsing the removed suffix.
      Tests: the claim subject has no `(by ...)`; `claimedByFromCommit` still
      reports a sensible claimer (from git identity) for the refusal message.
- [ ] The `--force` readiness-override spelling is removed from
      `claim`/`start`/`work-on`; `--ignore-not-ready` is the only override there.
      `gc --force` (with `--yes`) is unchanged and still works.
- [ ] Help de-emphasises the advanced/plumbing tier so the headline tier reads as
      the surface (verified by a snapshot/assertion of the help grouping).
- [ ] Tests: `requeue` behaves as `return` did; `--by` is gone; `--force` on
      claim/start/work-on is rejected/absent while `--ignore-not-ready` works;
      `gc --force --yes` still works; a help assertion for the tiering.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — both edit `cli.ts` heavily; serialise this cleanup AFTER the
  registry foundation lands to avoid a `cli.ts` merge conflict (per ADR §10 / the
  file-orthogonality rule). No logical dependency beyond that.

## Prompt

> Apply the flag/name hygiene of `docs/adr/command-surface-and-journeys.md` §7:
> rename `return` → `requeue`; remove the dead `--by` from claim/start/work-on; make
> the readiness override `--ignore-not-ready` ONLY (drop the `--force` SPELLING
> there — `--force` is reserved for the destructive `gc --force`); and de-emphasise
> the advanced/plumbing tier in help. Pure CLI-surface cleanup — no behaviour change
> beyond the renames/removals.
>
> FIRST run the drift check: confirm `cli.ts` still has the `return` verb, `--by` on
> claim/start/work-on, the `--force` readiness spelling (currently an alias of
> `--ignore-not-ready`), and `gc --force --yes`. Confirm `registry-remote` (in
> `done/`) has landed (you build on the same `cli.ts`). Route to needs-attention on
> a discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §7 (the exact deltas + the
> headline/advanced tiers + the "different danger levels must not share a flag"
> rationale + the `--by` rationale: claimer shows in the claim commit + git
> identity), `src/cli.ts` (the `return` command, the `--by`/`--force`/
> `--ignore-not-ready` options on claim/start/work-on, the `gc --force --yes`
> guard), `src/claim-cas.ts` (the claim commit message `claim: <slug> (by <by>)`
> that `--by` feeds), `src/start.ts` (`claimedByFromCommit` — it parses `(by ...)`
> back out; keep it consistent with whatever commit-message form you choose), and
> `src/ledger-write.ts` (`applyReturnToBacklogTransition` — unchanged; only the
> verb name changes).
>
> NOTE: `--by` is LIVE, not dead — it is in the claim commit subject + read back by
> `claimedByFromCommit`. The DECISION is to remove it ENTIRELY (the claimer belongs
> in git identity, not the message header): drop the flag, drop the `(by ...)`
> subject suffix (→ `claim: <slug>`), and re-point `claimedByFromCommit` to read
> `git log -1 --format=%an`. Do NOT leave it parsing a suffix you deleted.
>
> Implement: `return`→`requeue`; remove `--by` ENTIRELY (flag + plumbing +
> `claim-cas.ts` `by`/`resolveBy` + the `(by ...)` commit-subject suffix → plain
> `claim: <slug>`) and re-point `start.ts`'s `claimedByFromCommit` to read the
> commit git identity (`git log -1 --format=%an`) instead of parsing the gone
> suffix; remove the `--force` readiness spelling (keep `--ignore-not-ready`); keep
> `gc --force --yes`; help tiering. Use a commander help affordance for the tiering.
>
> TDD with vitest, house style: `requeue` == old `return`; `--by` gone; `--force` on
> claim/start/work-on absent while `--ignore-not-ready` works; `gc --force --yes`
> still works; a help-tiering assertion. "Done" = acceptance criteria met and gate
> green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim flag-cleanup-renames --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/flag-cleanup-renames <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/flag-cleanup-renames.md work/done/flag-cleanup-renames.md
```

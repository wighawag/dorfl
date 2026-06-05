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
- **Remove `--by`** from `claim`/`start`/`work-on`. NOTE — `--by` is NOT dead code:
  the `claimed_by` *frontmatter field* is gone (WORK-CONTRACT rule 6; git history is
  the ledger), but `--by` is still LIVE — it feeds the claim COMMIT MESSAGE
  (`claim-cas.ts`: `claim: ${slug} (by ${by})`, where `by` defaults to git
  user.name/$USER), and `start.ts`'s `claimedByFromCommit` PARSES that `(by ...)`
  back out to report who holds an in-progress item. So removing `--by` is a small
  behaviour change, not a no-op: the recorded claimer becomes the resolved git
  identity (no per-invocation override). Per ADR §7 that is the intent ("the claimer
  already shows in the claim commit + git committer identity"). DECIDE + keep
  consistent: either keep the commit message's `(by <resolved-git-identity>)`
  suffix (so `claimedByFromCommit` keeps working unchanged) or drop the suffix and
  have `claimedByFromCommit` fall back to the committer identity — do NOT leave
  `claimedByFromCommit` parsing a suffix you removed. Remove the `--by` OPTION +
  its `flags.by`→`performClaim/Start/WorkOn({by})` plumbing.
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

Mostly CLI-surface changes — the only non-cosmetic one is `--by` (above): the
claim commit's recorded claimer becomes the git identity rather than an overridable
flag; keep `claimedByFromCommit` consistent with the chosen commit-message form.

## Acceptance criteria

- [ ] `requeue <slug>` does what `return` did (return-to-backlog via the ledger
      seam); `return` is removed (or kept only as a hidden alias if trivial — prefer
      removal per the ADR's "rename").
- [ ] `--by` is removed from `claim`/`start`/`work-on` (option + plumbing gone); the
      claim commit records the resolved git identity as claimer, and
      `start.ts`'s `claimedByFromCommit` still resolves the claimer consistently
      with the chosen commit-message form (no parsing of a removed suffix).
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
> NOTE: `--by` is LIVE, not dead — it is in the claim commit message + read back by
> `claimedByFromCommit`. Removing it makes the recorded claimer the resolved git
> identity; keep the commit format and `claimedByFromCommit` consistent.
>
> Implement: `return`→`requeue`; remove `--by`; remove the `--force` readiness
> spelling (keep `--ignore-not-ready`); keep `gc --force --yes`; help tiering. Use a
> commander help affordance for the tiering.
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

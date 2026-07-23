---
title: 'flag-cleanup-renames — return→requeue, drop --by, --ignore-not-ready only, advanced-tier help'
slug: flag-cleanup-renames
spec: command-surface-phase-2
blockedBy: [registry-remote]
covers: [16, 17, 18, 19]
---

## What to build

The flag/name hygiene of ADR §7 (a pure CLI-surface cleanup):

> **FORWARD-POINTER (advance-loop) — do NOT rename `allowAgents` here.** The `advance-loop` SPEC (`work/spec/advance-loop.md`, User Story 36) OWNS the `allowAgents` → `autoBuild` rename and SEQUENCES IT LAST (its own isolated breaking-config migration after the advance family lands, so the gate family becomes symmetric `autoBuild`/`autoSlice`/`autoTriage`). This slice's renames (`return`→`requeue`, drop `--by`) must not pre-empt or collide with that — they are different flags, so there is no overlap; just leave `allowAgents` untouched so advance can be sliced WITHOUT changes to its SPEC.

- **`return` → `requeue`** — rename the verb that moves a resolved `needs-attention/` item back to `backlog/`. It names the defer-don't-finish action; its pair is `complete` (fixed it → finish) vs `requeue` (deferring → back to the queue). The underlying transition (the ledger write seam's return-to-backlog) is unchanged — only the verb name.
- **Remove `--by` AND the whole `claimedBy` CONCEPT — entirely.** This is a deliberate behaviour change, not dead-code removal (so do it carefully). Today `--by` is LIVE: it feeds the claim COMMIT MESSAGE (`claim-cas.ts`: `claim: ${slug} (by ${by})`, `by` defaulting to git user.name/$USER), and
  `start.ts`'s `claimedByFromCommit` parses that `(by ...)` suffix back out (via
  `git log -1 --format=%s` + a `/\(by (.+)\)$/`regex) purely to enrich ONE refusal message. The DECISION (maintainer): the claimer does not belong in the commit-message header AND we are dropping the`claimedBy` concept altogether (git history is the ledger; if a richer "who holds it" readback is ever wanted, that is a separate future pass). So:
  1. Remove the `--by` option from `claim`/`start`/`work-on` + its `flags.by`→`performClaim/Start/WorkOn({by})` plumbing AND the `by`/`resolveBy` handling in `claim-cas.ts`.
  2. Drop the `(by <by>)` SUFFIX from the claim commit subject — the message becomes plain `claim: <slug>`.
  3. **DELETE `claimedByFromCommit` entirely** (the function, the `const claimedBy` variable, and the `claimedBy`-framing comments in `start.ts`). Do NOT rename it or re-point it to `%an` — the concept goes away. The in-progress refusal message simply points at git: e.g. _"'<slug>' is already in-progress; see `git    log` for who claimed it; if it is your own work, re-run with --resume."_ (The folder is already the source of truth for the decision; the message never needed to name the claimer.) Per ADR §7 this is the intent: "the claimer already shows in the claim commit + git committer identity" — so the human reads it with git, and the codebase keeps no `claimedBy` abstraction. Leave NO `claimedBy`/`claimed_by` concept in the touched code (incidental phrasing like "the claimed item" is fine; a `claimedBy` helper/var/named-concept is not).
- **Readiness override = `--ignore-not-ready` ONLY** — drop the `--force` spelling on `claim`/`start`/`work-on` (it merely overrides a readiness warning). **`--force` is reserved for the genuinely destructive `gc --force`** — different danger levels must not share a flag name. `gc --force` (with `--yes`) is untouched.
- **Advanced/plumbing tier in help** — de-emphasise (without removing) the plumbing verbs+flags: `claim`, `prompt`, `verify`, `gc`, `remote rm`, and `--skip-verify`/`--type`/`--message`/`--copy`/`--print-dir`. Headline tier: `run`, `do`, `work-on`, `start`, `complete`, `scan`, `status`, `remote add`/`ls`/`find`. The repo uses **commander `^14`** and has NO existing help customization yet, so this is greenfield: use a commander-v14 affordance that fits (e.g. `command.helpGroup(...)` / `program.configureHelp(...)` / `addHelpText('after', ...)` listing the advanced tier under a heading). Keep it minimal — the goal is the headline set reads as the surface; do not hand-roll a help renderer.

Mostly CLI-surface changes — the one genuine behaviour change is `--by` (above): the flag, the `(by ...)` commit-subject suffix, AND the `claimedBy` concept (`claimedByFromCommit` + its var/comments) are all removed. The refusal message points at `git log`; the claimer lives in git history, with no `claimedBy` abstraction in our code.

## Acceptance criteria

- [ ] `requeue <slug>` does what `return` did (return-to-backlog via the ledger seam); `return` is removed (or kept only as a hidden alias if trivial — prefer removal per the ADR's "rename").
- [ ] `--by` is removed (flag + plumbing + `claim-cas.ts` `by`/`resolveBy`); the claim commit subject is plain `claim: <slug>` (no `(by ...)` suffix); `claimedByFromCommit` and the `claimedBy` var/concept are DELETED from `start.ts` (not renamed/re-pointed); the in-progress refusal message points at `git log` instead of naming the claimer. Tests: the claim subject has no `(by ...)`; the in-progress refusal still fires (with the git-log pointer); no `claimedBy` symbol remains in the touched code.
- [ ] The `--force` readiness-override spelling is removed from `claim`/`start`/`work-on`; `--ignore-not-ready` is the only override there. `gc --force` (with `--yes`) is unchanged and still works.
- [ ] Help de-emphasises the advanced/plumbing tier so the headline tier reads as the surface (verified by a snapshot/assertion of the help grouping).
- [ ] Tests: `requeue` behaves as `return` did; `--by` is gone; `--force` on claim/start/work-on is rejected/absent while `--ignore-not-ready` works; `gc --force --yes` still works; a help assertion for the tiering.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — both edit `cli.ts` heavily; serialise this cleanup AFTER the registry foundation lands to avoid a `cli.ts` merge conflict (per ADR §10 / the file-orthogonality rule). No logical dependency beyond that.

## Prompt

> Apply the flag/name hygiene of `docs/adr/command-surface-and-journeys.md` §7: rename `return` → `requeue`; remove the dead `--by` from claim/start/work-on; make the readiness override `--ignore-not-ready` ONLY (drop the `--force` SPELLING there — `--force` is reserved for the destructive `gc --force`); and de-emphasise the advanced/plumbing tier in help. Pure CLI-surface cleanup — no behaviour change beyond the renames/removals.
>
> FIRST run the drift check: confirm `cli.ts` still has the `return` verb, `--by` on claim/start/work-on, the `--force` readiness spelling (currently an alias of `--ignore-not-ready`), and `gc --force --yes`. Confirm `registry-remote` (in `done/`) has landed (you build on the same `cli.ts`). Route to needs-attention on a discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §7 (the exact deltas + the headline/advanced tiers + the "different danger levels must not share a flag" rationale + the `--by` rationale: claimer shows in the claim commit + git identity), `src/cli.ts` (the `return` command, the `--by`/`--force`/ `--ignore-not-ready` options on claim/start/work-on, the `gc --force --yes` guard), `src/claim-cas.ts` (the claim commit message `claim: <slug> (by <by>)` that `--by` feeds), `src/start.ts` (`claimedByFromCommit` — it parses `(by ...)` back out; keep it consistent with whatever commit-message form you choose), and `src/ledger-write.ts` (`applyReturnToBacklogTransition` — unchanged; only the verb name changes).
>
> NOTE: `--by` is LIVE, not dead — it is in the claim commit subject + read back by `claimedByFromCommit`. The DECISION is to remove it AND the `claimedBy` concept ENTIRELY (git history is the ledger): drop the flag, drop the `(by ...)` subject suffix (→ `claim: <slug>`), and DELETE `claimedByFromCommit` + its var/comments — do NOT rename or re-point it. The in-progress refusal message points at `git log`. A richer "who holds it" readback, if ever wanted, is a separate future pass.
>
> Implement: `return`→`requeue`; remove `--by` AND the `claimedBy` CONCEPT ENTIRELY (flag + plumbing + `claim-cas.ts` `by`/`resolveBy` + the `(by ...)` commit-subject suffix → plain `claim: <slug>`, AND DELETE `start.ts`'s `claimedByFromCommit` + its `claimedBy` var/comments — do NOT rename or re-point it; the in-progress refusal message just points at `git log`); remove the `--force` readiness spelling (keep `--ignore-not-ready`); keep `gc --force --yes`; help tiering. Use a commander help affordance for the tiering.
>
> TDD with vitest, house style: `requeue` == old `return`; `--by` gone; `--force` on claim/start/work-on absent while `--ignore-not-ready` works; `gc --force --yes` still works; a help-tiering assertion. "Done" = acceptance criteria met and gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim flag-cleanup-renames --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/flag-cleanup-renames <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/flag-cleanup-renames.md work/done/flag-cleanup-renames.md
```

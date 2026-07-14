---
title: Make isolated the DEFAULT build mode for `do` (build in a job worktree off the arbiter; add an explicit `--in-place` opt-out)
slug: make-isolated-default-build-mode
blockedBy: []
covers: []
---

## Decisions (the four open questions, RESOLVED 2026-07-12)

D1 — **Per-repo config for isolated-off-own-arbiter is ALREADY honoured (not a blocker).** Verified in code: `--isolated` and `--remote` share `resolveRemoteRepoConfig` in `packages/dorfl/src/cli.ts`, which reads the committed `dorfl.json` from `<arbiter>/main` and layers the whitelisted keys (`harness`/`verify`/`provider`/`model`), restoring `flag > env > per-repo > global > default`. Three landed tasks establish this: `do-isolated-in-place` (added `--isolated` off THIS repo's arbiter), `remote-do-reads-per-repo-config-from-arbiter-main` (both flags read per-repo config from arbiter main; its scope note explicitly says `--isolated` inherits the fix through the shared path), and `isolated-config-read-main-only-fetch-and-reap-on-failure` (hardened that read to main-only/no-prune so a stale worktree cannot poison it). So there is NO per-repo-config prerequisite and NO `blockedBy`.

D2 — **No-arbiter / offline: ERROR, do NOT silently degrade to in-place.** A repo with no configured arbiter cannot isolate; the flip must fail loudly with guidance ("no arbiter configured — run `dorfl remote add …` or pass `--in-place`"), NOT quietly fall back to the unsafe in-place mode. The whole point of the flip is to make in-place the DELIBERATE choice; a silent degrade would reintroduce the entanglement risk invisibly, exactly when the user cannot tell.

D3 — **Opt-out flag is `--in-place`.** It names the intent and matches the vocabulary the ADR §3 table + `skills/drive-tasks/SKILL.md` already use, so no new term is introduced. Keep `--isolated` as a redundant explicit opt-IN alias (harmless once it is the default; some scripts/skills pin it). Rejected: `--no-isolated` (negative flag reads awkwardly and would sit beside a now-redundant `--isolated`), `--here` (vaguer).

D4 — **Accept "the task must be on the arbiter" as the new default.** Isolated builds off `<arbiter>/main`, so a local-only / un-pushed task (or dep) is invisible to the default build — consistent with the tool's direction (arbiter = source of truth) and with `drive-tasks`, which already lives with this (push-first, never fall back to in-place). The `--in-place` opt-out covers the edit-locally-then-build loop. Document this in the ADR amendment.

## What to build

Flip the default build mode for `do <slug>` in a checkout from **in-place** to **isolated**: build in a job worktree off the current repo's arbiter (the same isolation `--isolated` / `--remote` / `run` already use), treating the cwd checkout as an **origin SOURCE only** (resolve the arbiter remote from it, never write/commit in the working tree). Add an explicit opt-OUT flag for the rare true-in-place case. `--remote <r>` is unchanged (foreign repo, isolation already implied).

The default flips like this:

- `do <slug>` → isolated worktree off the arbiter (NEW default).
- `do --in-place <slug>` → today's in-checkout behaviour (the current default, now opt-in; keep `--isolated` as a redundant explicit opt-in alias — D3).
- `do --remote <r> <slug>` → unchanged.

A repo with NO configured arbiter ERRORS with guidance rather than silently degrading to in-place (D2).

Motivation (the concrete why): it eliminates the cwd-entanglement class of bug ENTIRELY — a concurrent autonomous `do` job can no longer sweep a human's / assistant's uncommitted `work/` files into its own chore commit, because the build never writes the cwd tree. It also converges conductor + daemon + human-worker onto ONE isolation substrate (`run` and `do --remote` already isolate). The value is squarely for the **bare `do` / human path**: it is that path that still defaults to in-place today.

**NOTE on `drive-tasks` (corrected 2026-07-12 during review — the originating idea's premise here is now STALE).** The idea claimed this flip would "collapse much of the `drive-tasks` in-place-vs-remote special-casing." That is NO LONGER TRUE: `skills/drive-tasks/SKILL.md` already mandates `--isolated` ALWAYS and explicitly states "There is no in-place mode in this skill" — it already assumes isolation, handles the un-pushed-task consequence (push-first, never fall back to in-place), reads per-repo config from arbiter `main`, and is checkout-agnostic. So there is no in-place special-casing left in `drive-tasks` to remove. Do NOT scope a `drive-tasks` simplification into this task. The only `drive-tasks` touch worth considering is a WORDING refresh: once isolated is the default, the skill's "`--isolated` is the one flag this skill pins" line becomes slightly redundant (isolated would be the default, though pinning it explicitly is still harmless and arguably clearer). That is a cosmetic follow-up, not part of this task's behavioural change.

Because this flips a deliberately-decided default, it is an **ADR amendment**, not a silent change: amend `docs/adr/command-surface-and-journeys.md` §3 (the three-form table + the in-place-default decision) with the new default and the recorded why (cwd-entanglement elimination + substrate convergence).

## Acceptance criteria

- [ ] `do <slug>` in a checkout with a configured arbiter builds in an isolated job worktree off the arbiter; the cwd working tree is UNTOUCHED after the run (no claim-revert / done-move / dist rebuild lands in it).
- [ ] The isolated default reads per-repo `dorfl.json` (`harness` / `verify` / `provider`) from the arbiter's `main`, so a repo declaring e.g. `harness: pi` gets that harness (never the null adapter). (Already wired via `resolveRemoteRepoConfig` — D1; add a test asserting it holds for the DEFAULT `do <slug>` path, not only `--isolated`/`--remote`.)
- [ ] `--in-place <slug>` restores today's exact in-place behaviour (dirty-tree refusal included); `--isolated <slug>` remains accepted as an explicit opt-in alias of the new default (D3).
- [ ] A repo with NO configured arbiter ERRORS with clear guidance (configure an arbiter or pass `--in-place`) — it does NOT silently build in-place (D2) — deterministically, with a test.
- [ ] `docs/adr/command-surface-and-journeys.md` §3 is amended: the new default, the `--in-place` opt-out, the no-arbiter error behaviour, and the "task must be on the arbiter" consequence (D4), with the recorded why (cwd-entanglement elimination + substrate convergence).
- [ ] Tests cover the new default, the opt-out, and the no-arbiter fallback, mirroring the repo's existing `do` / isolation test style.
- [ ] `skills/drive-tasks/SKILL.md` still reads correctly after the flip (it already mandates `--isolated`; confirm no wording now contradicts "isolated is the default"). Any change here is a cosmetic wording refresh ONLY — do NOT introduce behavioural change to the skill.
- [ ] This task makes `do` build in a worktree off the arbiter (an isolated location by construction); tests must isolate any arbiter/worktree scratch (temp dirs) and assert the invoking checkout's working tree is UNCHANGED after the run.

## Blocked by

- None. The per-repo-config prerequisite is already met (D1); this task is startable.

## Prompt

> Build the task 'make-isolated-default-build-mode', described above.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): re-read `docs/adr/command-surface-and-journeys.md` §3 (the three-form model + the current in-place-default decision this amends) and the isolation seam (worktree/fresh-checkout, per the execution-substrate ADR). The four design questions are already RESOLVED in the `## Decisions` block above (D1–D4) — build to those; if the code contradicts D1 (per-repo config NOT honoured on the shared isolated path), STOP and route to needs-attention rather than shipping a default that drops the repo's declared `harness`/`verify`/`provider`.
>
> Domain vocabulary: `do` builds a ready task; the three forms are in-place (CURRENT default, refuses a dirty tree — becomes the `--in-place` opt-out), `--isolated` (job worktree off THIS repo's arbiter — added as a purely-additive opt-in in the `do-isolated-in-place` slice, BECOMES the default), and `--remote` (foreign repo, isolation implied, unchanged). The isolation mechanism + the per-repo-config-from-arbiter read already exist (`resolveRemoteRepoConfig`, `do-isolated-in-place`, `remote-do-reads-per-repo-config-from-arbiter-main`); this task changes the DEFAULT, adds the `--in-place` opt-out (keeping `--isolated` as an alias), makes the no-arbiter case ERROR, and amends the ADR.
>
> RECORD non-obvious in-scope decisions durably (they meet the ADR gate, so they belong in the §3 amendment) — the four load-bearing ones are already decided in `## Decisions` (D1–D4); surface any NEW choice the build forces. This task was promoted from the idea `make-isolated-the-default-build-mode` (now deleted; its full case-for/against and 5-step sequencing were folded into this file). For the anti-entanglement rationale (cwd = origin source only; the build must never write the human's working tree), see `skills/drive-tasks/SKILL.md` ("Selection + isolation" + golden rules 5 and 7) — the conductor skill already encodes this reasoning and is the surviving durable home for it (the original `drive-backlog-skill-assumes-in-place` observation was discharged when that skill was renamed drive-backlog → drive-tasks and made isolated-only).

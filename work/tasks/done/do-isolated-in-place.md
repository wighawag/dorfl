---
title: do-isolated-in-place — add `do --isolated <slug>`: build the slice in an ISOLATED job worktree off THIS repo's arbiter (a boolean flag, orthogonal to `--remote <url>`), so a conductor/sub-agent can isolate a build from a dirty/in-use checkout without targeting a foreign repo
slug: do-isolated-in-place
covers: []
---

> Self-contained feature slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal: `work/observations/do-remote-no-arg-and-remote-autopick-for-isolated-conductor.md` part **(a)** (the "isolate-in-place" affordance). This slice REPLACES the earlier `do-remote-no-arg-isolate-in-place.md` framing (which spelled (a) as a no-value `--remote`); the maintainer chose a clearer model (2026-06-08): two ORTHOGONAL flags rather than overloading `--remote`. **DO NOT build part (b)** (remote/ mirror-side auto-pick) — it is folded into the `advance-loop` PRD's slicing so the mirror-side pool scan is designed once. This slice is ONLY (a), under `--isolated`.

## What to build

Add a NEW boolean flag **`do --isolated <slug>`**: build the slice in an ISOLATED **job worktree** off **THIS repo's** arbiter (inferred from cwd — `origin`/per-repo `defaultArbiter`), instead of in the current checkout — then integrate and reap per ADR §4. It is the "give me an isolated worktree even though I'm already inside the repo" affordance.

This is ORTHOGONAL to the existing `do --remote <url> <slug>` (target a FOREIGN repo with no checkout). The two flags name two different things and `--remote` is left byte-unchanged:

| command | meaning | arbiter source | worktree? |
| --- | --- | --- | --- |
| `do <slug>` | in-place (current checkout; refuses on a dirty tree) | cwd's arbiter | no |
| `do --isolated <slug>` (NEW) | isolate off MY arbiter | cwd's arbiter | yes |
| `do --remote <url> <slug>` (UNCHANGED) | target a FOREIGN repo (no checkout) | the url/registered spec | yes (implied) |

### Why this model (the maintainer's decision)

`--remote` names the TRANSPORT/targeting axis (a foreign repo); isolation there is INCIDENTAL (no checkout exists, so a worktree is mandatory). The my-repo-in-a-worktree case is a DIFFERENT intent — opting INTO isolation off my own arbiter — and deserves its own intent-named flag. Keeping them orthogonal means `--remote` stays honest ("elsewhere") and `--isolated` reads as exactly what it does ("in a worktree"). It is also purely ADDITIVE: no rename, no deprecation, `--remote <url>` and in-place `do` are untouched.

### Why it matters / where it connects

- It is the missing primitive behind a safely-ISOLATED autonomous `drive-backlog` (sub-agent) posture: such an agent shares the human's cwd, so in-place `do` fights the human's checkout (and refuses on a dirty tree), while `do --remote <url> <slug>` forces a foreign URL. `--isolated` closes that gap with no foreign URL.
- It is the isolated, supervised-conductor counterpart to a single `run` tick (run = isolated + parallel + unattended; this = isolated + a chosen single slice).

### The change (precise)

Today (`src/cli.ts`, the `do` action body ~L1224): only two shapes exist — in-place (no `--remote`) and `--remote <r>` (a `<value>` option resolving a foreign url/spec via `performDoRemote`).

- Add a boolean `--isolated` option to `do`. When present (and `--remote` is NOT), resolve the arbiter from the CURRENT repo (the SAME resolution in-place `do` / `work-on` bare-form already use to find `origin`/`defaultArbiter`) and drive the job-worktree pipeline off THAT arbiter.
- REUSE `performDoRemote`'s job-worktree pipeline (mirror/worktree in the agents' `workspacesDir` area → build → integrate → reap) — do NOT fork a new path. The only new logic is resolving the arbiter-from-cwd when `--isolated` is given and threading it in as the arbiter `performDoRemote` already consumes. (Post-`do-run-share- isolation-seam`, the isolation + integrate-path are shared; `performDoRemote` already `ensureMirror`s/auto-registers.)
- **No resolvable arbiter → CLEAR error.** If cwd is not a participating repo / has no configured arbiter, `--isolated` errors with a message that names the alternative, e.g.: `--isolated builds in a worktree off this repo's arbiter, but no arbiter is configured/found here; run inside a participating repo, or use --remote <url> to target another repo.` (This is the "isolated against what?" case the maintainer called out.)
- **`--isolated` + `--remote <url>` together → ACCEPT as redundant (remote wins).** A foreign `--remote` is ALREADY isolated, so `--isolated` adds nothing; accept the combination as a no-op (do not error) — remote targeting wins, isolation is implied. (Record this in a `## Decisions` block; if the maintainer would rather it ERROR to keep the flags strictly exclusive, that is the one open micro-choice — surface it.)
- The human area is NEVER touched (worktree + mirror live in `workspacesDir`), exactly as `do --remote <url>` guarantees today.

## Scope

- IN: the new boolean `do --isolated` → infer-arbiter-from-cwd → job-worktree build reusing `performDoRemote`'s pipeline; the clear no-arbiter error; the redundant `--isolated`+`--remote` handling (accept, remote wins); tests for the isolate path, the no-arbiter error, and that `--remote <url>` + in-place `do` are unaffected.
- OUT: **part (b)** — remote/mirror-side AUTO-PICK / `-n` over a hub-mirror pool (folded into `advance-loop`'s slicing); RENAMING `--remote` (this is additive — `--remote` stays); any `work-on` change (a sibling `work-on --isolated` is a possible later follow-up, NOT this slice); the ADR update (additive doc note captured separately — see Follow-up); any human-area write; any change to in-place `do`.

## Acceptance criteria

- [ ] From inside a participating repo, `do --isolated <slug>` builds the slice in an ISOLATED job worktree in `workspacesDir` off the CURRENT repo's arbiter, then integrates + reaps per §4 — never touching the current checkout or the human area.
- [ ] It reuses `performDoRemote`'s job-worktree pipeline (no forked isolation/integrate path); the only new logic is resolving the arbiter-from-cwd and threading it in.
- [ ] `--isolated` with NO resolvable arbiter (not a participating repo / no configured arbiter) errors CLEARLY, naming `--remote <url>` as the foreign-repo alternative — NOT a confusing URL-parse failure.
- [ ] `--isolated` + `--remote <url>` together is accepted (remote wins, isolation implied), not an error — UNLESS the maintainer chose strict-exclusive (recorded in a `## Decisions` block either way).
- [ ] `do --remote <url> <slug>` is byte-UNCHANGED (its tests pass); in-place `do <slug>` is byte-UNCHANGED.
- [ ] `-n`/auto-pick is still REFUSED with `--isolated` (part (b) is out of scope); `do --isolated <slug>` remains single-named-item.
- [ ] Tests: the isolate build runs end-to-end off the cwd arbiter in a job worktree (house pattern: throwaway repo + local `--bare` arbiter, stubbed harness, temp `workspacesDir`, `isolatePiAgentDir`); the current checkout + human area are untouched; the no-arbiter error fires; the existing `--remote <url>` + in-place paths are unaffected.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Follow-up (capture, do not build here)

- The ADR `docs/adr/command-surface-and-journeys.md` (§3, the "Isolation strategy by form" bullet) ALREADY records the three-point axis including `--isolated`, marked **"pending build (slice `do-isolated-in-place`)"**. When THIS slice lands, flip that marker to present tense — drop the "pending build" caveat so the bullet reads `--isolated` as a shipped form alongside in-place / `--remote`. (One small edit; the table itself is already correct.)
- A sibling `work-on --isolated` (the human counterpart) is a plausible later slice — not in scope here.

## Prompt

> Add a NEW boolean flag `do --isolated <slug>`: build the slice in an ISOLATED job worktree off THIS repo's arbiter (inferred from cwd — `origin`/per-repo `defaultArbiter`), instead of the current checkout, then integrate + reap per ADR §4. It is ORTHOGONAL to the existing `do --remote <url> <slug>` (foreign repo) and purely ADDITIVE — `--remote` and in-place `do` stay byte-unchanged. Source: `work/observations/do-remote-no-arg-and-remote-autopick-for-isolated-conductor.md` part (a) (READ IT FIRST — build ONLY (a); part (b), remote auto-pick, is OUT OF SCOPE, folded into the advance-loop PRD).
>
> THE MODEL (maintainer's decision): `do <slug>` = in-place (cwd, refuses on a dirty tree); `do --isolated <slug>` = worktree off MY arbiter; `do --remote <url> <slug>` = foreign repo (unchanged). `--remote` names the targeting axis (elsewhere); `--isolated` names the isolation intent (a worktree off my own arbiter). If cwd has NO resolvable arbiter, `--isolated` ERRORS clearly ("isolated against what?"), naming `--remote <url>` as the foreign alternative. `--isolated` + `--remote <url>` together is REDUNDANT (remote already implies isolation) → accept as a no-op (remote wins); record that in a `## Decisions` block (if the maintainer would prefer it ERROR to keep them strictly exclusive, surface that as the one open micro-choice).
>
> READ FIRST: `src/cli.ts` the `do` action body (~L1224 — the `flags.remote !== undefined` branch + the in-place vs `--remote` split; add the boolean `--isolated` option and route it to infer-from-cwd) + how in-place `do` / `work-on` bare-form resolve the arbiter from the current repo (reuse that resolution); `src/do.ts` `performDoRemote` (the job-worktree pipeline to reuse — it already `ensureMirror`s/auto-registers and shares the isolation + integrate-path post-`do-run-share-isolation-seam`); `src/repo-mirror.ts`. Do NOT fork a new isolation/integrate path; the only new logic is resolving the arbiter-from-cwd and threading it in.
>
> Keep `do --remote <url> <slug>` and in-place `do <slug>` byte-unchanged. Refuse `-n`/auto-pick with `--isolated` (part (b)). Do NOT edit the ADR (leave the additive doc note as a follow-up observation if not already captured).
>
> TDD with vitest, house style (throwaway repo + local `--bare` arbiter, stubbed harness, temp `workspacesDir`, `isolatePiAgentDir`): `do --isolated <slug>` builds in a job worktree off the cwd arbiter without touching the checkout/human area; the no-arbiter error fires; `--isolated`+`--remote` is accepted (remote wins); `do --remote <url>` + in-place `do` are unaffected; real shared dirs untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim do-isolated-in-place --arbiter origin
git fetch origin && git switch -c work/do-isolated-in-place origin/main
git mv work/in-progress/do-isolated-in-place.md work/done/do-isolated-in-place.md
```

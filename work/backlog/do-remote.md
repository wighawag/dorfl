---
title: do-remote — `do --remote <r>` worker against a registered repo (materialise a job worktree, harden start/complete to run against it)
slug: do-remote
prd: command-surface-phase-2
blockedBy: [registry-remote, do-in-place]
covers: [9]
---

## What to build

`do --remote <r> <arg>`: the per-repo `do` worker run against a REGISTERED repo
with NO checkout (ADR `command-surface-and-journeys` §3). It materialises a **hub
mirror + job worktree in the agents' area** (`workspacesDir`) — the SAME isolation
`run` uses — never the human area — then runs the existing `do` pipeline against
that worktree, and tears it down per the §4 deletion predicate.

### The real shape (drift correction — the original slice's premise was stale)

The original `do-remote` slice assumed `do` already routed through the
`IsolatedTree` seam, so `--remote` would be "just select the job-worktree
strategy." **That is NOT how `do-in-place` was built.** `performDo` (`src/do.ts`)
composes the human verbs DIRECTLY against a literal `cwd`: `performStart({slug,
cwd})` → agent → `performComplete({slug, cwd})`. It does NOT use
`selectIsolationStrategy`/`IsolatedTree` at all (confirm in `src/do.ts` +
`src/isolation.ts`'s doc, which says the in-place strategy "is unwired").

So this slice is **Option A — materialise-then-reuse** (the smaller, lower-risk
shape; the full seam-unification is the separate `do-run-share-isolation-seam`
slice, blocked on this one):

- **Materialise the job worktree** for `<r>` using the EXISTING job-worktree
  machinery: resolve/auto-create the hub mirror (`ensureMirror` — the same
  on-the-fly mirroring `work-on`'s remote form already does, now also the
  `registry-remote` `remote add` path), then `createJob`/`jobWorktreeStrategy` to
  cut a worktree in `workspacesDir` on `work/<slug>` off the freshly-fetched
  `<hub>/main`.
- **Run the existing `do` pipeline against the worktree dir as `cwd`.** This is the
  load-bearing work: `performStart`/`performComplete` must operate correctly when
  `cwd` is a JOB WORKTREE (a mirror clone) rather than a human checkout — see the
  claim/branch-ordering note below. Reuse, do NOT reimplement, the pipeline.
- **Teardown** re-applies the §4 provably-safe deletion predicate (`reapJob`):
  reap the worktree iff clean AND on the arbiter; retain otherwise (the
  never-lose-work signal). NEVER `--force`.
- **`--propose`/`--merge` and slug resolution** behave identically to `do-in-place`.

### The claim ↔ worktree ↔ start composition (resolve this explicitly)

`createJob` already cuts the `work/<slug>` branch off the mirror's fresh main, and
`performStart` ALSO claims + switches to `work/<slug>`. These overlap and can
conflict. The slice must define the order so they compose without double-claiming
or fighting over the branch. Likely shape: **claim first (the CAS push to the
arbiter), then materialise the worktree on the freshly-fetched main (which now
includes the claim move), then run the agent + `complete` against it** — i.e.
`do --remote` claims around worktree creation, and `performStart`'s branch-switch
must tolerate the branch `createJob` already created (a plain switch, not a
re-create). Verify `performStart`/`switchToWorkBranch` already plain-switch to an
existing local branch (`src/start.ts` `switchToWorkBranch` uses `switch -c` then
falls back to plain `switch` — so an existing branch is tolerated; CONFIRM this in
the drift check and wire the ordering accordingly).

### Recovery contract (state it; do not build salvage)

`do --remote`'s worktree is in the AGENTS' area and is disposable. The durable
artifact is the **`work/<slug>` branch**, not the worktree. On a stuck/failed run
the item is routed to `needs-attention` and its branch is PUSHED (the existing
`routeToNeedsAttention(arbiter)` path — `src/needs-attention.ts`). A human recovers
NOT by editing the agents'-area worktree but via the human face: `requeue <slug>`
(→ backlog, branch kept) and a re-claim, or `work-on <slug>` in the human area.
(NOTE: whether the re-claim CONTINUES from the kept branch or retries fresh depends
on the SEPARATE `requeue-continue-and-reset` slice — which is NOT a dependency of
this one. Until it lands, a re-claim retries from a fresh main; the branch is still
preserved on the arbiter for manual recovery either way. Do NOT assume continue-mode
exists when building this slice.) The agents'-area worktree is never the human's
edit surface (hand-fixing there works as a last resort but is undocumented-by-design
— no secrets belong in it).

## Acceptance criteria

- [ ] `do --remote <r> <arg>` materialises a hub mirror + job worktree in the
      agents' area (`workspacesDir`) and runs the same `do` pipeline
      (claim/build/gate/integrate/exit) as the in-place form, against the worktree.
- [ ] An unregistered `--remote` is auto-mirrored (`ensureMirror`) before use.
- [ ] Claim ↔ worktree-create ↔ start compose with NO double-claim and NO branch
      conflict (claim, then worktree off the post-claim main, then start
      plain-switches the existing branch). `start`/`complete` are proven to work
      against a job-worktree `cwd` (a test exercises the full pipeline there).
- [ ] Teardown re-applies the §4 predicate (`reapJob`): reaps iff clean AND on the
      arbiter, retains otherwise. The human area (`humanWorktreesDir`) is NEVER
      written.
- [ ] `--propose`/`--merge` and slug resolution behave identically to `do-in-place`.
- [ ] **Test isolation (shared-write-location rule, WORK-CONTRACT):** tests point
      `workspacesDir` at a temp dir AND `PI_CODING_AGENT_DIR` at a scratch dir, and
      assert the real `~/.agent-runner/` AND `~/.pi/agent/sessions/` are UNTOUCHED
      after the run. (Use the `isolatePiAgentDir` helper.)
- [ ] Tests (local `--bare` arbiter as the registered remote, temp agents' area,
      stubbed harness): `do --remote` runs end-to-end in a job worktree; an
      unregistered remote is auto-registered; teardown reaps a clean+pushed job and
      retains a dirty one.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — mirror resolution + auto-add (`ensureMirror`).
- `do-in-place` — the `do` pipeline to reuse (composed of `start`/agent/`complete`).

## Prompt

> Build `do --remote <r>` per `docs/adr/command-surface-and-journeys.md` §3: the
> `do` worker against a REGISTERED repo with no checkout — materialise a hub mirror
> + job worktree in the AGENTS' area, then run the EXISTING `do` pipeline against
> that worktree, then reap per §4. This is **Option A (materialise-then-reuse)**:
> do NOT route `do` through the `IsolatedTree` seam here (that is the separate
> `do-run-share-isolation-seam` slice) — instead create the worktree and run the
> existing `performStart`/agent/`performComplete` against the worktree dir as `cwd`.
>
> FIRST run the drift check (the original slice's premise was STALE): confirm
> `src/do.ts` composes `performStart`/`performComplete` against a literal `cwd` (NOT
> the isolation seam); confirm `src/isolation.ts` `jobWorktreeStrategy`/`createJob`
> is the worktree machinery to reuse; confirm `src/start.ts` `switchToWorkBranch`
> tolerates an already-existing `work/<slug>` branch (plain-switch fallback);
> confirm `registry-remote`/`work-on`'s `ensureMirror` auto-add. Route to
> needs-attention on any real discrepancy.
>
> READ FIRST: ADR §2 (storage areas → doer axis: agent execution → agents' area,
> never human area) + §3; `src/isolation.ts` (`jobWorktreeStrategy`, `createJob`,
> `jobWorktreeHandle`, `reapJob` teardown); `src/do.ts` (`performDo` — the pipeline
> to reuse); `src/start.ts` + `src/complete.ts` (must work against a job-worktree
> cwd); `src/workspace.ts` (`createJob`, `encodeWorkId`, `jobWorktreePath`);
> `src/gc.ts` (`reapJob`); `src/work-on.ts` (the `--remote` auto-`ensureMirror`
> precedent); `src/needs-attention.ts` (the branch-push on stuck — the recovery
> surface).
>
> Implement `--remote` selection + auto-mirror; CLAIM first, then materialise the
> worktree off the post-claim fresh main, then run start/agent/complete against the
> worktree dir; teardown via `reapJob`. Use `workspacesDir`, never
> `humanWorktreesDir`.
>
> TDD with vitest, house style (local `--bare` arbiter, temp `workspacesDir`,
> `isolatePiAgentDir` to scratch, stubbed harness): end-to-end in a job worktree;
> auto-register an unknown remote; reap-clean / retain-dirty; assert the human area
> AND the real `~/.agent-runner/` + `~/.pi/agent/sessions/` are never touched.
> "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim do-remote --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/do-remote <remote>/main
git mv work/in-progress/do-remote.md work/done/do-remote.md
```

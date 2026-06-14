---
title: gate-on-rebased-tip-fresh-worktree — run the acceptance gate (`verify`) in a CLEAN worktree cut from the REBASED tip (the tree that actually integrates), not the agent's pre-rebase working checkout, so a green gate provably describes the merged artifact; ON by default (`freshWorktreeGate: true`, `--no-fresh-worktree-gate` to opt out for install cost); subsumes the dropped Gate-3 re-verify
slug: gate-on-rebased-tip-fresh-worktree
blockedBy: [prepare-config-step, run-merge-integration-concurrency-safe]
covers: []
---

> Self-contained ROBUSTNESS slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/gate1-could-run-in-fresh-worktree-to-match-pushed-branch.md` (2026-06-08, `severity: low`).
>
> MAINTAINER DECISIONS (settled 2026-06-12 — implement, do not re-open):
> - The fresh-worktree gate is **ON by default** (`freshWorktreeGate: true`): most CI/tooling caches deps and `pnpm install` is fast in that case, so correctness-first (the gate tests what merges) is the right default.
> - **Opt-out knob** `freshWorktreeGate` (POSITIVE boolean, default true, mirroring `slicerLoop`): set `freshWorktreeGate: false` / pass `--no-fresh-worktree-gate` to run `verify` directly in the agent's build worktree (today's behaviour) when per-gate install cost is too high.
> - **BLOCKED ON `prepare-config-step`:** a fresh worktree has no installed deps, so the `prepare` step (that slice) MUST run in the fresh gate worktree before `verify`. This slice cannot land until `prepare` exists. (`prepare-config-step` is now in `work/done/`.)
>
> RE-POINT (2026-06-14): the original STOP (in `## Needs attention` below) found that the default-ON shared-band gate breaks `run`'s CONCURRENT merge-mode integration, because `run` serialises only the CLAIM (not integration) and the merge push is plain non-retried, so widening the rebase-to-push window made both concurrent same-repo jobs rebase onto the same base and the loser's push fail non-fast-forward. The maintainer chose STOP option (a): land a run-concurrency precursor FIRST. That precursor now EXISTS as `run-merge-integration-concurrency-safe` (a per-repo INTEGRATE lock mirroring the claim lock). This slice's `blockedBy` now includes it, and this slice is moved back to `work/backlog/`. Once the precursor merges, `run` serialises same-repo integration so the widened window no longer races, and this slice's default-ON shared-band gate lands cleanly. The precursor also updated the `run`/`run-loop` concurrency tests to the new contract (two NON-conflicting concurrent same-repo merges both land; two GENUINELY-conflicting ones route one to needs-attention), so this slice does NOT need to re-litigate that test change.

## The gap (verify against current code)

`do`'s acceptance gate (Gate-1, `runVerify`) runs on the AGENT'S working checkout, but what actually MERGES is the work branch AFTER it is rebased onto the latest `<arbiter>/main`. The shared gate→integrate band order is `verify → review → commit → rebase-onto-arbiter → integrate` (`src/integration-core.ts`, the back-half doc ~L24/L74; `runVerify` invoked ~L349, the rebase happens AFTER). So `verify` tests the PRE-rebase tree, not the rebased tip that integrates. The two can differ:

- an integration rebase onto the latest main changes the tree the gate never saw;
- a gitignored / uncommitted file the gate relied on is present in the checkout but NOT in the pushed/merged tree (a falsely-green gate);
- any state in the checkout but not in the committed/pushed work branch.

This is the SHARED back-half, so it is true for in-place `do`, `--isolated`/`--remote`, AND `run` alike (verified: they all gate-then-rebase; the worktree paths isolate from the HUMAN checkout but still gate the PRE-rebase tree within the job worktree). It is `severity: low` — Gate-1 + Gate-2 catch essentially everything today; this is a robustness + simplification improvement, not a live bug. It was captured (not built) deliberately, and it is the ROOT-CAUSE fix that let the `drive-backlog` skill DROP its expensive per-slice "Gate-3 re-verify on a throwaway checkout of `origin/work/<slug>`" — this slice makes Gate-1 itself run on the right tree, so no downstream re-verify is ever needed.

## What to build

Make the acceptance gate run against the artifact that will actually LAND, by running `verify` in a CLEAN worktree cut from the REBASED tip — the same tree the arbiter will integrate — rather than the agent's live working checkout, by DEFAULT, with an opt-out.

1. **Re-order / re-home the gate so it tests the rebased tip.** Today the band is `verify → … → rebase → integrate`. The fresh-worktree gate needs the tree the rebase produces, so: rebase the work branch onto the latest `<arbiter>/main` FIRST (or compute the would-be-integrated commit), then cut a CLEAN throwaway worktree from THAT commit, run `prepare` (from `prepare-config-step`) then `verify` in it, and only on green proceed to the done-move + integrate. Gitignored/uncommitted state in the agent's checkout cannot leak into this gate (the worktree is cut from the committed, rebased tip), and the rebased tree is what is tested. Decide and document in a `## Decisions` block the exact ordering (gate-after-rebase) and how a rebase CONFLICT interacts (a conflict still routes to `rebase-conflict` as today — the gate simply does not run on an un-integratable tree).

2. **Gate it behind `freshWorktreeGate` (default true).** Add the config field `freshWorktreeGate: boolean` (default `true`) resolved through the standard precedence (`flag (--fresh-worktree-gate/--no-fresh-worktree-gate) > env > per-repo > global > default true`), modelled EXACTLY on `slicerLoop` (`src/config.ts` ~L234-241/L314-317 — positive name, default-on, `--no-` negation). When `false`: run `verify` in the agent's build worktree as TODAY (the pre-rebase gate), preserving current behaviour byte-for-byte for opt-outs. When `true` (default): the rebased-tip fresh-worktree gate above.

3. **Run `prepare` in the fresh gate worktree (the blockedBy reason).** The throwaway worktree is fresh — no `node_modules`/deps — so the `prepare` step (`prepare-config-step`) runs there before `verify`, exactly as it does for any freshly-materialised worktree. This is per-gate install cost when `freshWorktreeGate` is on (the cost the opt-out exists for). Reuse the `prepare`-before-`verify` seam that slice builds; do NOT reimplement install here.

4. **Reap the throwaway gate worktree.** The fresh gate worktree is created PER gate and reaped after (pass or fail) — it is not the job worktree the agent built in; it is a transient gate sandbox. Never leak it (cross-ref the worktree-hygiene concerns in `work/observations/job-worktree-artifact-agent-runner-job-json-leaks-into-commits.md` and the reap discipline in `work/backlog/isolated-config-read-main-only-fetch-and-reap-on-failure.md`). A `gate-failed` in the fresh worktree routes EXACTLY as a gate-failed does today (the source of the gate tree changes; the failure routing does not).

5. **Record that this subsumes Gate-3.** The `drive-backlog` skill already dropped its Gate-3 re-verify trusting Gate-1+Gate-2; this slice makes that trust SOUND (Gate-1 now provably tests the merged artifact). Add a one-line note in `skills/drive-backlog/SKILL.md` (in-repo source; `~/.agents/skills/` symlinks to it) where it explains dropping Gate-3, pointing at `freshWorktreeGate` as the root-cause fix (so a reader knows the rare divergence is closed by default, not merely un-checked).

## Scope

- IN: gate `verify` against the rebased tip via a clean throwaway worktree (cut from the would-be-integrated commit), running `prepare` then `verify` in it; the `freshWorktreeGate` config (default true, `--no-fresh-worktree-gate` opt-out → today's in-build-worktree gate); reaping the throwaway gate worktree; the shared-band placement so all paths benefit; the `drive-backlog` skill note that this subsumes Gate-3.
- OUT: the `prepare`/install MECHANISM itself (that is `prepare-config-step`, which this BLOCKS ON — reuse its seam); changing what `verify` checks; re-introducing a separate Gate-3 re-verify (this REPLACES the need for it); fixing the OFF-path's pre-rebase divergence (when `freshWorktreeGate:false` the gate is the pre-rebase tree as today — a consciously-accepted small gap, stated plainly, NOT closed by this slice).

## Acceptance criteria

- [ ] With `freshWorktreeGate` ON (the default), the acceptance gate runs `prepare` then `verify` in a CLEAN throwaway worktree cut from the work branch REBASED onto the latest `<arbiter>/main` (the would-be-integrated tip), NOT the agent's pre-rebase checkout. Tested: a gitignored/uncommitted file the agent's checkout has but the committed/pushed tree does NOT is ABSENT from the gate worktree (the falsely-green-gate leak is closed); a change introduced only by the integration rebase IS present in the gated tree.
- [ ] `freshWorktreeGate` is a positive boolean config, default `true`, resolved `--fresh-worktree-gate/--no-fresh-worktree-gate > env > per-repo > global > default true` (modelled on `slicerLoop`). With `--no-fresh-worktree-gate` / `freshWorktreeGate:false`, `verify` runs in the agent's build worktree exactly as TODAY (pre-rebase), byte-for-byte. Both modes tested.
- [ ] The fresh gate worktree runs `prepare` (from `prepare-config-step`) before `verify`, so a fresh worktree with no deps gates correctly. (Depends on `prepare-config-step` being landed.)
- [ ] The throwaway gate worktree is REAPED after the gate (pass OR fail) and never leaks; it is distinct from the agent's job worktree.
- [ ] A `gate-failed` (or `prepare-failed`) in the fresh worktree routes the item exactly as today (only the source of the gate tree changed, not the failure routing); a rebase CONFLICT still routes to `rebase-conflict` (the gate does not run on an un-integratable tree).
- [ ] The change lands in the SHARED gate→integrate band (`src/integration-core.ts`) so in-place `do`, `--isolated`/`--remote`, and `run` all gate the rebased tip when on — verified by inspection (not a per-path patch).
- [ ] `skills/drive-backlog/SKILL.md` notes that `freshWorktreeGate` makes dropping Gate-3 sound (Gate-1 now tests the merged artifact by default).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (note: `format:check` is ROOT-only, NOT `-r`).

## Blocked by

- `prepare-config-step` — the fresh gate worktree has no installed deps; it needs the `prepare` step to install them before `verify`. This slice reuses that seam and cannot land until it exists.

## Prompt

> Make the acceptance gate (`verify`) run against the artifact that actually MERGES, not the agent's pre-rebase checkout. Today the shared band is `verify → … → rebase-onto-arbiter → integrate` (`src/integration-core.ts`, `runVerify` ~L349, rebase AFTER), so the gate tests the PRE-rebase tree; gitignored/uncommitted state can leak into a falsely-green gate, and the integration rebase changes a tree the gate never saw. MAINTAINER DECISIONS (settled — implement): ON by default via a POSITIVE boolean `freshWorktreeGate` (default true, `--fresh-worktree-gate`/`--no-fresh-worktree-gate`, modelled EXACTLY on `slicerLoop` in `src/config.ts`); opt-out runs `verify` in the agent's build worktree as today (for when per-gate install cost is too high). BLOCKED ON `prepare-config-step` (the fresh gate worktree has no deps — run `prepare` then `verify` in it).
>
> BUILD: rebase the work branch onto the latest `<arbiter>/main` FIRST (the would-be-integrated tip), cut a CLEAN throwaway worktree from THAT commit, run `prepare` (from `prepare-config-step`) then `verify` in it, reap it after (pass or fail), and only on green proceed to done-move + integrate. Gate it behind `freshWorktreeGate` (default true; false ⇒ today's in-build-worktree pre-rebase gate, byte-for-byte). Land it in the SHARED gate→integrate band so in-place `do` / `--isolated` / `--remote` / `run` all benefit. A `gate-failed` routes as today; a rebase conflict still routes to `rebase-conflict` (no gate on an un-integratable tree). Add a one-line note in `skills/drive-backlog/SKILL.md` (in-repo source; `~/.agents/skills/` symlinks to it) where it explains dropping Gate-3, pointing at `freshWorktreeGate` as the root-cause fix that makes that trust sound. This SUBSUMES the dropped Gate-3 re-verify — do NOT re-introduce a separate downstream re-verify.
>
> READ FIRST: `src/integration-core.ts` (~L24/L74 band doc, ~L349 `runVerify` call + the rebase step after — re-home the gate after the rebase, behind the flag); `src/config.ts` (~L234-241/L314-317 `slicerLoop` — the on-by-default positive-flag pattern to mirror for `freshWorktreeGate`); `src/verify.ts` (`runVerify`); the `prepare`-before-`verify` seam from `work/backlog/prepare-config-step.md` (reuse it; do NOT reimplement install); `src/do.ts`/`src/workspace.ts`/`src/isolation.ts` (job-worktree materialise + reap — the throwaway gate worktree create/reap mechanics + predicate); `src/gc.ts` (reap). Source signal: `work/observations/gate1-could-run-in-fresh-worktree-to-match-pushed-branch.md`. Cross-ref the worktree-hygiene/reap discipline in `work/backlog/isolated-config-read-main-only-fetch-and-reap-on-failure.md`.
>
> SCOPE FENCE: do NOT build the `prepare`/install mechanism here (it is `prepare-config-step`, the blocker — reuse its seam); do NOT change what `verify` checks; do NOT re-introduce a separate Gate-3; the OFF path (`freshWorktreeGate:false`) keeps today's pre-rebase gate (its small divergence is consciously accepted, NOT fixed here); never leak the throwaway gate worktree. "Done" = with the default the gate runs prepare+verify on a clean rebased-tip worktree (the falsely-green-leak + rebase-divergence are closed), `--no-fresh-worktree-gate` restores today's gate byte-for-byte, the throwaway worktree is reaped, the change is in the shared band, drive-backlog notes the Gate-3 subsumption, and `pnpm -r build && pnpm -r test && pnpm format:check` is green (note: `format:check` is ROOT-only, NOT `-r`).

---

### Claiming this slice

```sh
agent-runner claim gate-on-rebased-tip-fresh-worktree --arbiter origin
git fetch origin && git switch -c work/gate-on-rebased-tip-fresh-worktree origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/gate-on-rebased-tip-fresh-worktree.md work/done/gate-on-rebased-tip-fresh-worktree.md
```

## Needs attention

> RESOLVED 2026-06-14 (option a chosen): the run-concurrency premise gap below is addressed by the new precursor slice `run-merge-integration-concurrency-safe` (a per-repo INTEGRATE lock mirroring the claim lock, which also updates the `run`/`run-loop` concurrency tests to the deterministic non-conflicting-both-land / conflicting-one-needs-attention contract). This slice now `blockedBy: [prepare-config-step, run-merge-integration-concurrency-safe]` and is moved back to `work/backlog/`. The historical STOP analysis is kept below for the record.

The slice's load-bearing premise — that the fresh-worktree gate can land in the SHARED gate→integrate band (`integration-core.ts`) and "benefit `run`" while default-ON, without regression — does NOT hold for `run`'s CONCURRENT merge-mode integration. Implementing it exactly as specified breaks these existing, deterministic contracts (confirmed by repeated runs; base is green, the change is red):

- `test/run.test.ts` › "claims at most maxParallel items then stops"
- `test/run.test.ts` › "two same-repo jobs both integrate under the merge path (claim + integration safe under concurrency)"
- `test/run-loop.test.ts` › "runs TWO same-repo items via the bare mirror CONCURRENTLY (merge)"
- `test/advance-registry-set.test.ts` and `test/run-uses-advance-tick.test.ts` › the calm-gates run-tick OUTCOME-equivalence tests

Root cause (verified by instrumenting the merge push): `run` integrates concurrent same-repo jobs to `main` with a PLAIN, non-retried `${branch}:main` push (`src/integrator.ts` `integrate`, merge mode) and NO per-repo integrate serialization (only the CLAIM is serialized via `claimLock` in `src/run.ts` ~L300-306; the comment at ~L312-320 explicitly says integration is "fully concurrent"). Today this only works because each job's step-4 rebase + sync push happen tightly enough that the second job rebases onto the first's already-pushed merge and fast-forwards. The fresh-worktree gate necessarily inserts pre-integrate work (a `git worktree add` off the shared bare mirror + a rebase + `prepare`+`verify` in the throwaway worktree) BETWEEN the agent and the integrate, which widens the rebase→push window so BOTH concurrent jobs rebase onto the SAME pre-merge base, then the loser's `${branch}:main` push is rejected non-fast-forward.

Why the two obvious in-band fixes do not work:
1. Re-rebase-and-retry on a stale merge push (the principled fix) re-rebases the loser onto the winner's merge, which legitimately CONFLICTS on the test fixtures' shared `agent-output.txt` (each slice writes different content to the same file via the `editingAgent`), so the loser routes to `needs-attention` (rebase-conflict) → `claimedAndDone=1`, still failing the "both reach done" assertion.
2. Per-repo integrate serialization (mirroring `claimLock`) makes it deterministic but gives the same `claimedAndDone=1` for genuinely-conflicting slices — and it changes `run`'s settled "integration is fully concurrent" model.

Both fixes touch a SEPARATE, settled component (`src/integrator.ts` / `src/run.ts` concurrency model) and STILL cannot satisfy the existing contract that two genuinely-conflicting concurrent merges both reach `done` (a property the base only achieves by benign timing). That is a maintainer-level design decision, not a self-contained factual gap, and the slice neither mentions nor sanctions it. The slice's own "Done" bar (`pnpm -r build && pnpm -r test && pnpm -r format:check` green) is therefore unreachable as specified.

Suggested re-scope (pick one, human decision):
(a) Make `run`'s merge-to-main integration genuinely concurrency-safe FIRST — either a per-repo integrate lock or a bounded rebase-retry on a non-fast-forward `${branch}:main` push — AND update the "two concurrent same-repo merges both reach done" tests to reflect that two slices which genuinely conflict route one to needs-attention (only non-conflicting concurrent merges both land). Then this slice's default-ON shared-band gate lands cleanly. Make that a `blockedBy:` of this slice.
(b) Narrow this slice: keep the fresh-worktree gate default-ON for the SINGLE-job paths (`do` in-place / `--isolated` / `--remote` / `complete`, all of which pass with the implemented design) but DEFAULT IT OFF (or gate it off) for the concurrent `run` fleet path until (a) is done — explicitly carving `run` out of "all paths benefit by default", which contradicts the slice's current text and so needs maintainer sign-off.

Everything else in the slice was implemented and green against the implemented design (the `freshWorktreeGate` config field + full precedence chain modelled on `slicerLoop`; the read-only rebased-tip gate via a throwaway detached worktree that never touches `cwd`; reaping with no leak; prepare-before-verify in the fresh worktree; gate-failed/prepare-failed/rebase-conflict routing; the OFF-path byte-for-byte; the drive-backlog Gate-3-subsumption note; new + updated tests). The blocker is solely the `run` concurrent-merge regression above, which is out of this slice's scope to resolve.

---
title: do/run/complete (the AUTONOMOUS integration path) AUTO-RECOVER an already-committed, already-done-moved STRANDED branch instead of crashing with "nothing to complete" — re-claiming a slug whose work branch is already built-and-done-moved but never merged must integrate the kept commit (or no-op if already integrated), not throw
slug: autonomous-path-auto-recovers-already-committed-stranded-branch
prd: ledger-integrity
needsAnswers: false
blockedBy: [finish-already-committed-branch]
covers: [6, 7]
---

## What to build

Teach the AUTONOMOUS integration path (`do` / `advance` / plain `complete`) to AUTO-DETECT the already-committed, already-done-moved STRANDED-branch state and run the existing recover-already-committed tail, instead of refusing with `nothing to complete (already done, or wrong slug?)`.

### The incident (CI, reproduced from git history)

The hourly CI `advance "slice:<slug>" --propose --watch --arbiter origin` failed on `do-fails-fast-when-acceptance-gate-statically-unrunnable` with:

```
error: work/in-progress/<slug>.md (nor work/needs-attention/<slug>.md) found — nothing to complete (already done, or wrong slug?).
Error: Process completed with exit code 1.
```

Root cause, verified against git history:

- A PRIOR run fully built the slice on its work branch (`origin/work/slice-<slug>`, commit `fc80817`): code committed AND the slice file `git mv`'d into `work/done/` (the `→done` move). But that branch was NEVER merged into `origin/main` (no PR landed).
- CI re-claimed the slug: it re-created `work/in-progress/<slug>.md` on `main` and put the build agent on the work branch, which already carried the complete work.
- The agent correctly did nothing ("prior attempt is complete and green").
- `do`/`advance` fell through to its integration step (`performComplete` → `performIntegration`). Source resolution in `complete.ts` (~L455-466) resolves the source folder as `in-progress` OR `needs-attention` on the BRANCH tree. The slice is in `done/` there, so it matched NEITHER, and `CompleteRefusal` ("nothing to complete") was thrown → exit 1.

This is EXACTLY the `finish-already-committed-branch` stranded-branch state (PRD `ledger-integrity` story 6), but reached through the AUTONOMOUS `do`/`advance` re-claim path rather than the explicit operator surface.

### Why the existing capability does not fire here (verified)

`finish-already-committed-branch` (DONE/merged) added `recoverAlreadyCommitted()` to the shared integration core, gated by the input flag `committedRecovery` (`integration-core.ts` ~L197-215, dispatched at ~L490). That flag is set in EXACTLY ONE place — `recover-isolated.ts` (~L178), i.e. the explicit `complete --isolated <slug>` / `resume --isolated <slug>` operator surface. The autonomous `do`/`advance`/plain-`complete` path NEVER sets it, so the recovery is never auto-triggered. That was a deliberate scope fence at the time (a `done/` slice that is genuinely COMPLETE is folder-indistinguishable from a STRANDED one). The disambiguator the PRD mandates already exists and is reused here: TIP-vs-ARBITER ancestry (`isAncestor`, `gc.ts:444`), which `recoverAlreadyCommitted` ALREADY uses for its unspoofable `already-integrated` no-op (`integration-core.ts:1396`).

### Precise scope

1. **At the `complete.ts` source-resolution refusal site (~L455-466), BEFORE throwing `CompleteRefusal`, detect the stranded-done state and route into the recover tail.** When neither `work/in-progress/<slug>.md` nor `work/needs-attention/<slug>.md` exists on the branch tree BUT `work/done/<slug>.md` IS present AND the work-branch tip is genuinely AHEAD of `<arbiter>/main` (NOT `isAncestor` — the same predicate `gc.ts`/`prompt.ts:518` use), call `performIntegration({committedRecovery: true})` (the SAME path `recover-isolated.ts` drives) instead of refusing. Do NOT duplicate the rebase→integrate tail — it already lives in the shared core; this slice only flips the routing decision at the front.
2. **Unspoofable + idempotent (the safety crux).** If the tip is ALREADY reachable on `<arbiter>/main` (genuinely complete / already integrated — e.g. the out-of-band PR DID merge between claim and re-run), the core's own detection returns `already-integrated`: a clean exit-0 no-op, NEVER a re-push / double-integrate. The autonomous caller must map `already-integrated` to a successful, non-crashing outcome (a re-claimed already-merged slug is the CORRECT no-op, not an error). This also fixes the secondary annoyance where re-claiming an already-merged slug errored.
3. **Announce, do not silently swallow.** A stranded-unmerged branch is itself a signal that something earlier went wrong (the PR never merged). On auto-recovery, emit a LOUD note (e.g. `>> recovered a stranded already-complete branch for '<slug>' — integrating the kept commit (no rebuild)`) so the CI/job log records that the autonomous path took the recovery branch, not a normal completion. The `already-integrated` no-op gets its own clear note.
4. **Honest refusal preserved.** The genuine "nothing anywhere" case (no `in-progress/`, no `needs-attention/`, no `done/` on the branch, OR `done/` present but tip is NOT ahead and NOT a clean already-integrated no-op) still refuses honestly — the auto-recover MUST NOT mask a real wrong-slug / nothing-staged error.

> SCOPE-NOTE — reuse the front-gate, do not re-derive. The `do`/`advance` path reaches `complete.ts` via step 6 `performComplete` (`do.ts` ~L1000). Land the detection in the SHARED `complete.ts` source-resolution seam so all three callers (`do`/`run`/`complete`) inherit it without per-caller duplication, exactly as `recovering`/`source` are already threaded.

## Acceptance criteria

- [ ] **CI-exact reproduction is fixed.** A throwaway-git fixture reproduces the incident: claim a slug (re-create `work/in-progress/<slug>.md` on the arbiter main), with a pre-existing `work/<slug>` branch that ALREADY has the code committed + the slice in `done/` (tip AHEAD of `<arbiter>/main`); the agent makes no new commit. The autonomous integrate path INTEGRATES from the kept commit (PR opened in propose / landed in merge) with NO rebuild, NO orphan branch, NO `--force` to main — and does NOT throw `nothing to complete`.
- [ ] **Already-integrated ⇒ clean no-op, never double-integrate.** A fixture where the kept tip is ALREADY reachable on `<arbiter>/main` (the PR merged out-of-band before the re-run) → the autonomous path returns a SUCCESSFUL, non-crashing no-op (the core's `already-integrated`), with NO re-push and NO second PR. A test asserts no re-integration occurs.
- [ ] **Detection is unspoofable + reuses the existing predicate.** The stranded-vs-complete decision is by TIP-vs-ARBITER ancestry (`isAncestor`, the SAME `gc.ts` predicate `prompt.ts`/`recoverAlreadyCommitted` use) — NOT by folder name alone. Do NOT introduce a second reachability check.
- [ ] **Honest refusal preserved.** The genuine nothing-to-complete case (no `in-progress/`/`needs-attention/`/`done/` slice on the branch, OR a wrong slug) STILL refuses with the existing `CompleteRefusal` message and exit 1 — the auto-recover never masks a real error. A test pins this.
- [ ] **Loud announcement.** On auto-recovery the path emits a clear note that it recovered a stranded already-complete branch (distinct from a normal completion); the already-integrated no-op emits its own clear note. A test asserts the recovery note fires (not silent).
- [ ] **`prompt.ts resolveSlice` is NOT modified.** Teaching ONBOARD to accept a `done/` source is the SEPARATE, already-DONE sibling slice `onboard-resolveslice-done-aware-tip-vs-arbiter` (story 5); this slice fences `prompt.ts` out. (The onboard half is what put the agent on the already-done branch in the first place; this slice only fixes the INTEGRATE half that then refused.)
- [ ] **Composes with the strand safety-net slice (SAME-FILE; this one lands FIRST).** This slice removes the ONE refusal cause that bit CI (the stranded-done crash); the sibling slice `autonomous-integration-refusal-surfaces-not-strands-in-progress` is the GENERAL backstop so any OTHER autonomous integration refusal surfaces to needs-attention rather than silently stranding `in-progress/`. Both edit the SAME `complete.ts` source-resolution region (~L455-466), so the sibling is `blockedBy` THIS slice to serialise; note the composition in `## Decisions`.
- [ ] **No on-branch ledger move added/removed.** This slice does NOT add or remove any on-branch `→needs-attention`/`→backlog`/`→in-progress`/`→done` move — it only flips the autonomous INTEGRATE routing decision. So it does NOT contradict the `humanOnly` PRD `branch-carries-code-not-ledger-status-main-owns-status` (which keeps the `→done` branch move as the atomic exception). State this composition in `## Decisions`.
- [ ] No shared/global location touched outside temp fixtures (point `workspacesDir` at a temp dir; throwaway `--bare` `file://` arbiters + real clones, no network).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `finish-already-committed-branch` — this slice REUSES the `committedRecovery`/`recoverAlreadyCommitted` capability that slice landed (the recover tail + the `already-integrated` unspoofable no-op + the `isAncestor` disambiguator). It must be present on main first. (It IS, in `work/done/`; the `blockedBy` records the dependency, not a wait.)

## Decisions (to record while building)

- The chosen routing seam in `complete.ts` (front-gate detection that sets `committedRecovery: true`) vs an alternative, and WHY it stays in the shared path so `do`/`run`/`complete` all inherit it.
- **Do NOT duplicate the ancestry check at the front gate.** `recoverAlreadyCommitted` ALREADY does its own `isAncestor(HEAD, <arbiter>/main)` and returns `already-integrated` when the tip is NOT ahead (integration-core.ts ~L1396). So the `complete.ts` front-gate detection can be MINIMAL — "the slice is in `work/done/<slug>.md` on the branch (and absent from in-progress/needs-attention)" — and DELEGATE the ahead-vs-already-integrated decision to the core. Record whether the front gate adds any ahead-check at all (prefer not; let the core own it, reusing the one `isAncestor`).
- **`do --remote` / `performDoRemote` parity:** confirm the fix lands in the SHARED `complete.ts` source-resolution so BOTH `performDo` (in-place) and `performDoRemote` (job worktree) inherit it; a test or explicit note pins that the remote autonomous path also recovers (it reaches the same `complete.ts` seam).
- The compose-not-contradict relationship to the `humanOnly` PRD `branch-carries-code-not-ledger-status-main-owns-status` (no on-branch ledger move touched here).
- The autonomous caller's mapping of the core `already-integrated` outcome to a successful no-op outcome (which `DoOutcome`/`CompleteOutcome` value), and whether any new outcome value is needed or an existing one suffices.

## Prompt

> FIRST, drift-check against current main: re-read `src/complete.ts` source-resolution (~L455-466 — the `in-progress`||`needs-attention` resolve + the `CompleteRefusal` throw, and the `performIntegration` call at ~L498); `src/integration-core.ts` (`committedRecovery` input ~L197-215, the dispatch at ~L490, and `recoverAlreadyCommitted` ~L1352 with its `isAncestor` `already-integrated` no-op ~L1396); `src/recover-isolated.ts` (~L175-200 — the ONLY current `committedRecovery: true` caller, the surface to mirror); `src/gc.ts` `isAncestor` (~L444 — the SOLE reachability predicate; reuse it); `src/do.ts` step 6 `performComplete` (~L1000 — the autonomous caller that reaches `complete.ts`); and `src/prompt.ts resolveSlice`/`isStrandedDoneBranch` (~L515 — READ for the tip-vs-arbiter pattern, do NOT modify). If an auto-recover already exists on the autonomous path, route to needs-attention noting that.
>
> GOAL: convert the `nothing to complete` crash on a re-claim of an already-built-and-done-moved-but-unmerged branch into either (a) an integrate of the kept commit, or (b) a clean already-integrated no-op — reusing the EXISTING `recoverAlreadyCommitted` capability, NOT a new tail. The autonomous path (`do`/`advance`) must reach it, not only `complete --isolated`.
>
> SAFETY: detection MUST be unspoofable — `done/` on the branch + tip genuinely AHEAD of `<arbiter>/main` ⇒ recover; tip already reachable ⇒ clean `already-integrated` no-op, NEVER a re-push/double-integrate; nothing legitimately present ⇒ the existing honest `CompleteRefusal`. Reuse `isAncestor` (do NOT fork a second reachability check). Never `--force` to main; reuse `performIntegration`'s tail (no duplication, no orphan branch). Announce the recovery LOUDLY (it signals an earlier un-merged PR).
>
> FENCE: do NOT modify `src/prompt.ts resolveSlice` (the onboard find-slice — the sibling slice `onboard-resolveslice-done-aware-tip-vs-arbiter` owns that, already DONE). Do NOT add or remove any on-branch ledger move (keep coherence with the `humanOnly` PRD `branch-carries-code-not-ledger-status-main-owns-status`).
>
> SEAM TO TEST AT: the autonomous integrate path with throwaway `--bare` `file://` arbiters + real clones — (a) pre-built+done-moved branch, tip ahead, agent no-op ⇒ integrates the kept commit (no rebuild/orphan/force); (b) kept tip already on arbiter main ⇒ clean no-op, no second PR; (c) genuinely nothing present ⇒ honest refusal preserved; (d) the recovery note fires. Point `workspacesDir` at a temp dir; no network.
>
> DONE: the autonomous path auto-recovers a stranded already-committed branch (or no-ops if already integrated), the CI `nothing to complete` crash is gone, honest refusal is preserved, `prompt.ts` is untouched, `## Decisions` records the seam + the two compositions, and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

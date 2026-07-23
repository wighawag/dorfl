---
title: 'null-harness-empty-command-guard — add the defensive BACKSTOP throw in NullHarness.launch (empty/whitespace command ⇒ throw, never `bash -c ''''`), and tidy the already-shipped up-front guard (name `--harness pi`; reuse the `doNeedsAgentCmd` helper in the `run` path)'
slug: null-harness-empty-command-guard
covers: []
---

> Self-contained fix slice — derives from NO SPEC (`covers: []`), so per `work/protocol/WORK-CONTRACT.md` it omits `prd:` and is its own source of truth. Source signal: the observation `work/observations/do-silently-defaults-to-null-harness-noop-when-unconfigured.md` (now discharged into this slice). That observation listed TWO gaps; this slice scopes ONLY **gap #1** (the code root cause). **Gap #2** (the `drive-backlog` skill mentioning `--harness`) is ALREADY DONE and is OUT of scope.
>
> **DRIFT NOTE (read before building — verified 2026-06-11):** the observation predates a guard that already shipped. The PRIMARY "up-front refusal" this slice originally proposed **already exists** as `doNeedsAgentCmd` (`packages/dorfl/src/do-config.ts` — `config.harness !== 'pi' && config.agentCmd.trim() === ''`), wired into the `do` path (`cli.ts` ~L1398), the `--remote` path (`cli.ts` ~L1313), AND the `run` path (`cli.ts` ~L644, which inlines the same predicate). So the up-front refusal is DONE for all three commands. What remains is the **BACKSTOP** (genuinely absent) plus two small tidy-ups. Confirm the above still reads as described before building (monorepo — code may have moved within `packages/dorfl/src/`).

## What to build

Close the **one genuinely-absent layer** of the null-harness-empty-command footgun — the defensive BACKSTOP inside `NullHarness.launch` — plus two small tidy-ups to the already-shipped up-front guard. The footgun and why the up-front guard alone is not enough:

### The footgun (mechanism)

A fresh repo with NO dorfl config (no global `~/.config/dorfl/config.json`, no per-repo `dorfl.json`) and no `--harness` flag resolves `harness` → its default **`null`** adapter (`config.ts` ~L18; ADR §5) AND `agentCmd` → its default **`''`** (`config.ts` ~L284). `NullHarness.launch` (`harness.ts` ~L224) then runs `spawnSync('bash', ['-c', ''])`, which exits `0` with empty stdout → `{ok: true, output: undefined}` — a "successful" build that ran **nothing**.

The up-front `doNeedsAgentCmd` guard (already shipped) catches this for the `do`/`--remote`/`run` CLI commands. But it lives at the CLI call sites, NOT behind the harness seam — so **any OTHER caller** of `NullHarness.launch` (a test, an embedding, a future code path that doesn't route through `doNeedsAgentCmd`) can still hand it an empty command and silently no-op. The downstream empty-diff backstop (`noop-backstop-counts-branch-commits`, in `work/done/`) catches the symptom even later. The seam itself should refuse — earlier and clearer.

### READ FIRST (confirm these still read as described — monorepo, code may have moved within `packages/dorfl/src/`)

- `packages/dorfl/src/harness.ts` — `NullHarness.launch` (~L224, the `const command = substituteModel(...)` then `spawnSync('bash', ['-c', command])`), and TWO throw-style precedents to match: `NullHarness.launchInteractive` (~L271, the NEAREST — same class, same "this config can't run, here's the fix" shape) and `substituteModel` (~L154). Prefer `launchInteractive`'s in-class wording. NOTE the existing `result.error` throw lower in `launch` (`failed to spawn harness command: …`) is a DIFFERENT voice (a spawn-failure, not a config error) — do not blur the new guard into it (see change #1).
- `packages/dorfl/src/do-config.ts` — `doNeedsAgentCmd` (~L177): the already-shipped predicate `config.harness !== 'pi' && config.agentCmd.trim() === ''`.
- `packages/dorfl/src/cli.ts` — the THREE up-front guard sites that already exist: `do` (~L1398, `doNeedsAgentCmd(config)`), `--remote` (~L1313, `doNeedsAgentCmd(remoteConfig)`), and `run` (~L644, which INLINES the same predicate instead of calling the helper).
- `packages/dorfl/src/config.ts` — the `harness` default `null` (~L18) and the `agentCmd` default `''` (~L284) — the defaults that make the footgun reachable.
- `packages/dorfl/src/pi-harness.ts` — `createHarness` (~L357): `pi` ⇒ `PiHarness`, anything else ⇒ `NullHarness`. Confirms the guard correctly never fires for pi.

### The change

1. **BACKSTOP (the real work) — a defensive throw inside `NullHarness.launch`** (`harness.ts`). Place the guard **early — before `substituteModel`/`spawnSync`** — and when the command is empty/whitespace after trimming, **THROW** a clear error (do NOT spawn `bash -c ''`). Check it on the trimmed `command` (i.e. after `substituteModel`, or on `input.command` — either is fine as long as an all-whitespace command is rejected). Match the **config-error voice** of `NullHarness.launchInteractive` / `substituteModel` (a clear sentence naming the cause and the fix), NOT the spawn-failure voice of the existing `result.error` throw a few lines below — keep the two throws distinct. This protects ANY caller of the seam, not just the CLI commands.

2. **TIDY — name `--harness pi` in the up-front message.** The existing `doNeedsAgentCmd` error reads `no agentCmd configured — set agentCmd in config or pass --agent-cmd.`. Extend it to ALSO name the harness escape hatch, e.g.: `no harness configured and no agentCmd set — nothing would run. Pass --harness pi (or set harness/agentCmd in dorfl.json or global config).` Apply to all three existing sites (or, better, to a single shared message if the three are consolidated per tidy-up #3).

3. **TIDY — make the `run` path reuse `doNeedsAgentCmd`.** `cli.ts` ~L644 inlines `config.harness !== 'pi' && config.agentCmd.trim() === ''` instead of calling the `doNeedsAgentCmd` helper the `do`/`--remote` sites use. Replace the inline predicate with the helper so the three sites share ONE predicate (the helper's docstring already claims `do`/`run` both reject via it — make that true). Pure consolidation; no behaviour change.

### Legitimate cases that must NOT break

- A **configured null harness WITH a real `agentCmd`** stays fully valid — only the null-AND-empty-command combination is the footgun. `NullHarness.launch` with a real command is unchanged.
- The **pi adapter is unaffected** — it invokes the pi CLI directly and ignores `agentCmd`; `doNeedsAgentCmd` already excludes pi (`!== 'pi'`), and the BACKSTOP lives in `NullHarness`, never in `PiHarness`.
- **`--harness pi` on an otherwise-unconfigured repo must work** — it is the escape hatch the message points to.

## Scope

- IN: **gap #1** (code) only — the BACKSTOP throw in `NullHarness.launch`; the `--harness pi` message tidy on the existing up-front guard; consolidating the `run` site onto the `doNeedsAgentCmd` helper; tests for the new/changed behaviour.
- OUT: **gap #2** — the `drive-backlog` skill note about `--harness` (ALREADY DONE). Also OUT: re-building the up-front refusal (it ALREADY SHIPS via `doNeedsAgentCmd` for `do`/`--remote`/`run` — do NOT add a parallel one); the empty-diff backstop (`noop-backstop-counts-branch-commits`, unchanged); the pi adapter's behaviour.

## Acceptance criteria

- [ ] `NullHarness.launch` THROWS a clear error on an empty/whitespace command instead of spawning `bash -c ''` (backstop for ANY seam caller), matching `substituteModel`'s throw style/wording.
- [ ] The existing up-front `doNeedsAgentCmd` refusal message now ALSO names `--harness pi` (alongside setting `harness`/`agentCmd` in config) at every site it fires.
- [ ] The `run` path uses the `doNeedsAgentCmd` helper rather than an inlined copy of the predicate — one shared predicate across `do`/`--remote`/`run` (no behaviour change).
- [ ] A configured null harness WITH a real `agentCmd` still launches normally (`NullHarness.launch` with a real command unchanged).
- [ ] The pi adapter is unaffected — neither the up-front guard nor the BACKSTOP fires for pi (e.g. `--harness pi` on an unconfigured repo runs).
- [ ] Tests cover: `NullHarness.launch('')` / whitespace → throws; null + real `agentCmd` → still runs; the up-front message names `--harness pi`; `run` still refuses null + empty `agentCmd` after the helper swap; pi adapter unaffected. House style (vitest; throwaway repo + local `--bare` arbiter, stubbed harness where appropriate, temp dirs, `isolatePiAgentDir`); no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately.

## Prompt

> Close the remaining layer of the null-harness-empty-command footgun: add a defensive BACKSTOP throw inside `NullHarness.launch`, and tidy the ALREADY-SHIPPED up-front guard (name `--harness pi` in its message; make the `run` path reuse the `doNeedsAgentCmd` helper). Source: the observation `do-silently-defaults-to-null-harness-noop-when-unconfigured.md` (discharged into THIS slice — scope ONLY its gap #1, code; gap #2, the `drive-backlog` skill note, is ALREADY DONE and OUT of scope).
>
> FIRST, check this slice against current reality (it is a snapshot and may have DRIFTED). CRUCIAL: the up-front refusal already SHIPS as `doNeedsAgentCmd` (`do-config.ts`: `config.harness !== 'pi' && config.agentCmd.trim() === ''`), wired into `cli.ts` `do` (~L1398), `--remote` (~L1313), AND `run` (~L644, which INLINES the same predicate). Do NOT add a parallel up-front guard. If any of that has drifted, route to `needs-attention/` rather than building on a stale premise (WORK-CONTRACT.md “Drift is a needs-attention signal”).
>
> THE MECHANISM: a fresh repo with NO config and no `--harness` resolves `harness` → default `null` (`config.ts` ~L18; ADR §5) and `agentCmd` → default `''` (`config.ts` ~L284). `NullHarness.launch` (`harness.ts` ~L224) then runs `spawnSync('bash', ['-c', ''])` → exits 0, empty stdout → `{ok: true, output: undefined}`: a "successful" build that ran nothing. The shipped `doNeedsAgentCmd` guard catches this at the THREE CLI sites, but it sits at the call sites — NOT behind the harness seam — so any OTHER caller of `NullHarness.launch` (tests, embeddings, future paths) can still hand it an empty command and silently no-op. The seam itself must refuse.
>
> READ FIRST (monorepo — code may have moved within `packages/dorfl/src/`): `harness.ts` (`NullHarness.launch` ~L224 — the `substituteModel(...)` then `spawnSync('bash', ['-c', command])`; throw-style precedents to match: `NullHarness.launchInteractive` ~L271 (NEAREST — same class) and `substituteModel` ~L154 — note the `result.error` throw lower in `launch` is a DIFFERENT spawn-failure voice, don't blur into it); `do-config.ts` (`doNeedsAgentCmd` ~L177); `cli.ts` (the three up-front sites: `do` ~L1398, `--remote` ~L1313, `run` ~L644-inlined); `config.ts` (defaults ~L18 / ~L284); `pi-harness.ts` (`createHarness` ~L357 — confirms null vs pi).
>
> BUILD:
> 1. BACKSTOP (the real work) — in `NullHarness.launch`, place the guard EARLY (before `substituteModel`/`spawnSync`); when the command is empty/whitespace after trimming, THROW a clear error (never spawn `bash -c ''`). Match the config-error voice of `launchInteractive`/`substituteModel` (name the cause + the fix), NOT the spawn-failure `result.error` throw below. Protects ANY seam caller.
> 2. TIDY message — extend the `doNeedsAgentCmd` error to ALSO name `--harness pi`, e.g.: `no harness configured and no agentCmd set — nothing would run. Pass --harness pi (or set harness/agentCmd in dorfl.json or global config).` Apply at every site it fires.
> 3. TIDY consolidation — replace the `run` path's INLINED predicate (`cli.ts` ~L644) with a call to `doNeedsAgentCmd`, so `do`/`--remote`/`run` share ONE predicate (no behaviour change; the helper's docstring already claims this).
>
> MUST NOT BREAK: a configured null harness WITH a real `agentCmd` stays valid (`NullHarness.launch` with a real command unchanged); the pi adapter is unaffected (`doNeedsAgentCmd` already excludes pi; the BACKSTOP lives in `NullHarness`, never `PiHarness`); `--harness pi` on an unconfigured repo must run (the escape hatch the message points to).
>
> TDD with vitest, house style (throwaway repo + local `--bare` arbiter, stubbed harness where appropriate, temp dirs, `isolatePiAgentDir`; no shared/global location touched). Tests cover: `NullHarness.launch('')`/whitespace → throws; null + real `agentCmd` → still runs; the up-front message names `--harness pi`; `run` still refuses null + empty `agentCmd` after the helper swap; pi adapter unaffected. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

---

### Claiming this slice

```sh
dorfl claim null-harness-empty-command-guard --arbiter origin
git fetch origin && git switch -c work/null-harness-empty-command-guard origin/main
git mv work/in-progress/null-harness-empty-command-guard.md work/done/null-harness-empty-command-guard.md
```

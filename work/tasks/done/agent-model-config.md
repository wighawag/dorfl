---
title: agent model config — first-class model through the harness seam (per-repo)
slug: agent-model-config
spec: dorfl
blockedBy: [config-env-layer]
covers: []
---

## What to build

Make the **model** a first-class, resolvable, seam-passed field so dorfl (not the operator's hand-edited command) controls which model a job runs on — across BOTH harness adapters. Auth/keys stay entirely the harness's job (ADR §13).

`harness-pi` already did the structural work (the `harness: 'null' | 'pi'` selector, `createHarness`, and the pi adapter's `extraArgs` "e.g. a pinned `--model`"). This slice PROMOTES model from buried raw args to a first-class field and wires its injection into both adapters.

End-to-end:

- **`config.model?: string`** (harness-agnostic intent; optional, no default so "unset" is meaningful). Document it like the other seam fields.
- **`LaunchInput.model?: string`** on the harness seam; `run.ts` passes `config.model` into every `launch()`.
- **Adapter injection (the adapter decides HOW the model reaches its tool):**
  - **pi adapter:** when `model` is set, pass it natively as `--model <model>` (alongside the existing `--print`/`--session-dir`; keep `extraArgs` working).
  - **null/shell adapter:** substitute a `{model}` placeholder in `agentCmd` with the model. Degradation rules: `{model}` present + model set ⇒ substitute; `{model}` present + model unset ⇒ a clear config error (don't emit a literal `{model}`); `{model}` absent ⇒ run `agentCmd` as-is (model routing is offered, never forced).
- **Per-repo resolution:** add `model` (and `harness`) to `REPO_ALLOWED_KEYS` (repo-appropriate); keep `piBin` host-only (add to `REPO_REJECTED_KEYS`); `agentCmd` stays rejected (already is). Resolve like `integration`: flag > per-repo > global > default (unset).
- **`--model <id>` CLI flag** on `run` (top of the same chain), mirroring `--integration`.

NOT in scope: per-ROLE models (build/slice/review) — staged per future capability (ADR §13); auth/keys (harness's job, never dorfl's); install-ci wiring.

## Acceptance criteria

- [ ] `config.model` resolves flag (`--model`) > per-repo `.dorfl.json` > global > default (unset); `model` + `harness` are honoured per-repo, `piBin` is rejected per-repo (reported), `agentCmd` stays rejected.
- [ ] pi adapter, with `model` set, invokes pi with `--model <model>` (verified against the stubbed `piBin`); with `model` unset, no `--model` is passed.
- [ ] null/shell adapter substitutes `{model}` in `agentCmd`; errors clearly when `{model}` is present but no model is configured; runs as-is when `{model}` is absent.
- [ ] `LaunchInput.model` flows from `config.model` through `run` to both adapters.
- [ ] dorfl sets NO auth/keys anywhere (unchanged); only model intent moves.
- [ ] Tests cover the resolution chain, both adapters' injection, and the three shell degradation cases. `pnpm -r build && pnpm -r test && pnpm -r     format:check` green.

## Blocked by

- `config-env-layer` — lands the `DORFL_*` env layer FIRST, so `model` (and the host-only `piBin`/`agentCmd`) get env support uniformly through the shared resolution chain, rather than this slice special-casing env for `model`. (`harness-pi`'s selector + pi adapter + `extraArgs`, and the per-repo config chain, already exist on `main`.)

## Prompt

> Make `model` a first-class field through the harness seam in `dorfl`, so the runner controls which model a job uses across both adapters; auth/keys stay the harness's job. READ FIRST: `docs/adr/execution-substrate-decisions.md` §13 (the model/auth boundary + staging) and §5 (harness seam); and the existing code: `src/config.ts` (`Config`, `HarnessAdapter`, `agentCmd`, `harness`, `piBin`), `src/pi-harness.ts` (the pi adapter + `extraArgs` + `createHarness`), `src/harness.ts` (`LaunchInput`, NullHarness), `src/run.ts` (where it builds the harness + launches), and `src/repo-config.ts` (`REPO_ALLOWED_KEYS` / `REPO_REJECTED_KEYS`).
>
> Implement: (1) add `config.model?: string`; (2) add `LaunchInput.model?` and pass `config.model` through `run.ts` into `launch()`; (3) pi adapter: when set, pass `--model <model>` natively (keep `extraArgs`); (4) null/shell adapter: substitute `{model}` in `agentCmd` with the three degradation rules (substitute / error-if-placeholder-without-model / run-as-is-if-no-placeholder); (5) add `model` and `harness` to `REPO_ALLOWED_KEYS`, add `piBin` to `REPO_REJECTED_KEYS`; (6) add a `--model` flag to `run` (flag > per-repo > global > default). Do NOT touch auth/keys (the harness owns those). Do NOT build per-role models (staged). Match house style; TDD with vitest (stub `piBin`). "Done" = acceptance criteria met and the gate is green.

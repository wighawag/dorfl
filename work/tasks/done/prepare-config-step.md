---
title: 'prepare-config-step — add a `prepare` field to `dorfl.json` (the env-prep / install step) that the runner runs ONCE per fresh worktree/clone BEFORE the first `verify`, distinct from (and never baked into) the acceptance gate; teach `setup` to detect/provide-or-ask for it'
slug: prepare-config-step
blockedBy: []
covers: []
---

> Self-contained PROTOCOL-PRIMITIVE slice — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/protocol-has-no-prepare-step-distinct-from-verify-gate.md` (2026-06-09, `severity: medium`).
>
> MAINTAINER DECISIONS (settled 2026-06-12 — these are the answers the observation deferred to a human; do NOT re-open them, implement them):
> - **Option (a)** of the observation: add an explicit `prepare` config field (NOT runner auto-detect, NOT "out of protocol scope").
> - `prepare` runs **before `verify` on any worktree that needs deps but does not have them**, and is **NOT part of the `verify` command** — the runner sequences `prepare` then `verify`; `verify` stays a pure acceptance check (install must NOT leak into it). "Needs prepare" = a freshly-materialised worktree (no deps yet). In TODAY's lifecycle the gate runs in the persistent job worktree the agent built in, so `prepare` effectively runs ONCE per job; the dependent slice `gate-on-rebased-tip-fresh-worktree` later makes EACH gate run in a throwaway fresh worktree, where `prepare` then naturally runs per-gate (that slice owns the per-gate-install cost tradeoff). Same rule either way: prepare a worktree that needs it, before verify.
> - `setup` must be updated to detect/provide a `prepare` value (or ASK the human for it) during onboarding, and its existing "strip install from verify" rule must point at this new sanctioned home.

## The gap (verify against current code)

`dorfl.json` has `verify` (the per-repo acceptance gate, `VerifyConfig = string | string[]`, `src/config.ts` ~L188-194; run by `runVerify` in `src/verify.ts`, invoked at `src/integration-core.ts` ~L349). There is NO `prepare`/install/bootstrap field and NO step that installs deps before `verify` runs. Consequences (from the observation):

- A fresh worktree/clone has NO `node_modules` (or vendored deps / submodules / codegen output) until something installs them. The runner builds in isolated worktrees off the hub mirror (ADR `execution-substrate-decisions` §2), so a fresh job worktree's `verify` FAILS for lack of deps unless install happens first.
- Today the only place install can go is INSIDE `verify` (observed on a real `setup`/migrate run: `verify` baked in `pnpm install --ignore-scripts && pnpm build && …`), which conflates "is the env ready?" (prepare) with "is the tree green?" (verify) and makes every gate run pay the install cost — so `verify` stops being a pure, cheaply-re-runnable acceptance check.
- `setup` already tells authors "the gate is acceptance, not env-prep; strip install prefixes from `verify`" — but that instruction is only honest once the protocol provides WHERE install belongs. This slice provides that home.

## What to build

1. **Add a `prepare` field to the per-repo config** (`src/config.ts`). Same shape as `verify` (`string | string[]`, ordered, all must pass), resolved through the same precedence chain (`flag > env > per-repo > global > default`). UNSET ⇒ no prepare step (NOT a default install command — a repo with no deps needs none; do not invent a default that would run `pnpm install` in a repo that has no lockfile). Document it next to `verify`: `prepare` = env-prep (install deps, fetch submodules, run codegen) run ONCE before the first `verify` on a fresh worktree; `verify` = the acceptance gate. State explicitly that `prepare` is NOT part of `verify` and install must NOT be baked into `verify`.

2. **Run `prepare` BEFORE `verify` on a freshly-materialised worktree.** Wire it at the gate seam so EVERY path that runs `verify` on a possibly-fresh tree benefits: the autonomous `do`/`run` job-worktree paths (the fresh worktrees off the mirror) AND `complete`. Mechanism:
   - `prepare` runs when a worktree is materialised-and-needs-deps, before its first `verify`. Do NOT engineer a durable cross-gate "skip if already prepared" cache — in TODAY's lifecycle the gate runs in the SAME job worktree the agent already built in (one prepare per job; no second verify needs a re-install within one job), and the dependent fresh-worktree-gate slice deliberately makes each gate worktree THROWAWAY (so prepare SHOULD run per-gate there, and that slice owns the per-gate-install cost tradeoff). The REQUIRED behaviour is simply "prepare a fresh worktree before its verify." If a cheap, NON-committed signal is useful to skip a REDUNDANT re-install WITHIN ONE persistent worktree's lifetime (e.g. the build step already installed in that same worktree), it may be a sentinel in the worktree CONTROL area / `workspacesDir` (NOT a committed file) — keep it OPTIONAL and document the choice in a `## Decisions` block.
   - A non-empty `prepare` that FAILS (non-zero) is a hard error that routes the item the SAME way a red gate does (or a distinct `prepare-failed` outcome — decide and document): the env could not be made ready, so `verify` cannot be trusted. Surface it clearly (a "prepare failed" message distinct from "gate failed"), and NEVER proceed to `verify`/integrate on a failed prepare.
   - `prepare` UNSET ⇒ the step is a no-op (today's behaviour byte-for-byte; a repo with no deps is unaffected).

3. **`dorfl verify` CLI + `prepare` visibility.** Decide (and document) whether the standalone `dorfl verify` command (`src/cli.ts` ~L1026) runs `prepare` first too (so a human invoking it on a fresh checkout gets a working gate) or stays verify-only (prepare is the runner's fresh-worktree concern). Lean: keep the standalone `verify` command verify-ONLY (it is the pure gate; a human prepares their own checkout), and run `prepare` only in the runner's fresh-worktree lifecycle — but state the choice.

4. **Teach `setup` to detect/provide-or-ask for `prepare`.** Update `skills/setup/SKILL.md` (the in-repo source; recall `~/.agents/skills/` symlinks to it): when onboarding a repo, DETECT a likely prepare command (a lockfile ⇒ the matching install, e.g. `pnpm-lock.yaml` ⇒ `pnpm install`; submodules ⇒ `git submodule update --init`; a codegen script) and either set `prepare` in the scaffolded `dorfl.json` OR ASK the human to confirm/provide it. Update `setup`'s EXISTING "strip install from `verify`" rule to say WHERE install now belongs: it moves to `prepare`, not deleted. The two fields must be presented as the clean split (prepare = env-ready, verify = tree-green).

## Scope

- IN: the `prepare` config field (schema + precedence + docs); the runner running `prepare` once-per-fresh-worktree before the first `verify` (with a non-committed prepared-ness marker so it does not re-run per gate); a clear `prepare`-failed surface distinct from gate-failed; the `setup` skill update (detect/ask + repoint the strip-install rule).
- OUT: baking install INTO `verify` (the whole point is to NOT do that); a default `prepare` command when unset (unset ⇒ no-op); the fresh-worktree GATE-ON-REBASED-TIP change (that is the dependent slice `gate-on-rebased-tip-fresh-worktree`, which BLOCKS ON this one); auto-detecting prepare with no config (decided AGAINST — option (a), an explicit field, won); changing `verify`'s own semantics.

## Acceptance criteria

- [ ] `dorfl.json` accepts a `prepare` field (`string | string[]`, same resolution/precedence as `verify`); unset ⇒ no prepare step (no default install). Documented next to `verify` with the prepare=env-ready / verify=tree-green split and the explicit "install must NOT be baked into `verify`" rule.
- [ ] On a FRESH worktree/clone, the runner runs `prepare` (when set) BEFORE `verify`. Tested: a freshly-materialised worktree ⇒ prepare runs then verify. (No durable cross-gate skip-cache is required; an OPTIONAL within-one-worktree non-committed signal to skip a redundant re-install is allowed but must be a control-area sentinel, never a committed marker.)
- [ ] A failing `prepare` (non-zero) NEVER proceeds to `verify`/integrate and surfaces a message distinct from "gate failed" (a `prepare-failed`-style outcome). Tested.
- [ ] `prepare` UNSET ⇒ byte-for-byte today's behaviour (no-op); a repo with no `prepare` is unaffected. Tested.
- [ ] `prepare` does NOT pollute the committed repo tree (any prepared-ness signal, if used, lives in the worktree control area / `workspacesDir`, not the repo tree) — verified by inspection + a test that the repo tree is unchanged by running prepare.
- [ ] `setup` (`skills/setup/SKILL.md`) is updated to DETECT a likely `prepare` command (lockfile/submodules/codegen) and set it OR ask the human, and its "strip install from `verify`" rule now points install at `prepare` as the sanctioned home.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. It is the PREREQUISITE for `gate-on-rebased-tip-fresh-worktree` (which needs a sanctioned install step to run `verify` in a fresh worktree cut from the rebased tip).

## Prompt

> Add a `prepare` (env-prep / install) step to the dorfl protocol, DISTINCT from the `verify` acceptance gate. MAINTAINER DECISIONS (settled — implement, do not re-open): option (a) — an explicit `prepare` config field (NOT runner auto-detect, NOT out-of-scope); `prepare` runs ONCE per fresh worktree/clone BEFORE the first `verify` and is NOT baked into `verify` (the runner sequences prepare→verify; `verify` stays a pure, cheaply-re-runnable acceptance check; install must NOT leak into it); on an already-prepared tree `prepare` is SKIPPED; `setup` must detect/provide-or-ask for it and repoint its "strip install from verify" rule at `prepare`.
>
> THE GAP (verify first): `dorfl.json` has only `verify` (`src/config.ts` ~L188-194, `src/verify.ts`, invoked `src/integration-core.ts` ~L349); there is no prepare/install step, so a fresh job worktree off the hub mirror has no `node_modules` and `verify` fails unless install is (wrongly) baked into `verify`.
>
> BUILD: (1) add a `prepare` field (`string | string[]`, same precedence as `verify`; unset ⇒ no-op, NO default install) in `src/config.ts`, documented as env-ready vs verify's tree-green, with the explicit "do not bake install into verify" rule. (2) Run `prepare` once-per-fresh-worktree before the first `verify` at the gate seam (covers the autonomous `do`/`run` job-worktree paths + `complete`), gated by a NON-COMMITTED prepared-ness marker (in the worktree control area / `workspacesDir`, e.g. alongside `.dorfl-job.json` — NOT a committed file) so it does not re-run per gate; a failing `prepare` never proceeds to verify/integrate and surfaces a `prepare-failed`-style message distinct from gate-failed. (3) Decide + document whether the standalone `dorfl verify` CLI runs prepare first (lean: NO — keep it verify-only). (4) Update `skills/setup/SKILL.md` (in-repo source; `~/.agents/skills/` symlinks to it) to detect a likely prepare command (lockfile ⇒ matching install / submodules / codegen) and set-or-ask, and repoint the existing "strip install from verify" rule at `prepare`.
>
> READ FIRST: `src/config.ts` (the `verify`/`VerifyConfig` field ~L36/L188-194 — add `prepare` beside it), `src/verify.ts` (`runVerify`/`resolveVerifyCommands` — the model to mirror for `prepare`), `src/integration-core.ts` (~L349, where `runVerify` is called in the gate band — where prepare-before-verify wires in), `src/do.ts`/`src/workspace.ts` (the job-worktree lifecycle where a fresh worktree is materialised — where the prepared-ness marker lives), `src/cli.ts` (~L1026, the standalone `verify` command), `skills/setup/SKILL.md` (the onboarding skill to update). Source signal: `work/observations/protocol-has-no-prepare-step-distinct-from-verify-gate.md`.
>
> SCOPE FENCE: do NOT bake install into `verify`; do NOT add a default `prepare` when unset; do NOT make prepare re-run per gate (once per fresh worktree); the prepared-ness marker must NOT be a committed file; this slice does NOT change the gate-on-rebased-tip behaviour (that is the dependent slice). "Done" = `prepare` is a first-class config field run once-before-verify on a fresh worktree with a non-committed marker, a failing prepare is surfaced distinctly and blocks verify/integrate, unset is a no-op, `setup` detects/asks + repoints the strip-install rule, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
dorfl claim prepare-config-step --arbiter origin
git fetch origin && git switch -c work/prepare-config-step origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/prepare-config-step.md work/done/prepare-config-step.md
```

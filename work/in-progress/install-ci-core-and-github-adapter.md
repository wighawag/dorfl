---
title: install-ci core + GitHub adapter + auth (the shared scaffolder foundation)
slug: install-ci-core-and-github-adapter
prd: runner-in-ci
blockedBy: []
covers: [1, 4, 7, 8, 10]
---

## What to build

The provider-agnostic foundation of the `install-ci` scaffolder, plus its first (GitHub) CI-provider adapter, end to end: a wizard + non-interactive config path that produces auth/setup artifacts into a `--fake` scratch directory and is fully snapshot-tested with NO network and NO real GitHub. This is the shared core every per-capability workflow slice (A/B/C/D/E/F) builds on; it emits NO capability workflow itself yet (those are the sibling slices), only the auth/secrets/setup machinery and the seam they plug into.

Concretely the slice delivers a thin path through all layers:

- **Provider-agnostic core** (build once, reused by every capability slice): the provider/model/auth config model (the `ProviderEntry` / `AuthMode` / `CIConfigFile` shapes), the `models.json` builder, the interactive wizard prompts (provider / model / auth mode), the config-file load + `--export-config` (with an opt-in `--include-secrets`) path, the `--fake` snapshot mechanism (write to a `.fake/` scratch dir instead of `.github/`), and the secret-orchestration LOGIC (which secrets, dedup, prompt-or-take-from-config).
- **Thin CI-provider seam + GitHub adapter:** adopt whitesmith's proven `GitHubCIContext` interface as the seam (`setSecret(name, value)`, `repo`, `ghAvailable`, and "emit files for these capabilities"). The core is provider-agnostic; the GitHub adapter is thin and is the first/only adapter built here. Workflow-YAML emission is host-specific and lives behind this adapter.
- **A capability-emitter REGISTRY seam (file-orthogonality for the sibling slices).** The four per-capability workflow slices (A/B build-tick, C advance-lifecycle, D intake, E close-job) each ADD a capability emitter. (Capability F needs no emitter slice — its CI reap job already rides the advance-lifecycle template; see the F-residue item above.) To keep the four mergeable in parallel (none `blockedBy` another; all only `blockedBy` THIS core), the core MUST expose capability selection as a REGISTRY / plugin seam where each capability lives in its OWN module and self-registers (an array assembled from per-capability files, a directory of emitters, or equivalent) — NOT a hand-edited central `switch`/list every capability slice must touch. The contract's file-orthogonality rule (WORK-CONTRACT slice-quality / `to-slices` §3) is the reason: a shared central list is a guaranteed integration conflict across the capability slices. This slice ships the seam + ONE reference capability registration (or a no-op fixture) proving a new capability registers without editing a shared file.
- **The shared composite setup action** (`agent-runner-setup`): installs Node + `agent-runner` + the configured harness, configures git identity, and configures AI-provider auth. Both auth modes mirror whitesmith: a default **`models.json`** mode (one GitHub secret per provider API key, config generated inline) and an **`auth.json`** mode (a single `PI_AUTH_JSON` secret + a `GH_PAT` for OAuth-token refresh). Default to `models.json` to avoid the `auth.json` OAuth-refresh script + `GH_PAT` rotation edge; if `auth.json` is offered, carry the refresh script + `GH_PAT` requirement verbatim and DOCUMENT it as the known sharp edge.

- **Optional repo-setting: GitHub `delete_branch_on_merge` (the ONLY unbuilt capability-F residue).** Capability F (merged-branch reap) is ALREADY wired in CI: the seed `docs/ci/advance-loop.yml.template` carries a `reap-merged-branches` job running the landed `agent-runner gc --remote-branches` on the advance tick's existing `schedule:` cron (delivered by `reap-merged-remote-work-branches`, done). So there is NO separate gc-sweep workflow to emit. The one thing NOT yet wired is the optional GitHub `delete_branch_on_merge` repo setting, marked by that slice as an ADDITIVE GitHub-only convenience (NOT a replacement for the provider-agnostic sweep, which is the general home and the only thing that works on a `--bare`/non-GitHub arbiter). This slice's wizard MAY offer to set it via the `GitHubCIContext` repo-settings path (stubbed in tests); it is optional and off-by-default-prompted, never silently toggled.

The whitesmith reference for all of the above is `~/dev/github/wighawag/whitesmith/src/providers/github-ci.ts` (the `GitHubCIContext` interface, the `setOrPromptSecrets` logic, the `--export-config`/`--config`/`--fake` paths). Reuse its PATTERNS; do NOT reuse its label state-machine or issue lifecycle (out of scope).

This slice is a pure deterministic generator + a stubbable adapter seam, so it is agent-buildable under `--fake` snapshot tests (no workflow files land in a real `.github/`, no secret touches a real store).

## Acceptance criteria

- [ ] `install-ci` exists as a command surface with an interactive wizard AND a non-interactive `--config <file>` path; `--export-config` (and `--export-config --include-secrets`) round-trips the same config the wizard would gather.
- [ ] The provider-agnostic core (config model, `models.json` builder, secret-orchestration logic, `--fake` snapshot) is separated from the GitHub adapter behind the `GitHubCIContext` seam, so a second provider could be added without touching the core (US #7/#10 made concrete, not aspirational).
- [ ] A capability-emitter REGISTRY seam exists such that adding a new capability is a NEW self-registering module, NOT an edit to a shared central list/switch (so the sibling capability slices are file-orthogonal and mergeable in parallel). A test proves a newly-registered fixture capability is picked up without editing any existing file.
- [ ] (Optional, capability-F residue) The wizard MAY offer to set GitHub's `delete_branch_on_merge` repo setting via the `GitHubCIContext` repo-settings path (stubbed in tests; never silently toggled). The merged-branch SWEEP itself is NOT emitted here — it already rides the advance tick's schedule (`gc --remote-branches`, done via `reap-merged-remote-work-branches`).
- [ ] `--fake` mode writes the composite setup action + auth artifacts to a `.fake/` scratch directory (NOT `.github/`) and sets NO real secret; the produced files are snapshot-asserted.
- [ ] The non-interactive config-file path reproduces byte-identical output to the interactive wizard for the same inputs (a snapshot test pins this equivalence).
- [ ] Both auth modes are generated: `models.json` (default; one secret per provider key) and `auth.json` (`PI_AUTH_JSON` + `GH_PAT` + the OAuth-refresh script, documented as the sharp edge).
- [ ] The CI-provider seam (`GitHubCIContext`: `setSecret`, `repo`, `ghAvailable`) is STUBBED in all tests: no network, no real `gh`, no real GitHub repo detection.
- [ ] Tests cover the new behaviour, mirroring the repo's existing `--fake`/snapshot test style and reusing `src/advance-ci-template.ts`'s structural-validation approach where applicable.
- [ ] **Shared-write isolation:** because secret-setting and repo-detection touch shared/global state (a real secrets store, `gh` config, git identity), the tests MUST point every such path at the stubbed seam / a temp scratch dir AND assert no real secrets store, no real `~`, and no system git config were written. The seam stub is the mechanism (`setSecret` records to memory, `ghAvailable=false` in tests); assert the real `.github/`, real secrets, and `GIT_CONFIG_GLOBAL` are untouched.

## Blocked by

- None — can start immediately. All engine pieces it wires are already in `work/done/`; this slice builds only the generator + seam, which depend on nothing unlanded.

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): re-read `work/prd/runner-in-ci.md` (the "Provider-agnostic core + thin GitHub adapter" and "Testing Decisions" sections) and confirm the whitesmith reference file `~/dev/github/wighawag/whitesmith/src/providers/github-ci.ts` still exposes the `GitHubCIContext` interface (`setSecret`, `repo`, `ghAvailable`) and the `--export-config`/`--config`/`--fake` paths this slice adopts. If whitesmith's seam shape has changed, or an ADR (`docs/adr/ci-config-policy-and-gate-family.md`) superseded an assumption here, do NOT build on the stale premise — route this slice to `needs-attention/` with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale slice produces wrong-but-compiling work.
>
> GOAL: build the provider-agnostic foundation of the `install-ci` scaffolder + its GitHub adapter + the auth/setup artifacts, fully `--fake`-snapshot-tested with no network and no real GitHub. This is the SHARED FOUNDATION the per-capability workflow slices (build tick, advance loop, intake, close-job, gc sweep) all build on; it emits NO capability workflow itself, only the auth/secrets/composite-setup machinery and the seam they plug into.
>
> DOMAIN VOCABULARY: `install-ci` is a human-run, one-time SCAFFOLDER (mirrors whitesmith's). It writes `.github/**` + a composite setup action + secrets; the running CI job NEVER edits `.github/workflows/**` (that boundary is enforced by the capability slices, but keep the core agnostic to it). Auth modes mirror whitesmith: `models.json` (default — one GitHub secret per provider API key) and `auth.json` (a single `PI_AUTH_JSON` secret + `GH_PAT` + an OAuth-refresh script — the known sharp edge; default AWAY from it). The CI-provider seam is whitesmith's `GitHubCIContext` (`setSecret(name,value)`, `repo`, `ghAvailable`, emit-files). The `--fake` snapshot mode writes to a `.fake/` scratch dir, never `.github/`.
>
> WHERE TO LOOK: the reference implementation is `~/dev/github/wighawag/whitesmith/src/providers/github-ci.ts` (~900 lines; `GitHubCIContext` interface near the top, `setOrPromptSecrets`, the `--export-config`/`--include-secrets`/`--fake` handling). Reuse its PATTERNS for the wizard, the `models.json` builder, the config load/export, the `--fake` mechanism, and the secret-orchestration logic. Do NOT reuse its label state-machine or issue lifecycle. The existing seed `docs/ci/advance-loop.yml.template` + `docs/ci/README.md` + `src/advance-ci-template.ts` show this repo's existing CI-template + structural-validator style — reuse `src/advance-ci-template.ts`'s validation approach for snapshot assertions. ADR `docs/adr/ci-config-policy-and-gate-family.md` records why CI policy is the existing gate family resolved via the workflow env block (you don't implement gates here, but the auth/config shape must not invent a CI-specific config field).
>
> SEAMS TO TEST AT: stub the `GitHubCIContext` seam entirely — `setSecret` records to memory, `ghAvailable=false`, `repo` a fixture. No network, no real `gh`, no real GitHub. Generate into a `--fake` / `.fake/` scratch dir and snapshot-assert the produced composite-setup action + auth artifacts. Prove the non-interactive `--config` path reproduces the interactive output byte-for-byte.
>
> DONE means: the `install-ci` core + GitHub adapter + both auth modes + the composite setup action are generated and snapshot-tested under `--fake`; the seam is cleanly separated (a second provider could slot in without touching the core); and the acceptance criteria above (including the shared-write isolation assertions — real secrets store / real `~` / system git config untouched) all pass. Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform any git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim install-ci-core-and-github-adapter --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-core-and-github-adapter <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/install-ci-core-and-github-adapter.md work/done/install-ci-core-and-github-adapter.md
```

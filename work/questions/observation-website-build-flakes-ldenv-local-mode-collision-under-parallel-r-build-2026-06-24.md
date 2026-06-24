<!-- dorfl-sidecar: item=observation:website-build-flakes-ldenv-local-mode-collision-under-parallel-r-build-2026-06-24 type=observation slug=website-build-flakes-ldenv-local-mode-collision-under-parallel-r-build-2026-06-24 allAnswered=false -->

## Q1

**Triage: what becomes of this signal — keep as a noted flake, promote to a task to investigate/fix the ldenv mode-name collision under `pnpm -r build`, or drop it?**

> The observation notes the `website` package intermittently fails the `pnpm -r build` acceptance gate with `Loading Svelte config from Vite config failed: Error: "local" cannot be used as a mode name because it conflicts with the .local postfix for .env files.` Isolated `pnpm --filter '@dorfl/website' build` and clean re-runs always succeed, so the author hypothesises a transient `ldenv`/Vite mode-name collision triggered only by concurrent recursive builds, not a real website regression. The author explicitly scopes it out of the discharging task and files it 'so the flake is captured'. Reality check: `website/svelte.config.js` exists, the AGENTS.md confirms `pnpm -r build` is part of the acceptance gate, and there is a sibling cluster of parallel-build flake observations (e.g. `git-integration-tests-time-out-under-parallel-load-2026-06-24.md`, `fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load.md`), so this flake genuinely threatens the gate's signal even if the website itself is fine. The honest open judgement is whether the repo treats this as a logged-but-tolerated flake or as an actionable task (e.g. pin a non-`local` mode name, serialise the website build, or report upstream to `ldenv`).

_Suggested default: keep — record the flake; promote to a task only once it recurs frequently enough to actually red the gate, since today it is rare, self-clearing on rerun, and the suspected root cause (ldenv mode-name handling under concurrent invocation) is upstream of this repo._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

keep — record the flake as a watch-item. It is rare, self-clearing on rerun, and the suspected root cause (ldenv mode-name handling under concurrent invocation) is UPSTREAM of this repo, so a task now would chase an upstream cause on thin evidence. Promote to a task only once it recurs frequently enough to actually red the gate.

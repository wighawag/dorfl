---
title: install-ci generated CI prefers a project-pinned dorfl over the global one
slug: install-ci-prefer-project-local-dorfl
prd: install-ci-project-provisioning
blockedBy: [install-ci-project-setup-hook]
covers: [7, 8]
---

## What to build

Make the generated CI run the dorfl the REPO declares (its `devDependencies` pin) rather than a global latest, while keeping the global install as a zero-config bootstrap. End to end:

- The dorfl invocations in the generated workflows resolve a project-local `node_modules/.bin/dorfl` FIRST, and fall back to the global install when none is present (C1). The global `npm install -g dorfl` stays as the always-present BOOTSTRAP so a config-less repo still works zero-config.
- Once the project-setup hook's `pnpm install` has run and dorfl is a project devDep, that resolver finds the pinned dorfl (C3) — so CI and the laptop run the same dorfl and a version bump is deliberate, not silent.
- The resolution mechanism is a `## Decisions` choice: either a generated `bin/dorfl` shim that prefers local-then-global, OR a `DORFL=` resolution prefix computed once and used by every invocation. NOTE the seam shape: the literal `dorfl <verb>` invocation strings today live across SEVERAL per-capability workflow templates; PREFER threading a SINGLE shared invocation-prefix/resolver over editing each template's literal (record which you chose and why).

A thin vertical task: the resolver + every generated invocation routed through it + `--fake` snapshot tests proving local-then-global behaviour.

## Acceptance criteria

- [ ] Generated workflow invocations resolve a project-local `node_modules/.bin/dorfl` first, else the global install.
- [ ] The global `npm install -g dorfl` bootstrap remains, so a repo with no project-local dorfl still runs zero-config.
- [ ] With a project-local dorfl present, the invocation resolves IT; absent, it resolves the global — asserted WITHOUT a network or a real install.
- [ ] The resolver is applied uniformly to ALL generated dorfl invocations (no capability left invoking a bare global `dorfl` by accident); prefer a single shared prefix/resolver over per-template duplication.
- [ ] Tests cover the local-then-global resolution under `--fake` (snapshot / behavioural, no live Actions run), mirroring the existing install-ci test style.
- [ ] **Shared-write isolation:** `--fake` tests write only into a scratch/temp dir and assert the real `~` / secrets store / system git config are untouched.

## Blocked by

- `install-ci-project-setup-hook` — SERIALIZED. The C3 half (a project-installed dorfl) only becomes reachable once the project-setup hook exists to run `pnpm install`, AND both tasks touch the composite-action / invocation-emitting surface, so serializing avoids a merge conflict (TASKING-PROTOCOL §3: serialize same-module tasks even without a strict logical dependency).

## Prompt

> Make the `install-ci`-generated CI prefer a PROJECT-PINNED dorfl (the repo's `devDependencies` version) over a global latest, falling back to the global install when none is pinned — so CI runs the dorfl the repo declares, not a skewed global. This is the (C) axis of the `install-ci-project-provisioning` PRD (C1 + C3).
>
> FIRST, drift-check (launch snapshot): re-read `work/prds/tasked/install-ci-project-provisioning.md` (the (C) decisions) AND confirm the blocking task `install-ci-project-setup-hook` landed in `work/tasks/done/` with the project-setup hook shape this task assumes (the hook is what runs the project's `pnpm install`, making C3 reachable). Confirm where the generated dorfl invocations live today (currently the literal `dorfl <verb>` strings are spread across the per-capability workflow templates) and the global-install step in the composite action. If the invocation surface or the hook changed shape since this was written, do not build on the stale premise — route to needs-attention.
>
> DOMAIN VOCABULARY: the COMPOSITE setup action installs the GLOBAL dorfl (the bootstrap); the capability workflows then invoke `dorfl <verb>`. `installSource: registry` ⇒ `npm install -g dorfl`; `workspace` ⇒ build-from-source for the dorfl monorepo (leave that path's behaviour intact — it already links a specific dorfl). C1 = resolve local `node_modules/.bin/dorfl` then global; C3 = once the project-setup hook's `pnpm install` makes dorfl a devDep, the resolver finds it. The running CI job never edits `.github/workflows/**` (US #9) — the resolver lands in the generated artifacts via the EMITTER.
>
> WHERE TO LOOK (by concept): the per-capability workflow TEMPLATES that emit the literal `dorfl <verb>` invocations (there are several — advance-lifecycle, the CI template, close-job, intake, gc — verify the live set), and the composite-action global-install step. The existing `--fake` snapshot tests for the invocation/assertion style.
>
> KEY DECISION (record in a `## Decisions` block): the resolver MECHANISM — a generated `bin/dorfl` shim (prefer-local-then-global) vs. a `DORFL=` resolution prefix computed once. PREFER a SINGLE shared invocation prefix/resolver over editing each template's literal string (fewer files, no per-capability drift); justify whichever you pick. Do NOT change the `workspace`-mode install path.
>
> RECORD non-obvious in-scope decisions (a `## Decisions` line; an ADR if it meets the gate).
>
> DONE means: every generated dorfl invocation resolves local-then-global; the global bootstrap remains for zero-config repos; local-present and local-absent are both tested under `--fake` with shared-write isolation. Finish with `pnpm format`, then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim install-ci-prefer-project-local-dorfl --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-prefer-project-local-dorfl <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/install-ci-prefer-project-local-dorfl.md work/tasks/done/install-ci-prefer-project-local-dorfl.md
```

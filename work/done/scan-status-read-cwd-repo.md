---
title: scan-status-read-cwd-repo — scan/status also report the CURRENT repo as a labelled local section (fetch-its-arbiter-first), with a self-registration empty-state hint
slug: scan-status-read-cwd-repo
prd: command-surface-phase-2
blockedBy: [registry-remote, scan-status-fetch-first]
covers: []
---

## What to build

> Self-contained UX/robustness fix derived from a LIVE signal (running `scan`/ `status` inside the agent-runner repo gave a dead-end "No participating repos found" even though the cwd IS a participating repo). It has no command-surface user story of its own (`covers: []`) — it refines the §5/§6 scan/status surface.

Make `scan` and `status`, **when run inside a participating repo**, ALSO report that CURRENT repo — as a **clearly-labelled, separately-counted LOCAL section** — in addition to the cross-repo REGISTRY view. Today both commands read ONLY the registry (the hub-mirror set under `<workspacesDir>/repos/`), so standing inside a `work/`-bearing repo that is not registered yields a dead-end "No participating repos found." That is a real UX failure: the tool is literally inside a participating repo and claims to see nothing.

### The core behaviour

- **Detect the cwd repo's participation** via the existing `isParticipatingRepo` (`detect.ts`) — a `work/backlog/` with ≥1 `.md`. If participating, read its `work/` lifecycle via the existing **working-tree** read path (`scanRepoPaths([cwd])` / the read seam's local-tree method) — NOT the bare mirror-ref path the registry uses.
- **Render it as a DISTINCT, labelled section** — e.g. a `This repo (local working tree):` block, with its OWN count — ABOVE/beside the `Registered repos:` block. **NEVER merge the counts into one grand total** (see the consistency rule below).
- **Fetch the cwd repo's OWN arbiter first** (the fetch-first discipline, extended to the local repo — see the dedicated section below), so the divergence line is honest; warn + fall back to last-known on a failed fetch (same as `scan-status-fetch-first`).
- **Self-registration empty-state hint.** When the cwd repo participates but is NOT in the registry, the local section says so and teaches the fix, e.g.:
  > This repo participates (N backlog item(s)) but is **not registered** — `run`/ `scan` across machines won't see it until `agent-runner remote add . --local` (or `remote add <its-url>`). This replaces the current dead-end "No participating repos found" message when you are standing in a participating repo.

### Fetch-first ALSO applies to the cwd repo (the maintainer's explicit ask)

`scan-status-fetch-first` fetches the REGISTRY mirrors before reading them. The SAME discipline must apply to the cwd repo's local section: **fetch the cwd repo's arbiter remote before computing its divergence**, because the local working tree is the LEAST authoritative view (it can be stale or diverged from the arbiter). So:

- Resolve the cwd repo's arbiter (the existing `arbiterStatus` / arbiter-detection used by today's `status` arbiter section — `origin` by default, or the configured arbiter). Fetch it first; warn + fall back to last-known offline on failure (NEVER error out — a read-only command must degrade, ADR §5/§6).
- Then compute + show the local section's **divergence vs the fetched arbiter `main`** (see the consistency rule) so freshness is honest.
- This reuses `scan-status-fetch-first`'s fetch+warn+fallback pattern; it does NOT introduce a new fetch mechanism (hence the dep on that slice — land it first so the pattern + the retired offline invariant are already in place).

### The consistency rule (avoid the one real trap)

The danger is NOT reading the cwd — it is **conflating two reads with different freshness + storage models into one number**:

1. the **registry** read is from bare hub mirrors' `main` ref = the ARBITER's integrated state (freshly fetched);
2. the **cwd** read is from the LOCAL WORKING TREE = your possibly-uncommitted / unpushed / diverged state.

So:

- **Keep the two sections VISUALLY + SEMANTICALLY distinct; never a merged grand total** (a summed count would be true in neither model).
- **Label each section's SOURCE + freshness:** "local working tree (may be ahead of the arbiter)" vs "registry (arbiter `main`, fetched <when>)".
- **Show the cwd repo's divergence-from-arbiter** (e.g. "local `main` is N commits ahead of `<arbiter>/main` — unpushed") using the SAME divergence framing `main-divergence-guard` introduces (cite it; keep the language consistent). This is the honest expression of (2)'s staleness.
- **De-dup explicitly:** if the cwd repo is ALSO registered, show it ONCE in the local section marked "(also registered)", and either omit it from the registry list or mark the registry row as "= this repo" — so the same repo never appears as two mystery rows with possibly-disagreeing states.

### Why this does NOT break the registry model

The registry invariant is narrow: the autonomous DAEMON (`run`) and the arbiter CAS CLAIM against the registry (hub mirrors) — that is the source of truth for autonomous claiming under concurrency. `scan`/`status` are READ-ONLY REPORTING surfaces; showing the cwd in them changes nothing about where claims happen or what `run` operates on. The machinery already exists (`scan.ts` has BOTH the registry `scan()` and the working-tree `scanRepoPaths()`), so this is wiring + presentation, not new infrastructure. It also aligns with the direction `advance-loop` sets (its `ls work/questions/` is a cwd-local "what needs me?" view, a first-class surface distinct from the cross-repo registry).

## Scope fence

- IN: cwd-participation detection; the labelled local section (own count, source + freshness labels); fetch-the-cwd-arbiter-first (warn + fallback); the divergence-vs-arbiter line; the self-registration empty-state hint; explicit de-dup when the cwd is also registered; for BOTH `scan` and `status`.
- OUT: changing WHAT the daemon/CAS claim against (still the registry — unchanged); changing the registry mirror-ref read strategy; a merged cross-repo+local total; surfacing `work/questions/` counts (that arrives with `advance-loop`, a natural follow-on); auto-registering the cwd repo (the hint TEACHES `remote add`, it does not run it).

## Acceptance criteria

- [ ] Run inside a participating repo, `scan` AND `status` show a DISTINCT, separately-counted local section for the cwd repo (its `work/` lifecycle from the working tree), in addition to (never merged into) the registry view.
- [ ] The cwd repo's arbiter is FETCHED before the local section is computed; on a fetch failure the command WARNS and falls back to last-known without erroring (reusing `scan-status-fetch-first`'s pattern).
- [ ] The local section LABELS its source/freshness and shows divergence vs the fetched `<arbiter>/main` (N commits ahead/behind), using the `main-divergence-guard` framing.
- [ ] When the cwd participates but is NOT registered, the empty-state guides self-registration (`remote add . --local`) instead of the bare "No participating repos found" dead-end.
- [ ] When the cwd repo is ALSO registered, it is de-duplicated (shown once in the local section, marked "(also registered)"; not a second mystery row).
- [ ] The registry model is UNCHANGED: no merged grand total; the daemon/CAS still claim against the registry; the mirror-ref read strategy is untouched.
- [ ] Run OUTSIDE any participating repo, behaviour is unchanged (only the registry view, with its existing empty-state).
- [ ] Tests (throwaway repo + local `--bare` arbiter): a participating cwd shows the local section; an unregistered cwd shows the registration hint; a cwd ahead of its arbiter shows the divergence line; a fetch failure warns + falls back; a cwd that is also registered is de-duped; outside a repo is unchanged.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — established the registry (hub-mirror) read that this local section sits BESIDE; the de-dup needs the registry list to compare against.
- `scan-status-fetch-first` — this slice REUSES its fetch+warn+fallback pattern (and the retired offline-scan invariant) and extends it to the cwd repo's arbiter; that pattern must exist first (also serialises the `scan.ts`/`status.ts` edits after it).

## Prompt

> Make `scan` and `status`, when run INSIDE a participating repo, ALSO report that CURRENT repo as a clearly-labelled, separately-counted LOCAL section (in addition to the cross-repo REGISTRY view), fetch-its-own-arbiter-first, and replace the dead-end "No participating repos found" with a self-registration hint. This fixes the live signal: running `scan`/`status` inside a participating-but-unregistered repo currently says it sees nothing.
>
> THE CONSISTENCY RULE (do not violate): keep the local section and the registry section VISUALLY + SEMANTICALLY DISTINCT, each with its OWN count — NEVER a merged grand total. The registry read is the arbiter's integrated state (bare mirror `main`, fetched); the cwd read is the LOCAL WORKING TREE (possibly unpushed/ diverged). Label each section's source + freshness; show the cwd's divergence-vs-arbiter using `main-divergence-guard`'s framing; de-dup the cwd repo if it is also registered (show once, marked "(also registered)").
>
> FETCH-FIRST ALSO FOR THE CWD: fetch the cwd repo's arbiter (the `arbiterStatus`/arbiter-detection `status` already uses) BEFORE computing its local section, reusing `scan-status-fetch-first`'s fetch+warn+fallback (never error out).
>
> THE REGISTRY MODEL IS UNCHANGED: `scan`/`status` are read-only DISPLAY; the daemon (`run`) + the arbiter CAS still claim against the REGISTRY only. Do NOT change the mirror-ref read strategy or what `run` operates on.
>
> FIRST run the drift check: confirm `registry-remote` (done) made `scan`/`status` read the registry; confirm `scan-status-fetch-first` landed the fetch+warn+fallback pattern + the retired offline invariant; confirm `scanRepoPaths()` (the working-tree reader) + `isParticipatingRepo` (`detect.ts`) + the current arbiter section in `status.ts` exist. Route to needs-attention on a discrepancy.
>
> READ FIRST: `src/scan.ts` (BOTH `scan()` registry + `scanRepoPaths()` working-tree readers — reuse the latter for the cwd), `src/status.ts` (the existing `arbiter` section + `mirrorPaths` registry read), `src/detect.ts` (`isParticipatingRepo`), `src/format.ts` (where "No participating repos found" is rendered — the message to replace), `src/arbiter.ts` (`arbiterStatus`/detection for the cwd arbiter fetch), `work/backlog/scan-status-fetch-first.md` + `work/backlog/main-divergence-guard.md` (the fetch + divergence framings to reuse), ADR `command-surface-and-journeys` §5/§6.
>
> TDD with vitest, house style (throwaway repo + local `--bare` arbiter): a participating cwd shows the local section; an unregistered cwd shows the registration hint; a cwd ahead of its arbiter shows the divergence line; a fetch failure warns + falls back; a cwd also-registered is de-duped; outside a repo is unchanged. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim scan-status-read-cwd-repo --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/scan-status-read-cwd-repo <remote>/main
git mv work/in-progress/scan-status-read-cwd-repo.md work/done/scan-status-read-cwd-repo.md
```

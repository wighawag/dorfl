---
type: observation
status: spotted
spotted: 2026-07-12
needsAnswers: false
---

## What was seen

`pnpm -r test` on `origin/main` (2026-07-12) fails ONE test, INDEPENDENT of any local change (reproduced with all local work stashed):

```
FAIL test/prd-word-cutover-leak-scan.test.ts > NO standalone artifact-word prd/PRD/Prd and NO work/prds/ path outside the PRESERVE allow-list
WORD leak-scan: the artifact word 'prd'/'PRD' ... leaked OUTSIDE the concrete PRESERVE allow-list ...
  work/questions/observation-erase-prd-word-cutover-decisions-2026-07-10.md:1: 'prd' ...
  ... (32 sidecar files)
```

So `main` is RED on its own acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Root cause

The offending files are all `work/questions/observation-*.md` SIDECARS committed by `dorfl[bot]` (`advance: surface observation:... (N question(s), by dorfl[bot])`). The advance-lifecycle loop, running on the CI arbiter, surfaced triage questions for the `prd→spec` cutover observations. The surface-questions agent's emitted question + `note` QUOTE each observation's body VERBATIM, and those bodies legitimately contain the retired artifact word `prd`/`PRD` (they are the cutover's own decision/rationale notes). The leak scan (`prd-word-cutover-leak-scan.test.ts`) gates the word tree-wide over `work/**`, so every bot-generated sidecar that quotes a `prd`-word observation TRIPS it.

## Why it matters (a real design tension, and a `main`-is-red incident)

Two problems compound:

1. **`main` is red on `verify`.** The autonomous loop WRITES to `main` (tree-less surface sidecars go straight to `main`), and one of those writes broke the tree-wide leak-scan gate. Any PR now fails the required `verify` check through no fault of its own, and the loop itself will keep failing this gate every time it surfaces one of these observations.

2. **The leak-scan scope vs. bot-generated content.** The scan gates `work/**` including `work/questions/` sidecars. But a sidecar is DERIVED content: it quotes the observation body it surfaces. An observation about the `prd→spec` cutover MUST mention `prd` (that IS its subject). So the gate is structurally at odds with the loop surfacing questions about cutover observations. The scan's PRESERVE allow-list did not anticipate bot-generated sidecars quoting legacy-word bodies.

## Options to weigh (NOT decided here)

1. **Exempt `work/questions/` (sidecars) from the WORD leak scan.** Sidecars are machine-generated, derived, transient (deleted on apply); they are not the prose surface the cutover is policing. Narrowest fix; matches the scan's intent (it targets authored prose/paths, not derived question text quoting a source).
2. **Exempt `work/notes/observations/` bodies too** (or at least their quoted echoes): an observation legitimately names its subject, and the cutover's OWN decision notes must say `prd` to describe what was renamed. The scan already exempts some data territory; this is arguably the same class.
3. **Settle/triage the `prd→spec` cutover observations** so the loop stops surfacing sidecars for them (drains the source). Addresses the symptom for THIS batch but not the general tension (a future legacy-word observation re-triggers it).
4. **Resolve the 32 already-landed sidecars** (answer/apply them) so they leave `work/questions/`. Immediate un-break, but they will regenerate until the underlying observations are triaged (option 3) or the scan is scoped (options 1/2).

Likely durable shape: option 1 (exempt derived sidecars) + option 3/4 (drain the cutover observations). Option 1 is the principled scan-scope fix; the scan should police AUTHORED prose, not machine-derived question text that quotes a source.

## Provenance / refs

- `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` (the tree-wide `work/**` WORD gate + its PRESERVE allow-list).
- The 32 offending `work/questions/observation-*.md` sidecars (all `by dorfl[bot]` surface commits; e.g. `d2c0d6ee advance: surface observation:installed-close-job-workflow-yml-stale-prd-prose-2026-07-10`).
- Reproduced on clean `origin/main` (local work stashed): 1 failed / 3 passed in that file.

## Note on scope

Discovered while building the triage-always-asks redesign (unrelated). This is a PRE-EXISTING `main`-is-red incident + a leak-scan-scope design question, captured for a human. NOT fixed inline (it is orthogonal to the triage change, and the scan-scope choice is a judgement call).

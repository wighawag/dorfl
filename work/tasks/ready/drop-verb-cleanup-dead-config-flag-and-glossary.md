## Context

Gate-2 review of `direct-delete-question-cli-helper` (approved, ac36f4b) surfaced two non-blocking nits that were triaged by the human as address-now (the third nit — ratifying four in-scope self-made decisions — was ratified as-is and needs no code change):

1. **Dead CLI surface on `drop`.** The `drop` command declares `-c, --config <path>` (and `DropFlags.config`) but its `.action(...)` body never reads `flags.config` — only `flags.cwd` and `flags.reason` are used. The verb is a pure working-tree primitive (resolves by identity, `git rm`s, never loads config), so the flag is dead surface that misleads a user into thinking config influences a drop.
2. **Coherence — `drop` vs `dropped`.** The new verb is named `drop` (direct delete: `git rm`, reason in the commit message, no resting state), but `dropped` already has a load-bearing DIFFERENT meaning: `specs/dropped/` is the PRD won't-proceed TERMINAL that RETAINS the file with the reason in the body (WORK-CONTRACT.md:44/63/67), and `dropped` is also a triage disposition value in SURFACE-PROTOCOL.md:47/58. No live collision today (the commit subject reads `drop: <item> → deleted`, which says 'deleted' not 'dropped'), but the shared English word now carries two meanings across the surface. A CONTEXT.md glossary line is cheap insurance against a future author conflating them.

## Scope (do exactly this)

1. In `packages/dorfl/src/cli.ts`:
   - Remove the `config?: string` field from `interface DropFlags` (~line 794).
   - Remove the `.option('-c, --config <path>', …)` line from the `drop` command definition (~line 3403).
   - Leave `cwd` and `reason` untouched — they ARE read by the action body (3409–3438).
   - Do NOT wire config in; the verb is intentionally a pure working-tree primitive that resolves paths by identity and `git rm`s. Ratified.
2. In `CONTEXT.md`, add a one-line glossary entry (in whatever glossary/terminology section exists, or a new short one if none) pinning:
   - **`drop`** — the direct-delete CLI verb (`dorfl drop <slug>`): `git rm`s the source file(s), reason rides in the commit message, git history is the archive. No resting state.
   - **`dropped`** — the PRD won't-proceed TERMINAL (`specs/dropped/`, per WORK-CONTRACT.md) and the triage disposition value (per SURFACE-PROTOCOL.md): the file is RETAINED with the reason in the body.
   Keep it tight (two bullets or one sentence each); the point is to make the distinction searchable, not to re-explain either mechanism.

## Out of scope

- Nit 2 (ratification of the four in-scope self-made decisions from the parent task — verb name `drop`, `--reason` optional with `(no reason given)` fallback, unresolved source is a clean exit-0 no-op leaving orphans to gc, local working-tree commit only) is RATIFIED by the human as-is. No code or doc change needed for that; the decisions already live in `drop-source.ts` docstrings and the `cli.ts` comment.
- Do not rename the `drop` verb. Do not change commit-subject format. Do not touch the arbiter/push behaviour.

## Acceptance

- `rg -n "config" packages/dorfl/src/cli.ts` shows no remaining `config` references tied to the `drop` command (DropFlags or the `.option` line).
- `dorfl drop --help` no longer lists `-c, --config`.
- `CONTEXT.md` contains the two-term glossary entry distinguishing the verb `drop` from the terminal/disposition `dropped`, with pointers to WORK-CONTRACT.md and SURFACE-PROTOCOL.md.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Provenance

Minted from observation `observation:review-nits-direct-delete-question-cli-helper-2026-06-25` (Gate-2 non-blocking nits on approved parent task `direct-delete-question-cli-helper`, commit ac36f4b). Human answers on that observation: address nit 1 + nit 3 here (fold together), ratify nit 2, then the source observation can be deleted.

## Prompt

> Build the task 'drop-verb-cleanup-dead-config-flag-and-glossary', described above.

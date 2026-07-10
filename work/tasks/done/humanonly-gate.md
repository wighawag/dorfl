---
title: humanOnly gate — replace the afk field + allowUnspecifiedGate with humanOnly + allowAgents
slug: humanonly-gate
spec: dorfl
blockedBy: [scan, scan-human-dashboard, per-repo-config]
covers: [9]
---

> Note: this slice's own frontmatter still uses `afk: false` because it is authored under the CURRENT contract; part of this slice's job is to migrate the contract + all slices to the new field. See `docs/adr/methodology-and-skills.md` §4 (the authoritative design).

## What to build

Replace the autonomy gate model. OLD: a three-state slice field `afk: true|false|omitted` + a runner policy `allowUnspecifiedGate`. NEW (ADR §4):

- **Slice field `humanOnly: true`** (or undefined) — declares the slice human-only (never auto-claim); most slices omit it. Authoritative, binary.
- **Repo policy `allowAgents`** — may agents claim _undeclared_ slices? Resolves like `integration`: CLI flag (`--allow-agents`/`--no-allow-agents`) > per-repo config > global > default `false`.
- **Agent-claimable iff** `humanOnly` !== true AND `allowAgents` is true; `humanOnly: true` is never claimable regardless.

End-to-end:

- **Contract:** update `skills/to-slices/WORK-CONTRACT.md` + `slice-template.md` (the `afk` section → `humanOnly`), and the `to-slices`/`to-spec` skills' gate wording, so the field name + semantics are consistent.
- **Config:** rename `allowUnspecifiedGate` → `allowAgents` (default `false`), wired through the same precedence as `integration` (flag > per-repo > global > default). CLI flag `--allow-unspecified-gate` → `--allow-agents` (+ `--no-allow-agents`).
- **Code:** update `scan` + eligibility resolution and the `scan-human-dashboard` grouping/labels to the new model (groups become e.g. "Agent-claimable now" / "Human-only" / "Blocked"), and any `run-once` references.
- **Migrate existing slices:** translate current frontmatter — `afk: false` → `humanOnly: true`; `afk: true` / omitted → drop the field (undeclared). Update this repo's slices accordingly.
- Keep behaviour equivalent where it maps; the dashboard still surfaces who-can- take-each-item, now in the new vocabulary.

## Acceptance criteria

- [ ] Slices use `humanOnly: true` | undefined; the old `afk` field is gone from the contract, templates, skills, and this repo's slices.
- [ ] `allowAgents` (per-repo, default false) replaces `allowUnspecifiedGate`, resolving flag > per-repo > global > default; CLI `--allow-agents` / `--no-allow-agents`.
- [ ] Eligibility: agent-claimable iff `humanOnly` !== true AND `allowAgents`; `humanOnly: true` never claimable. Unit-tested across the matrix.
- [ ] `scan` + the human dashboard render the new model correctly.
- [ ] Existing slices migrated (afk:false → humanOnly:true; afk:true/omitted → undeclared); `scan` still parses all of them.
- [ ] Full gate green (`pnpm -r build && pnpm -r test && pnpm -r format:check`).

## Blocked by

- `scan`, `scan-human-dashboard` — this changes their eligibility model + output.
- `per-repo-config` — `allowAgents` is a per-repo setting resolved via that layer.

## Prompt

> Implement the autonomy-gate rename in `packages/dorfl/` and the contract. READ FIRST: `docs/adr/methodology-and-skills.md` §4 (authoritative), the existing `afk`/`allowUnspecifiedGate` handling in `config.ts`/`scan`/eligibility/ `scan-human-dashboard`, and `skills/to-slices/WORK-CONTRACT.md`. Follow `AGENTS.md`.
>
> Replace the three-state `afk` slice field with binary **`humanOnly: true` | undefined** (authoritative; most slices omit it). Replace runner policy `allowUnspecifiedGate` with per-repo **`allowAgents`** (default false), resolved exactly like `integration`: CLI flag `--allow-agents`/`--no-allow-agents` > per-repo config > global > default. Eligibility: agent-claimable iff `humanOnly` !== true AND `allowAgents`; `humanOnly: true` never claimable. Update the contract + slice-template + the `to-slices`/`to-spec` gate wording; update `scan`, eligibility, and the `scan-human-dashboard` grouping/labels; migrate this repo's existing slices (afk:false → humanOnly:true; afk:true/omitted → drop the field).
>
> TDD with vitest: the full claimable matrix (humanOnly × allowAgents × deps), the precedence chain, dashboard rendering, and that all migrated slices still parse. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

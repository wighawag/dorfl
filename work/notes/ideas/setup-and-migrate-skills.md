---
title: setup + migrate skills (adopt-the-contract); doctor is a SEPARATE, uncertain idea
slug: setup-and-migrate-skills
type: idea
status: incubating
---

# Adopting the contract: `setup` + `migrate` skills (and the separate, uncertain `doctor`)

> Captured from the command-surface design pass (2026-06-05). These are **protocol-layer (adopt-the-contract) capabilities → SKILLS**, per `docs/adr/command-surface-and-journeys.md` §8 (adopt = skill, execute = command). Not built in that pass; recorded for later PRDs.

## `setup` — a SKILL (runner-agnostic)

Bootstrap a repo onto the `work/` contract: scaffold `CONTEXT.md` (with the correct project name, from the brand identity), the `work/` folder skeleton, a default `.dorfl.json`, and pointers to the contract docs + required skills.

> **NOTE — scaffold a stack-appropriate `verify` (added 2026-06-07).** The `.dorfl.json` `setup` writes MUST include an explicit `verify` gate that matches the repo's actual stack — do NOT leave it unset and rely on the built-in fallback. The fallback (`DEFAULT_VERIFY_COMMAND` in `verify.ts`) is `pnpm -r build && pnpm -r test && pnpm -r format:check`, which is **Node/pnpm- specific** and silently wrong for a Rust/Go/Python/etc. repo. `verify` is the protocol's per-project, language-agnostic acceptance gate (ADR §8), so the right fix is to detect the stack at setup time and write a matching command (e.g. `cargo build && cargo test && cargo fmt --check`), rather than changing the hardcoded default. (Spotted while designing the run/do integrate-path convergence: `run.ts`'s old `defaultTestGate` ALSO hardcoded `pnpm -r test` and ignored `config.verify` entirely — a protocol violation the convergence deletes; this note keeps the SAME class of pnpm-assumption from re-entering via a setup-scaffolded config.)

- **Why a skill, not a command:** adoption must NOT require `dorfl` to be installed — the contract is a runner-agnostic protocol (ADR §9). A skill keeps setup in the protocol layer (any human/agent/harness can follow it).
- It is needed for onboarding generally, and specifically for the Matt Pocock skills (which expect `CONTEXT.md` / `docs/agents/*` shape).
- An OPTIONAL thin `dorfl` convenience command could later automate the mechanical bits (mkdir + template the name) — but the skill stays authoritative and the command must never be REQUIRED (mirrors `claim.sh` vs `dorfl claim`, ADR §9). Decide that command only if hand-following proves annoying.

## `migrate` — a SKILL (convert from other systems)

Convert work from another system into the `work/` contract. Three parts, kept honestly distinct:

- **(a) Convert tasks** (e.g. `dev/github/jolly-roger-eth/ethereum-indexer/`'s `tasks/` folder) into `work/` slices/PRDs — judgement-heavy mapping (their format → slices/PRDs, set the two gate axes). The core value.
- **(b) Bootstrap `CONTEXT.md`** — do NOT reimplement; **call the `setup` skill**.
- **(c) Generate understanding from the code** — IMPORTANT CAVEAT: produce **`work/findings/` (or a `docs/` overview), NOT `docs/adr/`.** An ADR records a DECISION + its _why_ (rejected options, constraints) — usually NOT recoverable from code. Reverse-engineering code yields _description/ground-truth_ = a **finding**, not a decision. So migrate may write findings + **flag candidate decisions for a human to promote to ADRs**, but must **never auto-author ADRs** (that pollutes the one thing ADRs are precious for). This is the maintainer's explicit position.

## `doctor` — a SEPARATE, UNCERTAIN idea (do NOT bundle with the above)

A possible command to CHECK a repo's adoption (deterministic, repeated, no model): `work/` folders present, `CONTEXT.md` + name, valid `.dorfl.json`, a registered arbiter, a runnable `verify` gate. Possibly `doctor --fix` to scaffold missing mechanical bits (which would absorb the "setup convenience command").

**Status: NOT decided — we may not need it.** It was invented to justify a setup command, and `setup`-as-skill removed that need. So:

- **Interim (no `doctor`):** clear DOCS listing the skills a repo needs \u2014 **required:** `to-spec`, `to-slices`, `setup`; **recommended:** `migrate`, Matt Pocock's `grill-me`, etc. If that proves insufficient, THEN consider `doctor`.
- **If built, the boundary (from the ADR §8 corollary):** `doctor` core stays **harness-agnostic** (the contract surface only). **Skill location/discoverability is harness-specific** (pi reads `~/.agents/skills/`; other harnesses read elsewhere) → it MUST be delegated to the harness adapter via the §5 harness seam, never hardcoded. The harness seam is the boundary for ALL harness-specific knowledge, not just agent invocation.

## Disposition

Each becomes its own SPEC when prioritised (`setup` skill; `migrate` skill; `doctor` only if the interim docs prove insufficient). Keep them separate \u2014 they are not part of the command-surface reconciliation.

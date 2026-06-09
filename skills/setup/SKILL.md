---
name: setup
description: "Bootstrap a repo onto the file-based work/ contract (the protocol agent-runner consumes) — scaffold CONTEXT.md, the work/ folder skeleton, and a stack-appropriate .agent-runner.json — working IDENTICALLY on an empty repo or an existing one with code/docs (it detects and never clobbers). Optionally opens a short adoption conversation: ask what the repo is about (the user may say nothing), seed CONTEXT.md, and grill to refine. Use when the user wants to set up / adopt / onboard a repo to the work/ contract or agent-runner, says 'set up this repo', 'adopt the protocol', 'scaffold work/', or starts using slices/PRDs in a repo that has none. For CONVERTING existing docs/tasks/code into PRDs/slices/findings, this hands off to the separate migrate skill (judgement-heavy)."
---

# setup

Bootstrap a repo onto the **`work/` contract** — the runner-agnostic, file-based
protocol (defined in `protocol/WORK-CONTRACT.md`, which setup OWNS and copies into each
target repo's `work/protocol/`) that `agent-runner` consumes. This is the **adopt-the-contract** step (a SKILL, not a command, per
`docs/adr/command-surface-and-journeys.md` §8 — adoption must NOT require installing
`agent-runner`; the contract is the protocol, the runner is one consumer).

`setup` is the **deterministic, mostly-template core**. It works the SAME on an
empty repo and an existing one (it detects + never clobbers). It does NOT interpret
or convert existing content — that judgement-heavy work is the separate **`migrate`**
skill, which composes this one. Keep the boundary: `setup` scaffolds; `migrate`
converts.

## What it scaffolds

1. **`work/` skeleton** — the folders the contract uses (create only missing ones):
   `work/prd/ work/slicing/ work/prd-sliced/ work/backlog/ work/in-progress/
   work/needs-attention/ work/done/ work/out-of-scope/ work/ideas/
   work/observations/ work/findings/`. Add a `.gitkeep` to each empty one so git
   tracks it. (Status = the folder an item lives in — never a field.)
2. **`work/protocol/`** — the protocol reference docs, **copied VERBATIM** into the
   target repo so every skill can read them at a stable, repo-local path (rather than
   relying on sibling-skill folder reads, which do not exist in a foreign repo). Copy
   from this skill's own `protocol/` directory (setup OWNS the canonical copies):
   `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `slice-template.md`, `prd-template.md`,
   `ADR-FORMAT.md`. Also write `work/protocol/VERSION` stamping the protocol version
   the repo was set up against (so staleness is detectable; re-running `setup`
   re-syncs `work/protocol/`, never touching the repo's own `work/` items). All skills
   read the contract from `work/protocol/<doc>`; agent-runner itself is just a repo
   that ran `setup` on itself (it dogfoods its own `work/protocol/`).
3. **`CONTEXT.md`** — the repo's domain glossary (the shared vocabulary agents/skills
   use). Seed it from the adoption conversation (below). See the template at the end.
4. **`.agent-runner.json`** — per-repo config with a **stack-appropriate `verify`**
   gate (the critical field — see the stack-detection step) and conservative,
   strict-by-default autonomy. See the template at the end.
4. **A pointer** to the contract docs + required skills (in `CONTEXT.md`'s footer):
   required `to-prd`, `to-slices`, `setup`; recommended `migrate`, `review`,
   `grill-me`.

## Procedure

### 1. Detect the repo state (works empty OR existing — NEVER clobber)

`ls`/glob the repo first. For EACH artifact `setup` would write, if it ALREADY
exists, do NOT overwrite — report it and leave it (or, for `.agent-runner.json` /
`CONTEXT.md`, offer to MERGE-in only the missing keys/sections). Only CREATE what is
missing. This is what makes `setup` safe to run on a populated repo and idempotent to
re-run.

- If `work/` already has the folders → skip them.
- **`work/protocol/` is the ONE exception to never-clobber — it is protocol-owned, not
  repo-owned.** The repo's `work/` *items* (slices/PRDs/notes) are sacred and never
  touched; but the `work/protocol/` reference docs are verbatim copies setup owns, so
  re-running setup **re-syncs** them (overwrite with the current canonical copies +
  bump `work/protocol/VERSION`). This is how a repo picks up protocol updates. Never
  hand-edit `work/protocol/<doc>` in a target repo — edits belong in setup's canonical
  `protocol/` source and propagate via re-sync.
- If `CONTEXT.md` exists → do not overwrite; offer to APPEND a "domain terms" section
  if absent, else leave it.
- If `.agent-runner.json` exists → do not overwrite; report its `verify`/`harness`
  and offer to fill only ABSENT keys.
- Note (do NOT act on) existing material that `migrate` would convert: a `tasks/`
  folder, `docs/` design notes, READMEs, an issue tracker export, substantial source.
  List them and, at the end, recommend running **`migrate`** for them. `setup` itself
  converts NOTHING.

### 2. The adoption conversation (optional — the user may say nothing)

**If a caller (e.g. `migrate`) handed you a proposed description** of the repo, do
NOT cold-open — instead CONFIRM it: **"Here is what I think this repo is: <proposed
description>. Correct/refine, or accept?"** The human still ratifies; you just spare
them a blank prompt (the caller already read the repo). Otherwise, ask in ONE batched
prompt: **"What is this repo about? (one or two sentences — or skip and I'll scaffold
a stub you fill in later.)"**

- **If the user describes it (or accepts/refines the proposed seed):** put their description into `CONTEXT.md`'s
  "What <repo> is" section, then ask 1–3 **refining** questions to sharpen the
  domain language that will seed the glossary — e.g. *"What are the core domain
  nouns (the things the system reasons about)?"*, *"Who/what are the actors?"*,
  *"What does it integrate with?"*. Fold the answers into `CONTEXT.md`'s glossary as
  starter terms. Keep it light — this is a seed, not a full grilling (point them at
  the `grill-me` / `grill-with-docs` skill if they want to go deep).
- **If the user says nothing / "skip":** scaffold `CONTEXT.md` with a clearly-marked
  `<!-- TODO: describe the project -->` stub and a couple of placeholder glossary
  entries. Do not block on it; the repo is still fully set up.
- Either way, derive the **project name** from the repo (folder/remote name) for the
  CONTEXT title and any name references.

### 3. Discover the real `verify` gate FROM THE REPO (detect, never assume)

The `.agent-runner.json` `verify` gate is the protocol's per-project, **language-
agnostic** acceptance gate (build + test + format/lint, all green). The single rule:
**discover the gate from THIS repo; never write a canned, stack-shaped guess.** The
built-in fallback happens to be Node-shaped, which is SILENTLY WRONG for any other
stack — so do not rely on it, and equally do not swing the other way and template a
language's "usual" command blind. The protocol names no toolchain; neither should the
gate you write. Find what THIS repo actually uses, in this order of reliability:

1. **CI is the most reliable source — read it first.** Look at
   `.github/workflows/*.yml` (or other CI config): the build/test/lint/fmt steps it
   runs ARE the project's real acceptance commands. (E.g. a workflow whose steps are
   `cargo build` then `cargo test` tells you the gate directly — even if the repo
   also has a `package.json`.)
2. **Then the project's own task runner / declared scripts.** Read the actual
   commands, do not assume their shape: a `package.json` `scripts` block (use the
   REAL `build`/`test`/`format:check` scripts as written — they may wrap a monorepo
   tool or an env loader, so a blind per-package flag would BYPASS them), a
   `Makefile`/`justfile`/`Taskfile`, `pyproject.toml` `[tool.*]` / tox, a
   `composer.json`, etc.
3. **Only then infer from the manifest — as a HINT to confirm, not an answer to
   write.** A manifest tells you the ecosystem; it does not tell you the gate.
   `Cargo.toml` ⇒ likely `cargo build && cargo test && cargo fmt --check`; `go.mod` ⇒
   `go build ./... && go test ./... && gofmt -l .`; a Node manifest ⇒ read its
   scripts (do NOT assume a workspace/recursive flag). Treat these as starting
   guesses to verify against (1)/(2), never as the final command.

**Multiple manifests is normal — pick the gate, not the first file that matched.**
Many repos carry several manifests (e.g. a Rust crate that ships an npm install-
wrapper `package.json` with no build/test scripts; a Solidity repo with `foundry.toml`
+ a Node manifest + nested crates). Do NOT key off "a manifest exists"; identify the
PRIMARY build/test toolchain (CI usually settles it) and, for a genuinely mixed repo,
compose the gate (e.g. `forge build && forge test && cargo test && …`). A wrapper
manifest with no real scripts is a decoy — ignore it.

**A caller (e.g. `migrate`) may hand you a pre-detected gate** (it has already read
the code/CI). If so, treat it as the step-1/2 result and just CONFIRM it; do not
re-derive from scratch.

If you cannot determine it, **leave `verify` with a `TODO` comment and ASK the user**
for the exact build/test/lint command — never invent one. Either way, **CONFIRM the
final command with the user (one line)** before writing it: a wrong `verify` gate is
the one scaffolding mistake that bites later.

### 4. Write the files (create-only) + report

Create the missing `work/` folders (+ `.gitkeep`); **copy the protocol docs verbatim
into `work/protocol/`** from this skill's `protocol/` directory (`WORK-CONTRACT.md`,
`CLAIM-PROTOCOL.md`, `slice-template.md`, `prd-template.md`, `ADR-FORMAT.md`) and write
`work/protocol/VERSION` — creating them if absent, RE-SYNCING (overwriting) them if
present (protocol-owned, per step 1); write `CONTEXT.md` and `.agent-runner.json` if
absent (or merge-in missing keys per step 1); and REPORT every path written/created,
re-synced, and every repo-owned file left untouched.

**Git etiquette:** do NOT stage/commit/push — leave the new/edited files in the
working tree for the user to inspect and commit (the `to-prd`/`to-slices` producer
convention). Report the exact paths.

### 5. Hand off

- Tell the user the repo is contract-ready and what to do next: write a PRD
  (`to-prd`), slice it (`to-slices`), or build with `agent-runner do` (if the runner
  is installed — note the `harness`/`verify` they just configured).
- If step 1 found existing material to convert (a `tasks/` folder, design docs,
  substantial source), recommend **`migrate`** explicitly (it composes this skill's
  output and does the judgement-heavy mapping → PRDs/slices/findings, never
  auto-authoring ADRs).

## Boundary (what setup does NOT do)

- It does NOT read/convert/interpret existing docs, tasks, or code into
  PRDs/slices/ADRs/findings — that is **`migrate`** (judgement-heavy, model-driven,
  and carries the "never auto-author ADRs" discipline). `setup` is deterministic
  scaffolding + a light seed conversation.
- It does NOT install or require `agent-runner` (the contract is runner-agnostic).
- It does NOT register an arbiter / configure CI (those are runner/CI concerns).

## Templates

### `CONTEXT.md`

```md
# CONTEXT — <project> domain language

The domain glossary for `<project>`. Agents and skills use THIS vocabulary when
naming modules, tests, and discussing the system. Architectural rationale lives in
`docs/adr/` (decisions); product framing lives in `work/prd/`.

## What <project> is

<the user's one-to-two-sentence description, or: <!-- TODO: describe the project --> >

## Core domain terms

- **<term>** — <meaning> (seeded from the adoption conversation; refine as you go).
- **work/ contract** — the on-disk system this repo uses, defined by the reference
  docs in **`work/protocol/`** (copied here by `setup`): `WORK-CONTRACT.md` (the
  contract), `CLAIM-PROTOCOL.md`, `slice-template.md`, `prd-template.md`,
  `ADR-FORMAT.md`. One markdown file per item, status = the folder it lives in (never
  a field). Capture buckets: `ideas/` (proposed), `observations/` (spotted,
  unverified, append-only), `findings/` (verified external/domain ground truth, each
  with a `source:`). ADRs (`docs/adr/`, format in `work/protocol/ADR-FORMAT.md`)
  record what WE decided and why.

## Skills this repo uses

- Required: `to-prd`, `to-slices`, `setup`.
- Recommended: `migrate` (convert existing material), `review`, `grill-me`.
```

### `.agent-runner.json`

```json
{
  "verify": "<stack-appropriate command from step 3>",
  "harness": "pi",
  "allowAgents": false,
  "autoSlice": false
}
```

> `verify` — the acceptance gate (set it correctly for the stack; do NOT leave it to
> the Node default). `harness` — the agent adapter (`pi`, or `null` + `agentCmd` for a
> shell agent); set it so `agent-runner do` is not a silent no-op. `allowAgents` /
> `autoSlice` — strict-by-default (off): agents auto-pick/auto-slice nothing until the
> repo opts in; an explicitly-named `do <slug>` / `do prd:<slug>` is unaffected.
> Add `defaultArbiter`, `integration`, `provider`, `model` only as the repo needs them.
```

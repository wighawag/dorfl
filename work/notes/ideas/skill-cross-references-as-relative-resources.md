---
title: 'skills that orchestrate or copy from sibling skills should reference them as relative resources (agentskills.io), not by bare name — observed gap in from-idea -> setup/to-spec resolution'
slug: skill-cross-references-as-relative-resources
type: idea
status: incubating
---

# Make inter-skill references resolvable as relative resources, not bare names

> Captured 2026-06-26 from a live from-idea session (scaffolding the `distilly` + `webveil`
> repos). An agent loaded the INSTALLED `from-idea` copy and could not resolve where its
> callees (`setup`, `to-spec`) live, so it stopped and asked the human instead of proceeding.
> The fix is NOT absolute user paths (those are non-portable and wrong per agentskills.io);
> it is to treat sibling/callee skills and their payloads as RELATIVE resources.

## What actually happened (accurate diagnosis)

The session needed to run `from-idea` (clarify -> `setup` -> `to-spec`). Two facts collided:

1. **`setup`'s resource bundling is already CORRECT.** The installed copy at
   `~/.agents/skills/setup/` DOES carry its `protocol/` payload, and `setup/SKILL.md`
   (~line 113) does say "from this skill's `protocol/` directory". So the
   copy-the-protocol-docs step is properly a bundled, relatively-referenced resource.
   This part is good and should be the model.

2. **`from-idea` references its callees by BARE NAME only.** It says it "calls setup" and
   "hands the conversation to to-spec" but never says WHERE those skills are relative to
   itself. When `from-idea` is loaded as an installed copy (standalone), "call setup" is a
   dangling reference: the agent has the orchestration instructions but no resolvable
   pointer to the orchestrated skills. There is no relative-resource link, and (correctly)
   no absolute path either — so the reference resolves to nothing, and the agent stalls.

So the gap is narrow and specific: **an orchestrator skill that invokes sibling skills must
make those siblings resolvable the same way `setup` makes its `protocol/` payload
resolvable — as a relative resource — rather than assuming they are ambiently available by
name.**

## Why bare-name references are the wrong default

- An installed skill may be the ONLY copy present. "Call setup" assumes setup is also
  installed AND discoverable by that name in the same runtime. When it is not, there is no
  breadcrumb back to the source.
- Absolute paths (`~/dev/github/wighawag/dorfl/skills/setup`) are NOT the fix: they are
  machine-specific, break on any other checkout/host, and violate the agentskills.io model
  where a skill is a self-contained bundle that references its own resources by path
  relative to `SKILL.md`.

## The principle (agentskills.io-aligned)

A skill bundles its resources and references them **relative to the skill directory**. Extend
that discipline to **inter-skill** references:

- A skill that **copies a payload** (setup -> `protocol/`) already does this right: bundle the
  payload inside the skill, reference it relative to `SKILL.md`. Keep as the exemplar.
- A skill that **invokes a sibling skill** (from-idea -> setup, from-idea -> to-spec) should
  reference that sibling as a resolvable resource too: a relative sibling path within the
  shared skills root (e.g. `../setup/SKILL.md`, `../to-spec/SKILL.md`), and/or a declared
  dependency the install tooling co-installs and exposes. Either way the reference is
  RESOLVABLE from the orchestrator alone, with no absolute paths and no "it's probably
  installed under this name" assumption.

## Concrete changes to consider (dorfl skill side)

1. **from-idea: name its callees as relative resources.** Where it says "invoke `setup`" /
   "hand to `to-spec`", add the relative sibling reference (`../setup/SKILL.md`,
   `../to-spec/SKILL.md`) so a standalone-loaded from-idea can locate them. No absolute paths.

2. **Co-install orchestrated skills as a dependency set.** If `from-idea` is installed, its
   required siblings (`setup`, `to-spec`) and their payloads should come with it (or be
   declared so the install tooling resolves them). An orchestrator without its callees is an
   incomplete bundle.

3. **Self-locating installed copies (lightweight).** Optionally, when a skill is installed,
   record the relative layout it expects (the sibling skills it calls) so a reader can verify
   the bundle is complete, without hardcoding any host path. This is the "is my bundle
   whole?" check, expressed relatively.

4. **Keep setup's `protocol/` pattern as the canonical example** in whatever skill-authoring
   guidance exists: payload bundled in-skill, referenced relative to `SKILL.md`, re-synced on
   re-run. Inter-skill references should mirror it.

## Boundary / non-goals

- Do NOT introduce absolute paths anywhere. The whole point is portability.
- Do NOT require installing `dorfl` to use the contract (setup is explicit: adoption must not
  require the runner). Relative-resource references keep the skills portable and runner-
  agnostic; they do not couple to dorfl.

## Status

Not built. Captured as an idea from a real resolution-failure during a from-idea run. The fix
is small (mostly wording + an install-time dependency-set guarantee), but it removes a whole
class of "I have the instructions but cannot resolve the materials/siblings" stalls.

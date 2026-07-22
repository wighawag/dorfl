---
title: no lint catches non-contract work/ shape (orphan top-level files, status:-frontmatter) — proposal for a work/-shape lint
date: 2026-07-22
kind: observation
tags: [work-contract, lint, ledger-lint, guardrail]
source: "read @ 1f37af5f: skills/setup/protocol/WORK-CONTRACT.md, packages/dorfl/src/{work-layout,ledger-lint}.ts, while an agent driving a downstream repo (werust) made the two violations below and a human caught them"
---

## What happened

An agent working a downstream repo's `work/` created a top-level `work/ROADMAP.md` (an orphan
NOT among the contract's five sanctioned surfaces) and put `status: proposed` frontmatter on
specs (violating "status = the FOLDER, never a frontmatter field"). Both are real contract
violations. Nothing in dorfl flagged either; a human caught them.

## Root cause: the rules EXIST but are unenforced

The `work/` contract states both rules \u2014 WORK-CONTRACT.md ~line 97 ("status = the folder,
never a frontmatter field") and ~line 11 (the five top-level surfaces enumerated: `notes/`,
`tasks/`, `specs/`, `questions/`, `protocol/`). And dorfl KNOWS the canonical legal set:
`packages/dorfl/src/work-layout.ts` `WORK_FOLDER_NAME` exhaustively defines every legal
folder. But the rules are buried in a long, dense contract, and dorfl has NO check that the
on-disk tree conforms:

- `ledger-lint.ts` exists but checks ONE invariant only: one-slug-one-folder (a slug present
  in >1 status folder). It does NOT check for unexpected top-level entries or bad frontmatter.
- So an orphan `work/ROADMAP.md`, a stray `work/foo/`, or `status:`/other non-contract
  frontmatter on a spec/task is INVISIBLE to `status`/`scan`/any validation.

The gap: dorfl has the canonical shape (`WORK_FOLDER_NAME`) AND a lint framework
(`ledger-lint` + its `status`/`scan`/`gc --ledger` surfacing) but never asserts "the `work/`
tree matches the contract's shape".

## Proposal: extend the ledger lint to a work/-SHAPE lint (warn, never auto-fix)

Same posture as the existing duplicate lint (WARN in `status`/`scan` + report in
`gc --ledger`; a human fixes; never auto-delete). Checks derived from `WORK_FOLDER_NAME` + the
frontmatter contract:

1. **Unexpected top-level `work/` entry.** List `work/`; flag any entry not among the
   sanctioned surfaces (`notes/`, `tasks/`, `specs/`, `questions/`, `protocol/`) \u2014 catches an
   orphan `ROADMAP.md`, a stray folder, a misplaced file. Keep the rule-8 carve-out for a
   `<slug>/` asset sidecar under `notes/`.
2. **Non-contract frontmatter on a work item.** For a spec/task `.md`, flag frontmatter keys
   not in the contract's allowed set (especially a `status:` key \u2014 the exact mistake \u2014 since
   status IS the folder). Warn, do not strip.
3. (Optional) **Body-vs-residence contradiction** \u2014 a body claiming a status its folder
   disagrees with.

Surface it in the existing `status`/`scan` ledger-warning block + `gc --ledger`, so an agent
or human sees e.g. "work/ shape: 1 unexpected top-level entry (ROADMAP.md); 5 specs carry a
non-contract `status:` field" \u2014 no new command to remember.

## Bonus: a cheaper complementary guardrail (contract prose)

Add a short, PROMINENT "what does NOT go in work/" DON'T-list near the top of the contract.
The rules are there but stated only POSITIVELY and buried; an agent skims for the tempting
anti-pattern. Blunt version: "Do NOT add top-level files to `work/` (only the five surfaces);
a cross-spec roadmap/ordering is `taskedAfter` on the specs + an ADR, NOT a `work/` file. Do
NOT put `status:` (or any lifecycle-status) in frontmatter \u2014 status is the folder."

## Why this matters

The whole `work/` design is conflict-safe BECAUSE the shape is constrained; an un-linted tree
lets that erode silently (orphan files that drift, frontmatter that shadows folder-status).
dorfl already enforces one-slug-one-folder on WRITE (integration-core) and lints it on READ; a
work/-shape lint is the same idea one level up. Low risk (warn-only), reuses the lint surface,
directly prevents the class of mistake seen here.

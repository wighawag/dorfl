---
title: review-skill — author skills/review/ (a standalone, protocol-native review discipline)
slug: review-skill
prd: review-skill
blockedBy: []
covers: [1, 2, 3, 4, 5, 6]
---

## What to build

The **`review` skill** (`skills/review/SKILL.md`) — a **standalone reviewing
discipline** that makes an agent's review of **protocol artifacts** (slices, PRDs,
code, observations / findings / ADRs) **more thorough and easier**. It stands on
its own: a human or agent can reach for it directly to review better; `batch-qa`
and the review GATES are just two callers, not its reason for being.

It is **protocol-NATIVE** (and may assume it): the skill is meant for a repo that
uses the `work/` contract, so it KNOWS the protocol's peculiarities and reviews an
artifact **against the contract and its design** — that assumption is what makes it
efficient here, not a generic review checklist. It is a METHODOLOGY skill (prose an
agent in any harness follows), like `skills/to-slices/` and `skills/to-prd/` — NOT
code, NO model seam, NO toggles/PR-machinery (those belong to the GATES, `review.md`).

End-to-end, this slice delivers `skills/review/SKILL.md` (standard `name` +
`description` frontmatter) whose BODY is the review discipline, optimised for an
agent to review thoroughly and easily:

- **When to use it** — reviewing a slice, a PRD, code against the slice that
  produced it, or a captured note (observation / finding / ADR) — i.e. any
  protocol artifact, before it lands / is claimed / is merged.
- **The four lenses as THINKING TOOLS, grounded in the protocol** — for EACH:
  what it catches, how to apply it, and a concrete tell. Ground them in the
  `work/` contract (cite WORK-CONTRACT.md / the ADRs as the standard reviewed
  against), e.g.:
  1. **claim-vs-reality** — does the artifact's claim match reality? (a slice's
     `## What to build` vs the code; a doc vs what landed in `done/`; drift =
     a `needs-attention`/`needsAnswers` signal, NOT something to paper over).
  2. **cleanup-vs-behaviour** — does code meet the slice's ACCEPTANCE CRITERIA
     (incl. the shared-write isolation rule: tests isolate global locations AND
     assert the real one untouched); no behaviour smuggled into a "cleanup".
  3. **cross-artifact composition** — contract conformance: status = folder (not a
     field), one-file-per-item, no shared index, content-derived slug, camelCase
     fields, `blockedBy` by slug, gate axes (`humanOnly`/`needsAnswers`) set
     HONESTLY, right bucket per polarity (observation vs finding vs ADR),
     file-orthogonality / `blockedBy` to avoid merge conflicts.
  4. **destination check** — "if built/sliced/merged exactly as written, do we
     reach the `prd:` / ADR goal?" (the protocol-native arbiter).
- **How thoroughness is achieved** — encourage the discipline that makes review
  catch real defects (e.g. the empirical case for multiple independent passes;
  flag-don't-guess; the asymmetry that a false "looks fine" ships wrong work).
  Pull this from `work/ideas/review-gate-default-for-autoslicing.md`; do not
  re-derive.
- **Your output, and how callers use it (a SHORT note, not the headline)** — the
  review EMITS a verdict and writes NOTHING; the CALLER routes it. Output per
  item: `{ verdict: approve | block, findings: [{ severity: blocking |
  non-blocking, question, context }] }`. Callers route: the GATES →
  `needsAnswers` / `needs-attention` / auto-merge; `batch-qa` → its batch file.
  This is what lets programmatic callers reuse the skill — but the skill's PURPOSE
  is thorough review, not being a data source. One short section is enough; point
  the gate machinery at `review.md`.

Mirror the structure/voice of `skills/to-slices/SKILL.md` and `skills/to-prd/`.

## Acceptance criteria

- [ ] `skills/review/SKILL.md` exists with valid `name` + `description` frontmatter,
      in the same shape as the other skills in `skills/`.
- [ ] It reads as a STANDALONE review discipline whose stated purpose is making an
      agent's review of protocol artifacts MORE THOROUGH and EASIER — not "a shared
      dependency for batch-qa/gates" (those are mentioned only as callers).
- [ ] It is PROTOCOL-NATIVE: it reviews artifacts AGAINST the `work/` contract +
      its design, citing the concrete standards (WORK-CONTRACT.md rules / ADRs) the
      lenses check — not a generic checklist.
- [ ] It covers the four lenses IN ORDER ending in the destination check, and for
      EACH gives what-it-catches + how-to-apply + a concrete tell, so an agent
      unfamiliar with the codebase could follow it to a more thorough review.
- [ ] It names what can be reviewed: slices, PRDs, code, observations/findings/ADRs.
- [ ] The emit-verdict / caller-routes contract appears as a SHORT note (output
      shape + who routes), NOT as the document's spine; gate machinery
      (role/toggles/model-override/PR-arbiter/auto-merge/trust-resolver) is fenced
      out with a pointer to `review.md`.
- [ ] It reads as a tool-agnostic methodology skill consistent with
      `to-slices`/`to-prd`.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (`review-skill` PRD has no `sliceAfter`; this is
  the prerequisite root both `review` gates and `batch-qa` depend on.)

## Prompt

> Author the `review` SKILL at `skills/review/SKILL.md` — a STANDALONE,
> PROTOCOL-NATIVE reviewing discipline whose purpose is to make an agent's review
> of protocol artifacts (slices, PRDs, code, observations/findings/ADRs) MORE
> THOROUGH and EASIER. It stands on its own (a human/agent reaches for it to review
> better); `batch-qa` and the review GATES are just callers. It is a METHODOLOGY
> skill (prose, like `skills/to-slices/` / `skills/to-prd/`) — NOT code, NO model
> seam, NO toggles/PR machinery (those are the GATES, `review.md`). It is meant for
> a repo that USES the `work/` contract, so it MAY assume the protocol's
> peculiarities and review an artifact AGAINST the contract + its design — that
> assumption is what makes it efficient, not a generic checklist.
>
> READ FIRST: `work/prd/review-skill.md` (purpose + the emit-vs-route output note),
> `skills/to-slices/WORK-CONTRACT.md` (the STANDARD the lenses review against:
> status=folder, one-file-per-item, no shared index, content slugs, camelCase, the
> two gate axes, bucket polarity observation/finding/ADR, the shared-write test
> isolation rule, drift=needs-attention), `work/ideas/review-gate-default-for-autoslicing.md`
> (the four-lens protocol + destination check + the empirical case for multiple
> passes — take it from here, do not re-derive), `work/prd/review.md` (the GATES —
> fence them OUT) and `work/prd/batch-qa.md` (the other caller). Mirror the voice +
> frontmatter of `skills/to-slices/SKILL.md` / `skills/to-prd/SKILL.md`.
>
> Write the skill BODY as the discipline: when-to-use; the four lenses as thinking
> tools, each grounded in concrete `work/`-contract standards with what-it-catches
> + a tell, ending in the destination check; how to be thorough (multiple passes,
> flag-don't-guess). Add ONE short section for the output (emit a verdict, write
> nothing, caller routes — `{verdict, findings[severity, question, context]}`) and
> a pointer fencing the gate machinery to `review.md`. "Done" = acceptance criteria
> met and the gate green. Per repo etiquette: do NOT stage/commit — leave the file
> for review and report the path.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim review-skill --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/review-skill <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/review-skill.md work/done/review-skill.md
```

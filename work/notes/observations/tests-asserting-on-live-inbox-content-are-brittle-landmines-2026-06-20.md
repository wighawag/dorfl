---
title: tests that assert on the LIVE work/notes/observations/ inbox content (counts / specific files) are brittle landmines that go red when the inbox is legitimately triaged
type: observation
status: spotted
spotted: 2026-06-20
slug: tests-asserting-on-live-inbox-content-are-brittle-landmines
needsAnswers: false
---

## What was seen

During an observation-triage session that drained the inbox (deleting ~60 discharged
notes incl. all 42 Gate-2 review-nits), the test
`packages/agent-runner/test/observation-identity-roundtrip.test.ts` went RED: its block
"the 17 migrated review-nits obs each round-trip" scanned the REAL repo's
`work/notes/observations/review-nits-*.md` files and hard-asserted
`files.length >= 17`. Once the review-nits were triaged out (the correct, intended
disposition — they are spent Gate-2 notes that discharge on the reviewed task's merge),
the count dropped to 0 and the assertion failed even though the INVARIANT it meant to
check (an observation's identity is its FILENAME, never a foreign frontmatter `slug:`)
still holds. Fixed by rewriting that block to SELF-SEED its fixtures in a throwaway tree
(commit on `main`, 2026-06-20).

## Why it matters (the general hazard)

`work/notes/observations/` is a CAPTURE BUCKET: by the work/ contract it is drained by
DELETION the moment a note stops being a live signal (the whole point of the
triage-observations loop). So its content is INHERENTLY MUTABLE and SHRINKS over time.
A test that asserts on the live inbox's content (a count, or the presence of specific
files) is therefore asserting on a value the protocol is DESIGNED to change — it is a
landmine that a routine, correct triage pass will trip, turning a green acceptance gate
red for no real defect. It also creates a perverse coupling: it discourages draining the
inbox (the desired end state) because doing so breaks the build.

## Suggested disposition

- Audit the test suite for any OTHER assertion that reads the live `work/notes/` tree
  (observations, ideas, findings) and asserts on its count or specific files; convert
  each to SELF-SEED its own fixtures in a throwaway tree (the house pattern:
  `makeScratch` + `seedRepoWithArbiter`, or minting through the real path), so the test
  pins the INVARIANT, not a snapshot of mutable inbox content.
- Consider a lightweight guard/lint (sibling to `work-layout-guard`) that flags a test
  reading `resolve(__dirname, '..')`-style live-repo `work/notes/` scans, so a future
  brittle snapshot test is caught at review.

## Refs

- The fixed test: `packages/agent-runner/test/observation-identity-roundtrip.test.ts`
  (the "MANY minted review-nits obs each round-trip" block, now self-seeded).
- The contract that guarantees the inbox shrinks: `work/protocol/WORK-CONTRACT.md`
  ("Discharge by deletion" / capture buckets leave by deletion).
- The triage session that exposed it (the review-nits drain).

## Applied answers 2026-06-22

### q1: Disposition for this observation: promote to a slice that (a) audits the test suite for any other assertion reading the live work/notes/ tree and converts them to self-seeded fixtures, and (b) adds a lightweight guard/lint (sibling to work-layout-guard) flagging tests that scan live-repo work/notes/ paths — or keep as a spotted note, or drop?

promote-slice, scoped to part (a): audit the test suite for any other assertion that reads the LIVE `work/notes/` tree and convert those to self-seeded fixtures (in a throwaway tree). The original RED is already fixed on main (the identity-roundtrip test now self-seeds), and the audit scope is bounded (~10 candidate files). DEFER part (b) the lint/guard — it is the over-engineering risk; add it only if a second instance appears (the existing work-layout-guard is the precedent shape if we ever do). Disposition: promote-slice (audit only).

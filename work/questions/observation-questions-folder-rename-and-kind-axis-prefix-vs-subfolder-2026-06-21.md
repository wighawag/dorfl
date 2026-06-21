<!-- agent-runner-sidecar: item=observation:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 type=observation slug=questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 allAnswered=false -->

## Q1

**Disposition for this observation: promote to an ADR (folder structure + sidecar-keying is load-bearing, status=folder idiom), promote to a slice (mechanical rename + field/subfolder cutover), keep as an observation for now, or drop?**

> The note itself closes with "likely an ADR (folder structure is load-bearing here, status=folder). Do NOT guess the rename/restructure — surface it." It bundles a NAMING call (A: rename `questions/`) and a STRUCTURAL call (B: prefix vs subfolder vs typed field) whose answer depends on a design invariant (is question-kind 1:1 with item identity?). It also cross-links two sibling notes (merge-questions on unmerged branches; needs-attention with no human-visible outcome) that share the sidecar-keying axis and "should be decided together." An ADR can capture the invariant + the layout in one place; a slice would skip that record.

_Suggested default: promote-adr_

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):

## Q2

**Question A — Rename `work/questions/` to something broader (e.g. `inbox/`, `attention/`, `decisions/`, `pending/`), or keep the name `questions/`?**

> `work-layout.ts` already describes the folder as "the 'what needs me?' queue," and the generalization shows the four flows (merge / stuck / triage / spec) are mostly DECISIONS / a human-action inbox, not literally questions — a merge-question's honest content is "approve this land?", a stuck-question is "requeue/reset/drop?". Low structural risk: one folder `git mv` plus the `workFolderKey` / `sidecarPathFor` constant and CONTEXT/contract text. The note flags this as worth confirming because it is pure churn if the name is fine as-is.

_Suggested default: keep `questions/` for now (defer rename until B is decided, so any cutover happens once)_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Question B — How should question KIND (merge / stuck / triage / spec) be expressed: keep today's filename-PREFIX (`<type>-<slug>.md` flat), promote to a SUBFOLDER (`questions/<kind>/...`), or move to a TYPED FIELD in the sidecar's identity comment with per-kind queues rendered by the tool?**

> The note verifies sidecars are derived-path scratch files (`sidecarPathFor` is the SOLE path source, written in place and `rmSync`'d on resolution — no `git mv` of a sidecar anywhere), so the earlier git-mv-churn argument against subfolders does NOT apply. The REAL hazard is a SILENT-LOOKUP bug: subfolders are safe ONLY if the subfolder is a pure function of item identity. Today's `<type>` (slice/prd/observation) IS stable per identity; the generalized KIND (merge/stuck/triage/spec) is a DIFFERENT axis and may not be. Trade-offs: prefix = flat `ls` wall but identity-keyed and proven; subfolder = scannable per-kind queue matching the repo's status=folder idiom but risks silent misses if kind isn't 1:1 with identity; typed field = safest (path stays f(identity)), loses bare-`ls` per-kind view (need the tool). Note's revised lean: flat + typed field is the safer default unless the design pins "one open question-kind per item at a time" as an invariant.

_Suggested default: flat + typed `kind` field with per-kind views rendered by `status`/`scan` (preserves `sidecarPathFor` as a pure function of identity; matches how `disposition` already types triage answers)_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Sub-invariant gating B: is it a DESIGN INVARIANT that an item has at most ONE open question-kind at a time (so kind is 1:1 with identity), or can one item legitimately carry e.g. a SPEC question at build time and later a MERGE question at land time?**

> This is the decision rule the note extracts: "If kind is 1:1 with identity, subfolders are fine… If an item can have DIFFERENT kinds over time, either keep FLAT + a typed `kind` field, OR adopt `questions/<kind>/<type>-<slug>.md` AND thread the kind through EVERY `sidecarPathFor` call site (invasive; a wrong/stale kind = a silently-missed sidecar)." The concrete worked example is a `slice:foo` with a SPEC question at build time and a MERGE question later at land time — if both are possible (even non-overlapping in time), an identity-only lookup at `questions/spec/slice-foo.md` silently misses a file at `questions/merge/slice-foo.md`. Answering this collapses Question B.

_Suggested default: NOT an invariant — a slice can plausibly carry spec-then-merge over its life, so treat kinds as a separate axis from identity_

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

<!-- agent-runner-sidecar: item=observation:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 type=observation slug=questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 allAnswered=false -->

## Q1

**Disposition for this observation: promote to an ADR (folder structure + sidecar-keying is load-bearing, status=folder idiom), promote to a slice (mechanical rename + field/subfolder cutover), keep as an observation for now, or drop?**

> The note itself closes with "likely an ADR (folder structure is load-bearing here, status=folder). Do NOT guess the rename/restructure — surface it." It bundles a NAMING call (A: rename `questions/`) and a STRUCTURAL call (B: prefix vs subfolder vs typed field) whose answer depends on a design invariant (is question-kind 1:1 with item identity?). It also cross-links two sibling notes (merge-questions on unmerged branches; needs-attention with no human-visible outcome) that share the sidecar-keying axis and "should be decided together." An ADR can capture the invariant + the layout in one place; a slice would skip that record.

_Suggested default: promote-adr_

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):

promote-adr. Folder structure is load-bearing ("status IS the folder") and there is no prior folder-structure ADR, so the rename + the KIND layout + the gating invariant (Q4) + the merge-kind keying (the sibling sidecar-keying question) all belong recorded in ONE ADR, decided together with the merge-questions finding and the needs-attention observation. The ADR should ratify the Q2/Q3/Q4 decisions below. Disposition: promote-adr.

## Q2

**Question A — Rename `work/questions/` to something broader (e.g. `inbox/`, `attention/`, `decisions/`, `pending/`), or keep the name `questions/`?**

> `work-layout.ts` already describes the folder as "the 'what needs me?' queue," and the generalization shows the four flows (merge / stuck / triage / spec) are mostly DECISIONS / a human-action inbox, not literally questions — a merge-question's honest content is "approve this land?", a stuck-question is "requeue/reset/drop?". Low structural risk: one folder `git mv` plus the `workFolderKey` / `sidecarPathFor` constant and CONTEXT/contract text. The note flags this as worth confirming because it is pure churn if the name is fine as-is.

_Suggested default: keep `questions/` for now (defer rename until B is decided, so any cutover happens once)_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Rename `questions/` → `inbox/`. The four flows (merge / stuck / triage / spec) are a human-action inbox ("approve this land?", "requeue/reset/drop?", "disposition this", "answer this spec"), not literally questions, and `inbox/` reads as "what needs me?" — which is how `work-layout.ts` already glosses the folder. Churn is low (one value flip in the folder registry + a `git mv` + CONTEXT/contract text). Do the rename as part of the same ADR cutover as Q3 so naming + structure change once together.

IMPORTANT axis note for the ADR: the subfolders are the question KIND (merge / stuck / triage / spec), NOT the item TYPE (observation / task / brief). The item type already lives in the sidecar identity and the filename (`<type>-<slug>.md`); do not make item-type the folder level. So the layout is `inbox/<kind>/<type>-<slug>.md`, e.g. `inbox/triage/observation-foo.md`, `inbox/merges/slice-bar.md`.

## Q3

**Question B — How should question KIND (merge / stuck / triage / spec) be expressed: keep today's filename-PREFIX (`<type>-<slug>.md` flat), promote to a SUBFOLDER (`questions/<kind>/...`), or move to a TYPED FIELD in the sidecar's identity comment with per-kind queues rendered by the tool?**

> The note verifies sidecars are derived-path scratch files (`sidecarPathFor` is the SOLE path source, written in place and `rmSync`'d on resolution — no `git mv` of a sidecar anywhere), so the earlier git-mv-churn argument against subfolders does NOT apply. The REAL hazard is a SILENT-LOOKUP bug: subfolders are safe ONLY if the subfolder is a pure function of item identity. Today's `<type>` (slice/prd/observation) IS stable per identity; the generalized KIND (merge/stuck/triage/spec) is a DIFFERENT axis and may not be. Trade-offs: prefix = flat `ls` wall but identity-keyed and proven; subfolder = scannable per-kind queue matching the repo's status=folder idiom but risks silent misses if kind isn't 1:1 with identity; typed field = safest (path stays f(identity)), loses bare-`ls` per-kind view (need the tool). Note's revised lean: flat + typed field is the safer default unless the design pins "one open question-kind per item at a time" as an invariant.

_Suggested default: flat + typed `kind` field with per-kind views rendered by `status`/`scan` (preserves `sidecarPathFor` as a pure function of identity; matches how `disposition` already types triage answers)_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

SUBFOLDER per kind (`inbox/<kind>/<type>-<slug>.md`), made safe by the ENFORCED one-open-kind-per-item invariant (see Q4). This deliberately differs from the sidecar's "flat + typed field" default, BECAUSE Q4 is answered YES-and-enforced: once the tool guarantees an item has at most one open kind at a time, the kind subfolder IS a pure function of identity again, so the silent-lookup hazard the note worried about is removed and we get the scannable per-kind queue that matches the repo's status=folder idiom. The safety is NOT "assume the invariant" — it is "the tool enforces it" (see Q4). Thread the kind through `sidecarPathFor` as part of the cutover; because only one kind is ever open, the lookup is unambiguous.

## Q4

**Sub-invariant gating B: is it a DESIGN INVARIANT that an item has at most ONE open question-kind at a time (so kind is 1:1 with identity), or can one item legitimately carry e.g. a SPEC question at build time and later a MERGE question at land time?**

> This is the decision rule the note extracts: "If kind is 1:1 with identity, subfolders are fine… If an item can have DIFFERENT kinds over time, either keep FLAT + a typed `kind` field, OR adopt `questions/<kind>/<type>-<slug>.md` AND thread the kind through EVERY `sidecarPathFor` call site (invasive; a wrong/stale kind = a silently-missed sidecar)." The concrete worked example is a `slice:foo` with a SPEC question at build time and a MERGE question later at land time — if both are possible (even non-overlapping in time), an identity-only lookup at `questions/spec/slice-foo.md` silently misses a file at `questions/merge/slice-foo.md`. Answering this collapses Question B.

_Suggested default: NOT an invariant — a slice can plausibly carry spec-then-merge over its life, so treat kinds as a separate axis from identity_

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

YES — it IS a design invariant that an item has at most ONE open question-kind at a time — AND it must be ENFORCED by the tool, not merely assumed, precisely because a human can otherwise screw it up. Enforcement: opening a sidecar is a create that first checks no OTHER-kind open sidecar exists for the same identity, and refuses (rather than silently creating a second) if one does. This is what makes the Q3 subfolder layout safe: with the invariant enforced, kind is 1:1 with identity and `inbox/<kind>/<type>-<slug>.md` is a pure function of identity, so an identity lookup can never silently miss a second-kind file (there is never a second).

Note one honest residual for the ADR (shared with the sidecar-keying question): a MERGE-kind question can exist for an item whose `work/<slug>.md` body does not exist (an unmerged branch). So the `merges/` kind specifically may need the lock-ref / branch-identity keying that the needs-attention sidecar's Q2 is about — resolve that in the same ADR. The spec-then-merge-over-time worry the note raised is handled by the invariant being TEMPORAL (at most one open AT A TIME): a spec question is resolved/removed before a later merge question opens, so they never coexist.

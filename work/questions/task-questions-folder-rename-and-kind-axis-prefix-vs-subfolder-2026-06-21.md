<!-- dorfl-sidecar: item=task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 type=task slug=questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 allAnswered=false -->

## Q1

**Should `work/questions/` be RENAMED, and if so to what?**

> The observation notes `work-layout.ts` itself describes this surface as "the 'what needs me?' QUEUE," and after the merge/stuck/triage/spec generalization most entries are decisions / a human-action inbox, not literally questions. Candidates floated: `inbox/`, `attention/`, `decisions/`, `pending/`. Low structural risk: one folder `git mv` plus the `workFolderKey` / `sidecarPathFor` constant and CONTEXT/contract text. The note's own lean is that the code's self-description supports a rename, but the call is structural and explicitly flagged as 'surface it, do not guess.'

_Suggested default: Keep `work/questions/` for this slice; defer the rename to its own ADR. Renaming touches every doc/skill that mentions the surface, and the kind-axis decision (next Q) is the higher-value structural call; don't bundle a cosmetic rename into it._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Kind axis (merge / stuck / triage / spec): keep as filename PREFIX, promote to SUBFOLDER, or move to a TYPED FIELD in the sidecar identity comment?**

> Today the kind is the filename prefix `<type>-<slug>.md` (`brief-…`, `observation-…`, etc.) in a flat `work/questions/`. Round 2 of the observation DISMANTLES the flat-vs-subfolder safety argument: per `sidecar-apply.ts` / `surface-persist.ts` etc., `sidecarPathFor(identity)` is the sole path source and sidecars are scratch files (written in place, `rmSync`'d on resolution) — they are never `git mv`'d, so there is no churn either way. The remaining axis is whether the PATH encodes a MUTABLE axis (kind): if kind is encoded in the path AT ALL (prefix or subfolder), an identity-only lookup with a stale kind would silently miss a file. wighawag's caveat: phases (spec → build → stuck|merge) are TEMPORALLY exclusive but a human force-resolve can leave a stale-kind orphan. A TYPED FIELD keeps `sidecarPathFor` a pure function of identity and gets per-kind views from `status`/`scan` rendering; SUBFOLDER gives bare-`ls` per-kind queues but threads kind through every call site. Lean in the observation: typed field is safer; this is explicitly an ADR-shaped call.

_Suggested default: Typed `kind:` field in the sidecar identity HTML comment, flat `work/questions/`, per-kind queues rendered by `status`/`scan`. Preserves `sidecarPathFor` as a pure function of identity (matching all current call sites), avoids any mutable-axis-in-path silent-lookup hazard, and mirrors how `disposition` already types triage answers._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should this slice be reshaped as an ADR (or pair of ADRs) rather than a build task?**

> The observation explicitly says "Its own signal; likely an ADR (folder structure is load-bearing here, status=folder)" and "this is exactly the kind of structural call that should be a human/ADR decision, not an agent's." The task body is a thin promotion stub ("draft this into a buildable slice") with `needsAnswers:true`. Both sub-decisions (rename, kind-axis) change load-bearing layout referenced across protocol docs and code constants — closer in shape to the existing `docs/adr/question-sidecar-human-readable-format.md` ADR than to a normal slice.

_Suggested default: Write one ADR for the kind-axis decision (the load-bearing call) and let the rename be a follow-up note inside it or a separate small ADR; the buildable slice then implements whatever the ADR picks._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Is this slice in scope for the rename/kind-axis decision ONLY, or does it also own the open hygiene questions on stale/orphan sidecars (self-heal vs halt-and-ask; force-resolve auto-delete; lock-ref/branch keying)?**

> The observation's 'OPEN QUESTIONS (for later)' lists, beyond rename + kind-axis: (1) should land/integrate or `gc` actively reconcile stale+orphan sidecars rather than relying on the downstream `sidecar-without-needsAnswers` invariant HALT; (2) should force-resolve paths (skip-verify / manual move-on) also delete the sidecar at the source; (4) the sidecar-keying question (lock-ref/branch identity vs file path), shared with the merge-question and needs-attention notes. These are layout-INDEPENDENT (Round 2 verified rebase cannot resurrect stale CONTENT; only the orphan case survives) but were surfaced in the same note. The task title and stub scope it to 'folder-rename-and-kind-axis' only.

_Suggested default: Scope this slice to rename + kind-axis only (as the title says). Split (1)/(2) into a separate 'orphan-sidecar hygiene' task and (4) into the shared sidecar-keying task already cross-linked from the merge-question and needs-attention notes — keep this slice's blast radius small._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**If the kind-axis answer is 'typed field' or 'subfolder', what is the migration plan for sidecars already on disk (and on in-flight branches), and does this slice OWN that migration?**

> There are existing sidecars under `work/questions/` keyed by the current `<type>-<slug>.md` convention. A switch to a typed `kind:` field requires adding the field to existing files (or backfilling at first read); a switch to subfolders requires moving existing files and updating every `sidecarPathFor` call site (`surface-persist.ts`, `triage-persist.ts`, `apply-persist.ts`, `advance.ts`, `lifecycle-gather.ts`). Branches cut before the change carry sidecars at the old path and will land via rebase. Round 2 established sidecar authorship stays on `main`/runner under the `advancing` lock — but a migration commit that rewrites paths/fields ON `main` will still interact with any in-flight branch carrying the old shape.

_Suggested default: Yes — this slice owns the migration. For 'typed field': a one-shot script that adds `kind=<inferred-from-prefix-or-disposition>` to every existing sidecar's identity comment, plus a tolerant parser that defaults missing `kind` for one release. For 'subfolder': a single migration commit that moves files and updates every call site in lockstep; document the cutover in the ADR and flush in-flight branches first._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

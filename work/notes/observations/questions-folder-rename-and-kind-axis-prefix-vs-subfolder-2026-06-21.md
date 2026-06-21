---
needsAnswers: true
---

# Should `work/questions/` be renamed, and is the question KIND a filename-prefix or a subfolder (or a typed field)?

2026-06-21

Spotted by wighawag while generalizing the surface->answer->apply pattern (merge-questions + stuck-as-questions). Grounded in verified code facts, not memory.

## Verified current reality (`sidecar.ts`, `work-layout.ts`, on disk)

- `work/questions/` is a REGISTERED top-level surface; `work-layout.ts` calls it **"the 'what needs me?' queue"**.
- Every question is a per-item sidecar file **`work/questions/<type>-<slug>.md`** (`sidecarPathFor`), IDENTITY-keyed (`<type>-<slug>` derived from the namespaced identity, `:`->`-`), so it SURVIVES the item's `git mv`s (deliberately NOT folder-keyed to the item's status).
- The KIND is therefore ALREADY encoded \u2014 as the FILENAME PREFIX `<type>-` (`brief-`, `observation-`, `slice-`, `prd-`, ...). On disk today `work/questions/` is a FLAT mix: `brief-land-time-...md`, `observation-...md`, etc.
- It is the HUMAN-FACING surface (humans read the question + write the answer here, often via the GitHub web UI; machine state hidden in HTML comments).

## Why this is worth deciding (the trigger)

The session converged on FOUR kinds of question flowing through this one sidecar surface: merge (unmerged branch/PR), stuck (needs-attention lock-ref), triage (observation), spec (judgement residue). They differ sharply in URGENCY and in their apply-ACTION (land / requeue / promote-drop / edit-body). A flat pile mixes a "should this pushed work MERGE?" next to "is this observation worth promoting?" \u2014 the SAME conflation wighawag's merge-question-gate insight already rejected at the config layer (`land-time-reverify` story #17 / OQ7). So the folder layout faces the same pressure the gate did.

## Two SEPARATE questions (do not conflate them)

### A. RENAME `questions/`?
The code already calls it "the 'what needs me?' QUEUE," and the generalization shows most entries are DECISIONS / a human-action INBOX, not literally questions (a merge-question's honest content is "approve this land?"; a stuck-question is "requeue/reset/drop?"). So the genus may be "things needing a human," and `questions/` may be a too-narrow name. Candidates: `inbox/`, `attention/`, `decisions/`, `pending/`. This is a NAMING call, low structural risk (one `git mv` of the folder + the `workFolderKey`/`sidecarPathFor` constant + CONTEXT/contract text). The code's OWN description ("what needs me?") supports a rename; confirm it's worth the churn.

### B. KIND axis: keep filename-PREFIX, promote to SUBFOLDER, or move to a TYPED FIELD?
The kind already exists as the `<type>-` prefix. The real choice is how to express it going forward:
- **Prefix (today):** `git mv`-SAFE (flat dir, identity-keyed, a kind-change or item `git mv` never moves the sidecar across folders), but `ls` is a flat wall and per-kind scanning means filtering filenames.
- **Subfolder (`questions/merge/`, `questions/stuck/`, `questions/triage/`, `questions/spec/`):** `ls questions/merge/` is a scannable per-kind queue \u2014 very this-repo's status=folder idiom \u2014 BUT a question whose kind changes, or an item `git mv`'d, would drag its sidecar ACROSS subfolders, RE-INTRODUCING exactly the cross-folder-move/rename churn the lock cutover (`ledger-status-per-item-lock-refs`) deliberately REMOVED. That cuts against the repo's recent direction (transient state OUT of folders, identity-keyed, git-mv-safe).
- **Typed field + rendered views:** keep the flat identity-keyed file, add `kind: merge|stuck|triage|spec` to the sidecar's identity HTML comment (it already carries `type`/`disposition`), and get per-kind queues from `status`/`scan` RENDERING, not from the directory tree. Matches how `disposition` already types triage answers; loses the bare-`ls` per-kind view (you need the tool).

## CORRECTION + the actual decision rule (verified the sidecar lifecycle)

The "Subfolder" bullet above first claimed subfolders re-introduce the cross-folder-move CHURN the lock cutover removed. Verified the code: that is WRONG for sidecars. `sidecarPathFor(identity)` is the SOLE path source (`surface-persist.ts`, `triage-persist.ts`, `apply-persist.ts`, `advance.ts`, `lifecycle-gather.ts`); the path is a PURE FUNCTION of the item identity, written in place and `rmSync`'d on resolution (`sidecar-apply.ts:168`). There is NO `git mv`/rename of a sidecar anywhere. A sidecar is a DERIVED-PATH SCRATCH FILE, not a tracked-and-moved `work/` ITEM, so the lock-cutover churn argument does NOT transfer. wighawag is right: a single-use, single-kind sidecar in a subfolder has NO churn.

The REAL (narrower) hazard is a SILENT-LOOKUP bug, and it gives the decision rule: subfolders are SAFE iff the subfolder is a PURE FUNCTION OF THE ITEM IDENTITY (so `sidecarPathFor(identity)` still finds the file knowing ONLY the identity, as all call sites do today). It breaks ONLY if the subfolder keys on QUESTION-KIND and one item can have DIFFERENT kinds over its life: today's `<type>` is the item NAMESPACE (`slice`/`prd`/`observation`, stable per item), but the generalized KINDS (merge/stuck/triage/spec) are a different axis. One `slice:foo` could have a SPEC question at build time and a MERGE question later at land time; if `questions/<kind>/` keys on kind, an identity-only call site computes `questions/spec/slice-foo.md` and SILENTLY misses a file now at `questions/merge/slice-foo.md` (or two sidecars in two subfolders). Silent, arguably worse than a loud git conflict.

So:
- **If kind is 1:1 with identity** (an item only ever has ONE question-kind): subfolders are fine; single-use means no churn; the instinct wins outright.
- **If an item can have DIFFERENT kinds over time**: either keep FLAT + a typed `kind` field (path stays f(identity)), OR adopt `questions/<kind>/<type>-<slug>.md` AND thread the kind through EVERY `sidecarPathFor` call site (invasive; a wrong/stale kind = a silently-missed sidecar). Decide which world we are in BEFORE choosing subfolders.

Revised lean: kinds are probably NOT 1:1 with identity (spec-then-merge on one slice), so FLAT + typed field is the safer default; BUT if the design pins "one open question-kind per item at a time" as an invariant, subfolders become safe and the `ls` ergonomics may be worth it. (Supersedes the git-mv-safety framing in the Lean section below, which over-weighted a churn risk that does not exist for scratch sidecars.)

## Lean (a POSITION, not a decision)

The kind axis already exists as a prefix; promoting it to a SUBFOLDER trades the git-mv-safety the repo has been pricing highly for `ls`-scannability. Given the lock cutover's whole point was to get transient/status concerns OUT of conflict-prone folder moves, the grain of the repo points to: keep flat + identity-keyed, express kind as a TYPED FIELD, render per-kind queues via the tool (B-typed-field) \u2014 and SEPARATELY consider a folder RENAME (A) since the code itself already calls it a "what needs me?" queue rather than "questions." But this is exactly the kind of structural call that should be a human/ADR decision, not an agent's \u2014 surfaced, not resolved.

## Cross-links

- Shares the SIDECAR-KEYING question with `work/notes/findings/advance-surface-apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-21.md` and `work/notes/observations/needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md` (can a sidecar key to a lock-ref/branch identity, not only a file path?). Folder shape + keying should be decided TOGETHER.
- The `land-time-reverify-and-parallel-merge-ceiling` brief now points here (its "Part of a larger generalization" section): how merge-questions are placed/scanned depends on (B).

---

## Discussion round 2 (wighawag): flat-vs-subfolder DISMANTLED as a non-issue; the real questions are (a) shared-main staleness and (b) phase-exclusion

wighawag pushed on the analysis above and was right on several counts. Recording the conclusions; the residue is OPEN QUESTIONS below.

### CONCLUDED: flat vs subfolder is a NON-DIFFERENCE for safety
The "silent-lookup" hazard attributed to SUBFOLDERS is NOT subfolder-specific: if KIND is encoded in the path at all (a filename PREFIX `merge-slice-foo.md` vs a SUBFOLDER `merge/slice-foo.md`), an identity-only `sidecarPathFor` lookup misses a stale-kind file IDENTICALLY. The real axis is "does the path encode a MUTABLE axis (kind)?", NOT "flat vs subfolder." So flat vs subfolder is a COSMETIC/ergonomic choice (`ls questions/merge/` vs `ls questions/ | grep '^merge-'`), not a correctness one. This RETRACTS the remaining flat-vs-subfolder framing earlier in this note. Likewise "moves"/"content-matching" were never real operations: each sidecar is a distinct file with distinct content at one identity-derived path; git tracks each path independently, nothing is moved or content-matched (wighawag's point 4).

### CONCLUDED (with wighawag's caveat): kinds are TEMPORALLY mutually exclusive, not concurrent
wighawag: an item cannot hold two kinds at once. A STUCK item failed DURING build (not awaiting a merge answer); a MERGE question only exists once BUILT and NOT stuck; a SPEC question is PRE-build. Sequential PHASES: spec -> [build] -> stuck OR merge. At any instant, at most one kind, so the "two kinds at once" hazard does NOT arise.
  - CAVEAT (wighawag, important): phase-exclusion is NOT GUARANTEED over time, because a HUMAN can FORCE-RESOLVE (skip-verify, or manually move an item on) while FORGETTING TO DELETE the sidecar. So a stale ORPHAN sidecar from a prior phase CAN persist into the next. The surviving risk is not "two at once" but "a stale orphan from phase N still on disk at phase N+1."

### INVESTIGATED (a): a branch carrying a past (stale/orphan) sidecar across rebase (VERIFIED in code)
Scenario: sidecars live committed under `work/questions/` on `main` (how a human answers via the GitHub UI). A branch cut from `main` carries them as of cut time; `main` advances; at land the branch rebases onto current `main`. Findings:
- **A hard invariant exists**: `needsAnswers:false <=> NO active sidecar` (`advance-classify.ts`). A sidecar present while `needsAnswers` is not true is the DEFINED violation `sidecar-without-needsAnswers` -> `invariant-violation`.
- **DETECTED + HALTS, not auto-repaired**: `advance.ts` (~L859) returns exitCode 1, outcome `invariant-violation`, "refusing to advance ... the needsAnswers flag and the sidecar disagree ... A human must reconcile them." So an orphan sidecar (the (b) case) is CAUGHT loudly at that item's next advance tick and BLOCKS it until a human fixes it. NOT silent. Good.
- **The LAND/integrate path does NOT touch sidecars**: `integration-core.ts` / `complete.ts` / `needs-attention.ts` have ZERO `questions/`/sidecar references. Rebase/integrate does NOT reconcile a stale/orphan sidecar; it carries the files and lets git's per-PATH merge resolve them. The safety net is the downstream `classifyTick` invariant, NOT the land path.
- **No auto-cleaner**: nothing auto-deletes an orphan sidecar; `ledger-lint.ts` does not check sidecar-vs-needsAnswers. The invariant REFUSES to advance but does not self-heal.
- **Flat-vs-subfolder is IRRELEVANT to (a)**: carry/stale/orphan reconciliation is per git PATH, identical flat or subfoldered. Confirms wighawag's intuition.

### NET
Flat vs subfolder: decide on ERGONOMICS alone (no safety difference). The real, layout-INDEPENDENT risks are (i) a stale sidecar carried by a branch across rebase and (ii) a human-forced resolution that orphans a sidecar. Both are CAUGHT (not silently) by the `needsAnswers <=> sidecar` invariant at the next tick, which HALTS for human reconciliation, but neither is AUTO-HEALED, and the land path does no sidecar reconciliation.

### OPEN QUESTIONS (for later)
1. Should land/integrate (or `gc`) actively reconcile/clean stale+orphan sidecars instead of relying on the downstream invariant-violation HALT? (self-heal vs halt-and-ask)
2. Should force-resolve paths (skip-verify / manual move-on) ALSO delete the sidecar, closing the orphan source at creation rather than catching it later? (wighawag's (b) root-cause fix)
3. RETIRED (wighawag was right; verified in code). A stale-CONTENT sidecar CANNOT survive rebase. Rebase is a 3-way merge (base = branch-cut ancestor, ours = current `main`, theirs = the branch). For ANY sidecar, the branch side is BASE-IDENTICAL, because a work branch NEVER writes a sidecar: all sidecar writes (`surface-persist.ts`, `triage-persist.ts`, `apply-persist.ts`, `sidecar-apply.ts`) run under the `advancing` CAS lock (the main-side advance transition), and the build path (`do.ts`/`run.ts`/`complete.ts`/`integration-core.ts`) has ZERO sidecar writes (verified). Git's 3-way rule: "unchanged-from-base vs changed" is NOT a conflict, the changed side wins. So: main DELETED the sidecar + branch untouched -> deletion WINS (no resurrection); main EDITED it + branch untouched -> main's edit WINS; neither touched -> nothing. The only way stale content survives is if BOTH sides changed the same sidecar (a real conflict), which requires the BRANCH to have written it, which agents-do-no-git structurally forbids. So stale-CONTENT is a NON-ISSUE by git semantics.
   LOAD-BEARING INVARIANT this rests on (must be preserved): a work branch NEVER authors a sidecar; sidecar authorship stays on `main`/runner (under the `advancing` lock). CONSTRAINT ON THE MERGE-QUESTION GENERALIZATION: if merge-questions are ever authored against a BRANCH / lock-ref instead of `main`, that would re-open the both-sides-changed conflict (case 4) and break this guarantee. Keep merge/stuck/etc. sidecar authorship on `main`/runner.
   NET: the staleness concern collapses to the ORPHAN case ONLY (Q1/Q2 below) -- a sidecar that exists with `needsAnswers` already false (human force-resolved + forgot to delete). That is the `sidecar-without-needsAnswers` invariant-violation: CAUGHT-but-not-HEALED. Stale-content is gone entirely.
4. (unchanged) the SIDECAR-KEYING question (lock-ref/branch identity vs file path), shared with the merge-question + needs-attention notes.
5. (unchanged) RENAME `questions/` (the code calls it the "what needs me?" queue; most entries are decisions/an inbox).

Its own signal; likely an ADR (folder structure is load-bearing here, status=folder). (Round 2 below supersedes the flat-vs-subfolder framing as a non-issue.) Do NOT guess the rename/restructure \u2014 surface it.

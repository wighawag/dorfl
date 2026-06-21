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

Its own signal; likely an ADR (folder structure is load-bearing here, status=folder). Do NOT guess the rename/restructure \u2014 surface it.

---
title: folder taxonomy reorg (one lifecycle umbrella) + a needsAnswers edit-handshake command
slug: folder-taxonomy-and-prd-edit-handshake
type: idea
status: incubating
---

> **UPDATE 2026-06-16 — the DEFERRED umbrella names are now DECIDED, and the rename is sketched as a safe two-phase migration.** A design conversation settled the placeholder names (`<lifecycle-umbrella>`/`<design>`/`<build>`/`<notes>`) AND the slice→task / spec→brief vocabulary rename, plus the four lifecycle states the first sketch forgot and the run-lock placement. See `## DECIDED 2026-06-16` near the end. Still an INCUBATING idea (becomes a SPEC only when the maintainer commits to the reorg); the 2026-06-08 SPEC-state work below already shipped the `spec-sliced/` family that this builds on.

> **UPDATE 2026-06-08 — the sliced-SPEC folder split is now DECIDED (reversing one rejection below) and spun into its own SPEC `work/spec/slicing-coherence.md`.** A design session (during the `do spec:advance-loop` test-drive) settled three coupled decisions that this idea had left open or rejected. They are recorded in the new `## DECIDED 2026-06-08` section at the end (and the affected REJECTED bullet is annotated inline). The folder-NAME bikeshed below is also resolved: the sliced-SPEC folder is **`spec-sliced/`**. The `<build>/<design>/<notes>` umbrella reorg remains an incubating idea; only the SPEC-state folder family (`spec/` → `slicing/` → `spec-sliced/`) is being acted on now.

# Folder taxonomy: regroup the lifecycle under one umbrella (names DEFERRED)

> Captured from a design conversation (2026-06-06). This is an **idea, not a decision** — the maintainer is deliberately on the fence about whether to reorg at all. NOT an ADR (an ADR records a decision WE made; this is "we might"). It incubates here until/unless it becomes a SPEC. The folder shape below is the proposed _structure_; the **names are explicitly undecided**.

## The discomfort that started it

`work/` today is two governance regimes wearing one folder (per `skills/to-slices/WORK-CONTRACT.md`): a **state machine** (`backlog → in-progress → needs-attention → done`/`out-of-scope`, status = folder, flows via CAS `git mv`) AND **capture buckets** (`ideas`/`observations`/`findings` — notes that don't flow, leave only by deletion). The wish was to make the folders express that seam, so each tree means one thing.

## Proposed SHAPE (names deferred — see below)

```
<lifecycle-umbrella>/        # the path from intent to shipped code
  <design>/                  # "deciding WHAT" — MIXED regime (intentionally not pure)
    ideas/<slug>.md          #   capture: proposed, pre-SPEC — editable, deletable
    spec/<slug>.md            #   source: the living, mutable, re-sliceable north-star
    slicing/<slug>.md        #   the HELD LOCK (CAS, via the seam); absence from spec/ = hands-off
  <build>/                   # "BUILDING it" — PURE state machine, every folder flows
    backlog/  in-progress/  needs-attention/  done/  out-of-scope/
  <notes>/                   # capture — NOT flow, leave only by deletion
    observations/  findings/

docs/
  adr/<slug>.md              # our decisions + why — stays SEPARATE (reference, not lifecycle)
```

Two top-level concepts only: the lifecycle umbrella + `docs/` (you can't fold ADRs into the lifecycle without lying — ADRs are _consulted by_ the flow, not _moved through_ it).

## Decisions baked into the shape (the durable reasoning to preserve)

- **`<build>/` is a pure state machine** — this is the real consistency win the conversation was after: every folder is a status, every move is a CAS `git mv`, one rule, no exceptions. Pulling capture buckets out is what achieves it.
- **`<design>/` is a coherent grouping but deliberately NOT a pure state machine.** It mixes capture (`ideas`) + mutable source (`spec`) + a lock (`slicing`). That mix is honest: **PRDs are living documents, not flowing tokens.** Forcing `<design>/` into a clean `to-slice → being-sliced → sliced` machine is over-purity applied to an inherently mixed bag.

## REJECTED options (record so they aren't re-litigated)

- **`to-slice` / `being-sliced` / `sliced` as folders.** ~~Rejected~~ **PARTLY REVERSED 2026-06-08 — see `## DECIDED 2026-06-08`.** Originally rejected for two reasons: (1) the flow is **non-terminal** — a SPEC goes `spec → slicing → spec` (the lock returns it) and gets **re-sliced** (PRDs are reshaped; `auto-slice.md` itself has a "RESHAPED" banner yet is `sliced:`), so `sliced/` is not a `done/`-like resting state; making it one needs a banned bidirectional `sliced → to-slice` move. (2) sliced-ness is **derivable / already a marker** — `autoslice-gate.md` resolves `sliceAfter` against the **`sliced:` frontmatter marker (NOT `done/`)**; encoding it as a folder re-materializes a derivable state (double-write + drift). **Both objections are now answered, not dodged:** (1) re-slice = `spec-sliced/ → spec/` is the LEGITIMATE analogue of the existing `done/ → backlog/` reopen ("minus done" makes the model fit, it does not need a banned move); (2) the FOLDER becomes the source of truth and `sliced:` becomes a derived COPY written by the single release-transition owner (no drift by construction — same atomicity advance-loop US #11 already requires), exactly as `done/` is canonical for slices with NO `done:` marker. `sliceAfter` then reads the folder (mirroring `blockedBy` → `done/`). The NAMING half of this bullet stands: it is `spec-sliced/` (NOT a bare `sliced/`, which would sit confusingly beside the `slicing/` LOCK folder), and there is still ONE `slicing/` lock folder. See `## DECIDED 2026-06-08`.
- **`findings/` under `docs/`.** Rejected: `docs/adr/` is **endogenous** ("why did WE decide X", reader = a future maintainer of THIS code); `findings/` is **exogenous** (verified external/domain ground truth — an API, a protocol, pi's behaviour — true even if our project vanished). Different polarity/audience; `docs/` proximity would invite internal post-mortems to be mis-filed as findings (the exact confusion WORK-CONTRACT.md warns against). Findings stay in the lifecycle (`<notes>/findings/`), where slices reference them as build-input.
- **Keeping it as 3+ separate top-levels (`design/`, `work/`, `notes/`).** Three trees for "the same lifecycle in stages" is too many; regroup under one umbrella with the meaning carried by subfolders.

## DEFERRED — names + a swappable-paths enabler

- **Names are NOT decided** (`<lifecycle-umbrella>`, `<design>`, `<build>`, `<notes>` are placeholders). `flow/` was the leading umbrella candidate (it names the through-line); `work/`-as-umbrella was the lower-churn fallback but overloads a name that today means the build state machine. Decide names when/if this becomes a SPEC — don't bikeshed now.
- **Swappable folder paths (do this EVEN IF the reorg never happens).** Centralise the hardcoded `work/...` path strings (code + skills) behind a single source of truth (a constants module / config). It makes any future rename a one-line change instead of a repo-wide find-replace, and de-risks this reorg specifically. Cheap, independently valuable, and the natural first slice if the reorg is adopted.

## Cheap wins available NOW on the CURRENT layout (no reorg required)

- **README-per-folder** (the original ergonomics ask): doubles as `.gitkeep` AND documents what each folder is for — solves the empty-folder + "what goes here" problem today. Make it the canonical form (generated by a `setup`/`init` step; see `work/ideas/setup-and-migrate-skills.md`), and have skills treat "folder absent" == "folder empty" so nothing breaks if deleted. Opinionated default, graceful when absent — not a configurable format the protocol must branch on.
- **One WORK-CONTRACT clarification sentence** (true regardless of the reorg): _"PRDs are mutable source documents, not flowing work tokens; `slicing/` is a held lock, not a status; sliced-ness is the `sliced:` marker."_ This resolves the latent tension where the contract says "capture buckets don't flow" while the `slicing/` lock plainly makes a SPEC flow.

# A `needsAnswers` edit-handshake command (sibling idea)

> **SUPERSEDED 2026-06-07 by the advance-loop design (`work/ideas/advance-loop-question-answer-protocol.md`).** The mechanism below RELIED on `needsAnswers: true` meaning "agents stay away" (the gate is `needsAnswers !== true`), so flipping it gave a human a safe edit window. The advance-loop BREAKS that premise: `advance` ACTS ON `needsAnswers: true` items (surfacing/applying answers is its whole point), so `needsAnswers` can no longer double as the human edit-lock. The REPLACEMENT: the human edit-handshake takes the **transition lock (the "answer/edit" kind) via the same CAS seam** the autonomous driver uses — human and driver contend honestly on ONE lock primitive (which is just the existing claim/slicing CAS, generalised to kinds). `needsAnswers` reverts to the pure answer-required axis. Keep the rest of this idea (the handshake is still wanted; only its MECHANISM changes from flag-flip to lock-take). The original text is preserved below for history.

Spawned by `work/observations/slicing-lock-does-not-stabilise-spec-content.md`. A human who wants to edit a SPEC safely while agents might slice it should be able to **flip `needsAnswers: true` via the seam CAS** and be told win/lose: if the flip lands, no slicer will start (the gate is `needsAnswers !== true`) and any in-flight slice fails the release-rebase backstop → safe to edit. This makes the existing two-axis gate the human-facing edit lock; the command is a thin CAS wrapper. Small follow-up — becomes its own slice when prioritised, likely alongside the `autoslice-lock` rebase amendment.

## DECIDED 2026-06-08 (the SPEC-state folder family + slicing-path coherence)

Settled during the `do spec:advance-loop` test-drive. These are spun into a small precursor SPEC `work/spec/slicing-coherence.md` (to be sliced + built BEFORE advance-loop, because advance-loop's tick assumes one integrate back-half for every rung and a coherent sliced-SPEC model). Background: `work/observations/slice-output-bypasses-integration-vs-build.md`.

### D1 — PRDs flow through the SAME shape as slices ("minus done")

The SPEC lifecycle mirrors the build state machine, one rung shorter:

| build | SPEC | meaning |
| --- | --- | --- |
| `backlog/` | `spec/` | ready to slice (the "what needs slicing" human glance) |
| `in-progress/` | `slicing/` | locked, being sliced (the held lock — exists today) |
| `done/` | **`spec-sliced/`** | sliced, resting |

- **Folder = source of truth** (like `done/` for slices). `sliced:` frontmatter becomes a DERIVED COPY, written by the single release-transition owner in the same commit (no drift). Re-slice = `spec-sliced/ → spec/` (reopen-to-ready, mirroring `done/ → backlog/`).
- **`sliceAfter` reads the FOLDER** (`spec-sliced/<dep>.md`), mirroring `blockedBy` → `done/`. Today it reads the `sliced:` marker via `slicedSlugs` built in TWO spots (`slicing.ts:readSlicedSlugs`, `ledger-read.ts:resolvePrdPool`); both flip to folder-residence, downstream (`slicing-eligibility`, `select-priority`) unchanged (they only see the derived `Set`).
- **Two-step migration** (mirrors the `allowAgents→autoBuild` rename sequencing): STEP A introduces `spec-sliced/` as canonical + keeps `sliced:` as a derived copy + flips readers to the folder + backfills existing `sliced:` PRDs into `spec-sliced/`. STEP B (sequenced LAST) deletes the `sliced:` marker entirely once nothing reads it.
- **Name:** `spec-sliced/` (NOT bare `sliced/` — too close to the `slicing/` LOCK folder; the `spec-` prefix keeps the three SPEC-state folders reading as a family).

### D2 — slice OUTPUT integrates through `performIntegration` (gets propose/PR)

The slicing LOCK on `main` is CORRECT and consistent with the build CLAIM (both are the ledger-write CAS, move-into-a-status-folder on the visibility ref — see `docs/adr/claim-ledger-vs-protected-main.md`). The inconsistency is the OUTPUT: slicing commits its `work/backlog/*` straight to `main` and bypasses `performIntegration` (its doc-comment says so), so it has NO `--propose`/PR mode — why CI can't put slices in a PR (advance-loop US #27). FIX: route slice output through `performIntegration` (the shared back-half in `src/integration-core.ts`) so `do prd:<slug>` honors `--propose`/`--merge` like `do slice:<slug>`. The agent's slicing WORK can run in-place-on-a-branch like `do slice:` already does (branch ≠ worktree; the isolation seam decides). This is the KEYSTONE: it makes "all `do slice:` args apply to `do prd:`" true BY CONSTRUCTION (integrate-time args resolve in the shared core).

### D3 — the slice review model mirrors the build review model exactly (TWO flag families)

Two DISTINCT review concepts on the slice path, each its own NON-OVERLAPPING flag family, mirroring build's `improve → gate-review → integrate`:

1. **The slicer IMPROVER loop** (`slicer-review-loop.ts`, review→edit→converge, in-context, EDITS between passes, makes slices BETTER) — SLICE-PATH ONLY (cannot exist on the build path), so it gets a `--slicer-loop-*` family that is unmistakably distinct from the gate's `--review-*` (and cannot be confused with the build `--review-max-rounds`):
   - `--slicer-loop` / `--no-slicer-loop` (on/off; on by default)
   - `--slicer-loop-max <n>` (convergence cap; today's `maxReview`, default 3)
   - `--slicer-loop-model <id>` (the loop reviewer's de-correlated model; the seam ALREADY EXISTS internally as the loop's `reviewModel` — RENAME that field to `slicerLoopModel` so the code stops sharing a name with the gate's `reviewModel`, and expose it as this flag) PROMPT FIX: it must review the WHOLE SET (graph coherence, gaps, overlap, "does the set compose into the SPEC goal") — the `review` skill ALREADY has a "set of slices" mode; the loop just isn't using it at the set level today.
2. **The acceptance GATE** (fresh context, BEFORE integrate, → needs-attention on block) — the slice-path mirror of build's Gate-2, riding the `performIntegration` review-before-integrate gate that D2 brings, with a slice-SET-specific prompt (coherence / dependency graph / gaps+overlap / "if built, achieves the SPEC goal / correct-if-implemented"). Keeps the BUILD `--review-*` family (consistency is the win): `--review` / `--no-review` (on by default), `--review-model`. The gate is ONE-SHOT (terminal pass/fail), NO rounds: `--review-max-rounds` is an ORPHAN on the build gate (a rounds bound for a revise step that does not exist) and the slice gate must NOT inherit it; a future revise↔review LOOP gets its own loop-family flag (mirroring `--slicer-loop-max`). See `work/observations/reviewmaxrounds-on-wrong-concept.md`.

Net: gate family = `--review*` (shared with build); improver-loop family = `--slicer-loop*` (slice-only). No name blurs across the two.

### D4 — confirmed, no change

`advancing/` (advance-loop US #19) stays a FOLDER borrow on the ledger ref — consistent with the lock model above. An earlier musing to move it to a branch ref was WRONG (it would destroy in-progress visibility) and must NOT enter the SPEC.

## DECIDED 2026-06-16 (umbrella names + the slice→task/spec→brief rename + safe migration)

Resolves the `## DEFERRED` names above. Vocabulary and grouping settled; this remains an idea (not yet a SPEC) but the names are no longer placeholders and the migration is de-risked. Decision: **NO per-user-configurable nomenclature** — one canonical vocabulary for everyone. (If folders are NOT renamable per user, nothing is, and that is fine: a configurable synonym layer would break the single-source glossary CONTEXT.md prizes and the byte-identical propagated `protocol/` copies.) The LLM-token argument is a wash (`slice`/`spec` are not load-bearing in pretraining, `task`/`brief` are no worse — `task` is arguably MORE legible); the rename is justified on human legibility + the umbrella grouping, not model behaviour.

### The target layout (B — rename + nest)

```
work/
  notes/                 # capture regime — do NOT flow, leave only by deletion
    observations/
    ideas/
    findings/
  briefs/                # was spec-family. The brief lifecycle: untasked → tasking → tasked
    untasked/            #   was spec/         (ready to break into tasks)
    tasking/             #   was slicing/     (the HELD LOCK, mid-break — see lock note)
    tasked/              #   was spec-sliced/  (broken into tasks, resting)
  tasks/                 # build regime — PURE state machine, status = folder, CAS git mv
    backlog/
    in-progress/
    needs-attention/     # claimed-but-stuck (was top-level)
    done/
    out-of-scope/        # won't-do terminal (was top-level)
  questions/             # surfaced blocker questions — CONTENT humans answer (own top-level surface)
  advancing/             # PER-ITEM advance borrows (NOT a global mutex). Top-level, NOT dotted
                         #   — entries `work/advancing/<type>-<slug>.md`, human-visible like in-progress/
  protocol/              # propagated protocol docs — NOT diluted, stays its own top-level
```

Verb story for briefs reads cleanly: **untasked → tasking → tasked** (clearer than `spec → slicing → spec-sliced`). The only adjacency risk is `briefs/tasking` vs top-level `tasks/`; the path parent disambiguates.

### Divergence from the original `<design>/<build>/<notes>` sketch (deliberate)

The original grouped by STAGE: a `<design>/` umbrella that intentionally MIXED capture + source + lock (`ideas/` + `spec/` + `slicing/`) because "PRDs are living documents, not flowing tokens." B instead groups by REGIME: all capture in `notes/` (incl. `ideas/`), all brief-lifecycle in `briefs/`, all task-lifecycle in `tasks/`. This is the more consistent split (each umbrella = one regime) at the cost of separating `ideas/` from the briefs they seed. Chosen knowingly.

### The four states the first sketch forgot

The casual three-folder sketch (notes/tasks/briefs) dropped real, code-referenced states. All accounted for above: **`needs-attention/`** and **`out-of-scope/`** are task states → under `tasks/`; **`questions/`** is content → its own surface; **`advancing/`** is a run lock → `.locks/`.

### Lock placement (CORRECTED — `advancing/` is per-item, not a global mutex)

A mid-conversation correction from reading `advancing-lock.ts`: `advancing/` was MIS-described above (and in earlier framing) as a RUN-level mutex. **It is not.** It is a PER-ITEM borrow — one presence-marker file `work/advancing/<type>-<slug>.md` per item being advanced. Concurrent advances of DIFFERENT items run freely; only two contenders on the SAME item race the CAS. This is exactly the "a lock per item being advanced" the maintainer's instinct asked for — the code already does it. So:

- **`advancing/` is a PEER of the build claim and the slicing lock**, all three one CAS primitive (`ledgerWrite.applyTransition`): the FOLDER names the action (`claim` / `slicing` / `advancing`), the entry names the identity. NOT a different layer; there is no run-level mutex to isolate.
- **It differs from its two siblings in ONE deliberate, load-bearing way: it is file-ORTHOGONAL.** The build claim IS the slice moving `backlog/ → in-progress/`; the slicing lock IS the brief moving `untasked/ → tasking/`. An advancing borrow does NOT move the item — it is a separate marker.
- **The REAL reason for the marker (sharpened 2026-06-16 — supersedes the weak "don't disturb backlog" framing).** The first cut justified the marker as "surfacing a question must not eject the task from backlog (visibility/eligibility)." That reason is THIN: eligibility is the `needsAnswers` FLAG, not the folder — the protocol already tolerates a `needsAnswers:true` item resting IN `backlog/`, so a move would not break eligibility. The STRONG reason is an INVARIANT: **the folder encodes LIFECYCLE STATUS, and an advance does not CHANGE the item's status.** A task being question-answered is STILL a backlog task; a brief being answered is STILL untasked. Moving it would LIE about its status. Contrast the two siblings, whose action genuinely IS a status change: a claimed task truly IS now in-progress, a brief being sliced truly IS now tasking. So the rule is precise: **if the action IS a lifecycle transition, the move is the lock (status = folder, honored); if the action is ORTHOGONAL to lifecycle, use a marker (so the folder keeps telling the truth).** The marker is forced by "the folder must not lie about status," NOT by "we don't want to move the file."
- **On "shouldn't we prevent ANY modification while advancing?" — yes, and the marker already does.** The maintainer's instinct (advance MUTATES the item, so exclude others) is correct and IS satisfied: the CAS on the marker is the mutual-exclusion primitive — a second contender on the same item loses the CAS and backs off, exactly as on claim/slicing. The marker gives you the exclusion WITHOUT the false status change a move would imply. Exclusion and status are decoupled on purpose: the folder answers "where is this in its lifecycle," the marker answers "what transient action holds it right now."
- **Why a marker rather than making advance a move to its OWN folder.** An item has MORE THAN ONE orthogonal action available on the same slug (answer it, then later build it; or for a brief: answer it, then later slice it — idea lines 145 + 211). A move-based lock can encode only ONE "what is happening" axis in the single folder a file occupies; markers (identity+action keyed) let multiple action-locks coexist over an item's life without the lifecycle folder having to pick one. This is the same reason it is identity-keyed, not folder-keyed: it must lock items resting in MANY different lifecycle folders with one uniform mechanism.

### OPEN FORK 2026-06-16 — is "advancing" a STATUS (per-type folder) or an ORTHOGONAL HOLD (marker)?

The maintainer proposed treating advancing as a genuine STATUS, with a per-type lifecycle folder rather than one identity-keyed marker folder:

```
work/briefs/advancing/    # a brief being answered (was: marker in work/advancing/)
work/tasks/advancing/     # a task being answered
```

This is a LIVE alternative, NOT yet decided. Its virtue and its three open problems:

**Virtue (real):** it makes advancing a MOVE like claim and slicing — so "status = the folder" becomes UNIVERSAL with NO marker-exception. One mechanism (move-is-the-lock), no orthogonal-marker special case. Extends the project's crown-jewel invariant instead of carving an exception in it. Advancing also becomes human-visible as a first-class folder per type.

**Problem 1 — return destination (the hardest).** Advancing is a BORROW: the item returns to WHERE IT CAME FROM on release. claim/slicing have ONE unambiguous out (`backlog→in-progress→done`). But a `tasks/advancing/` task could have come from `backlog/` OR `needs-attention/` (re-asking on a stuck item), and a `briefs/advancing/` brief from `untasked/` OR `tasked/`. The destination folder alone cannot say which — so origin must be encoded SOMEWHERE, re-introducing the state-outside-the-folder the move was meant to avoid. The marker sidesteps this entirely (item never leaves origin → nothing to remember).

**Problem 2 — it shadows the real lifecycle position.** Lifecycle position (untasked vs tasked; backlog vs needs-attention) and the transient action (being-answered) are INDEPENDENT facts. A folder stores only one. `briefs/advancing/` erases whether the brief is untasked or tasked while the answer is held. The marker keeps both (folder = position, marker = action).

**Problem 3 — OBSERVATIONS have no lifecycle folders (the likely blocker).** Advancing also TRIAGES observations (`observations/ → triage → maybe promote`). Observations are a CAPTURE BUCKET that by rule does NOT flow ("the folder is the inbox; they leave only by deletion"). There is no `notes/observations/advancing/` in the per-type scheme, and there must not be — it would make a capture bucket flow, breaking the notes-don't-flow invariant. The marker covers task + brief + observation with ONE uniform mechanism PRECISELY because it is orthogonal to which folder the item rests in.

**The crux (one honest disagreement):** is "being-answered" a STATUS (where the item rests) or a HOLD (something done to it while it rests)? Proposed test: a status is where an item RESTS for a duration as its situation (in-progress IS the build); a hold is a transient action over an item whose situation is unchanged (a being-answered backlog task is STILL a backlog task — what changed is the `needsAnswers` FLAG + a sidecar, not a location). By that test it is a hold → marker. But the test is NOT airtight: if the maintainer decides being-answered IS a resting state worth seeing as a folder, problems 1 and 2 become solvable design work (encode origin; accept the position-shadowing) and problem 3 (observations) is the remaining hard blocker. Whichever wins, it must cover the observation-triage case coherently.

### LEADING RESOLUTION 2026-06-16 — CO-LOCATE the lock marker beside the item

The maintainer's refinement, which appears to DOMINATE both prior designs: keep the marker design (the hold is NOT a status), but put the marker file IN THE ITEM'S OWN FOLDER, beside the item, instead of in a separate flat `work/advancing/` folder. The item still NEVER moves.

```
work/tasks/backlog/add-quiet-flag.md          # the item, never moves
work/tasks/backlog/add-quiet-flag.<lock>.md   # the advancing marker, co-located
work/notes/observations/some-signal.md        # an observation — a capture bucket
work/notes/observations/some-signal.<lock>.md #   …locked WITHOUT flowing. bucket intact.
```

**It solves all three fork problems AND fixes the marker design's one weakness:**

- **P1 return destination:** item never moves → nothing to remember (same win as the current marker).
- **P2 position shadowing: BETTER than the current marker.** A separate `work/advancing/` divorces the lock from position (read two places). Co-located, ONE `ls` shows both: the item is visibly in `tasks/backlog/` AND the sibling lock says "being advanced." The folder keeps telling the WHOLE truth (position + hold), which is MORE honest than today, not less.
- **P3 observations: SOLVED uniformly, bucket invariant intact.** A co-located lock is a SIBLING FILE, not a flow — so an observation can be locked while NEVER leaving `observations/`. "Notes don't flow" holds. The per-type-folder status proposal could NOT do this; co-location handles task + brief + observation with one rule, breaking nothing.
- **"status = folder" honored:** the hold is still not a status; the folder still encodes only lifecycle position. Co-location adds the lock as an ADJACENT fact, it does not re-mean the folder.

**What must be nailed (real, tractable):**

1. **Conflict-safety survives.** The lock is a CAS micro-commit that ADDS a file (confirmed in `advancing-lock.ts`: `+ work/advancing/<entry>.md` on a distinct branch ref; the separate FOLDER is just a namespace, not load-bearing for the CAS). Co-located: two ticks on DIFFERENT items add different-path siblings → no conflict; two ticks on the SAME item both add `add-quiet-flag.<lock>.md` → the CAS resolves exactly as today (one wins, one exit-2). The per-entry branch ref (`advancing/<type>-<slug>`) carries over unchanged. Safety model PRESERVED.
2. **Marker FORMAT (DECIDED 2026-06-16): a markdown companion `<slug>.lock.md`.**

   ```
   work/tasks/backlog/add-quiet-flag.md          # the item (the ONLY *.md ITEM here)
   work/tasks/backlog/add-quiet-flag.lock.md     # the lock — STILL markdown, reserved infix
   work/notes/observations/some-signal.md        # an observation (capture bucket)
   work/notes/observations/some-signal.lock.md   #   …locked WITHOUT flowing
   ```

   Chosen over the two rejected shapes:
   - REJECTED: a non-`.md` suffix file (`<slug>.md.advancing`). It would be skipped by the existing `endsWith('.md')` item-scans "for free," but that is an ACCIDENTAL invariant: it makes the lock a second-class non-markdown file in an all-markdown tree, and loses the ability to carry a BODY (locker / since / reason — the current marker file already has one). Relying on "not `.md` so scans skip it" breaks the moment anyone wants the lock to be markdown.
   - REJECTED: a subfolder (`<slug>.lock/`). Heavier (a dir per locked item), clunkier CAS/`git mv` over a directory, and `readdir`-based scans must filter the dir anyway — no gain over the single-file form.

   `<slug>.lock.md` keeps it MARKDOWN (body = locker / timestamp / reason, preview-able, consistent with every other work file), sorts ADJACENT to its item in `ls`, and gives a trivial item↔lock mapping (`X.md` ↔ `X.lock.md`).

   **The catch B must pay (and the rule that makes it safe): item-scan = EXPLICIT exclusion, owned in ONE place.** Because `<slug>.lock.md` ends in `.md`, today's `endsWith('.md')` item-scans (e.g. `slicer-review-loop.ts:527`) WOULD wrongly pick it up as a task. So the item-predicate must become "`*.md` that does NOT match the reserved infix set (`*.lock.md`, and any sibling companions like `*.questions.md`)." This exclusion rule MUST live in the `work-layout` module (Phase 0) as the single source of truth, NOT be re-implemented per reader — miss one reader and a lock file gets treated as a work item. (Note the precedent: the `questions/` SIDECAR is today a separate-folder companion `work/questions/<type>-<slug>.md`; co-located companions are the same idea, now beside the item.) Suffix bytes DECIDED: **`.lock.md`** (generic) — NOT action-named (`.advancing.md`). The action (advancing, or any future lock kind) is recorded in the BODY / branch ref, never in the filename, so the companion name stays stable across lock kinds and the exclusion rule matches ONE infix.
3. **Type-encoding likely becomes redundant.** Today the entry is `<type>-<slug>` because one flat `advancing/` folder would collide a slice + SPEC sharing a slug. Co-located, the marker sits next to its item so the folder already disambiguates type → the marker can just mirror the item's filename + the reserved `.lock.md` infix. Simpler. (Confirm no cross-type same-folder case.)

**Disposition of the fork:** co-location is the LEADING design; the separate-marker (current code) and per-type-status (the move proposal) are recorded above as the alternatives it beats. NOTE this CHANGES the current `advancing-lock.ts` (marker path moves from flat `work/advancing/<entry>.md` to co-located `<item-dir>/<slug>.lock.md`) — a behaviour change to sequence as its own slice, not folded into the cosmetic rename.

### COORDINATION 2026-06-16 — sequenced AFTER the crash-safety SPEC (shares its helper)

There is an IN-FLIGHT, `humanOnly` SPEC `work/spec/recover-autodetect-and-advancing-lock-crash-safety.md` (a parallel agent, uncommitted at the time of this note) that owns `advancing-lock.ts`: Defect A (recover discards a continue-agent's work — `complete.ts`, INDEPENDENT of us, ships first), Defect B (crash-safe release), Defect C (a `release-advancing <slug>` verb + `gc --ledger`/`status` surfacing of stuck locks). B and C are written against the FLAT marker path `work/advancing/<entry>.md`.

Agreed sequencing (their read + ours): **the co-location relocation is its OWN slice in the taxonomy SPEC, `sliceAfter` the crash-safety SPEC — NOT absorbed into it.** Rationale: don't widen a tight crash-safety/data-loss fix into a cosmetic reorg, and don't gate the urgent Defect-A on the taxonomy timeline. Relocating onto an ALREADY-crash-safe release path is strictly easier than doing both at once.

What makes (b) cheap — their carve-out, our requirement:
- They route ALL marker addressing through a single `advancingMarkerPath(entry)` + `listAdvancingMarkers()` helper (instead of inlining the flat path in the ~2 acquire/release spots, `advancing-lock.ts:187` / `:478`). So our relocation becomes "change one helper," not a codebase hunt.
- **C's stuck-lock surfacing scan and OUR `*.lock.md` item-scan filter are the SAME enumeration** — walk `work/` with the reserved-infix filter. They converge on ONE `listLockMarkers()`-style primitive at relocation time. This is the strongest reason the two efforts touch but do not duplicate: if anything ever merges, it is C's surfacing + our filter, never the whole SPEC.
- **Keep `<type>-<slug>` in the lock BRANCH name** (`advancing/<entry>`) even though the co-located FILENAME can drop the `<type>-` prefix (the folder already disambiguates type). Dropping type from the branch name would risk two types colliding on `advancing/<slug>`. Filename simplifies; branch name stays path/type-derived.

Reciprocal pointers: this note is our side; their SPEC will record the same in a `## Decisions` note when sliced (flat-path-for-now + centralized helper + taxonomy SPEC relocates, `sliceAfter`). When the taxonomy SPEC is written, its relocation slice MUST declare `sliceAfter: [recover-autodetect-and-advancing-lock-crash-safety]` (or the relocation slice `blockedBy` the crash-safety slices, resolved at slicing time).
- **Placement: top-level `advancing/`, NOT dotted, NOT `.locks/`.** Earlier I proposed `.locks/` on the false "it's hidden run-level mechanism" premise. Corrected: a human CAN usefully glance at "what is mid-advance right now" (peer to glancing at `in-progress/` / `tasking/`), so it is a visible state surface, not infrastructure to hide. `.locks/` and any `triage/`-shared-with-`questions/` umbrella are both REJECTED (the latter still mixes content + lock; the former mis-frames a human-useful per-item surface as hidden plumbing). Lowest-churn too — it stays where it lives today.
- **`briefs/tasking`** (the slicing lock) stays in the brief lifecycle as before — it is the ONE lock that is also lifecycle-shaped (the brief file genuinely moves there), so unlike `advancing/` it IS the move. The orthogonal-marker vs lifecycle-move distinction is now the clean rule: `claim` and `slicing` ARE moves (live in the lifecycle as `tasks/in-progress` and `briefs/tasking`); `advancing` is a marker (its own top-level `advancing/`).
- **`questions/`** — own top-level surface (decided: top, not folded into `notes/`).
- D4 still holds: each borrow is a FOLDER marker on the ledger ref, NOT a branch ref (a branch ref would destroy in-progress visibility). No mechanism change — this section only corrects the DESCRIPTION and confirms the existing top-level `advancing/` placement.

### How to rename SAFELY — the two-phase migration (the de-risking core)

The danger, confirmed by inspection: there is **NO centralized folder-name module today**. The names live as raw string literals across **121 `.ts` files**, plus inline union types (`type SliceFolder = 'in-progress' | 'backlog' | 'done'`), ad-hoc arrays (`const WORK_FOLDERS = ['backlog','in-progress','done','needs-attention']`), `join(cwd,'work','in-progress',…)` calls, prefix-slicing (`normalized.slice('work/backlog/'.length)`), CI jq (`"slice:" + .slug`), the two byte-identical `protocol/` doc copies, and test fixtures everywhere. A naive find-replace is UNSAFE: `slice` collides with `Array/String.prototype.slice`. So:

- **Phase 0 — centralize first, NO rename, NO behaviour change.** Introduce one `work-layout` module that is the SOLE source of every `work/…` path + every folder-name union/array. Route all 121 files through it. Names stay EXACTLY as today (`backlog`, `spec`, `slicing`…). This is pure refactor; the acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) proves no behaviour changed. **ALL the risk lives here, and it is mechanical + verifiable.** This is the "swappable folder paths" enabler the DEFERRED section already prescribed — valuable even if the reorg never ships.
- **Phase 1 — flip the constants (the actual rename + nest).** Once everything routes through the module, the rename to `tasks/backlog`, `briefs/untasked`, `.locks/advancing`, etc. is editing VALUES in one file. The only other moving parts: the `git mv` of real on-disk files, and mirroring the change into both `protocol/` copies (keep `diff -r skills/setup/protocol work/protocol` clean). Because Phase 0 de-stringified everything, the JS `.slice()` method is never in scope for the rename.

This mirrors the house migration style: the `spec-sliced/` STEP-A/STEP-B split (D1) and the `allowAgents→autoBuild` two-step rename. Sequence Phase 0 as its own landed slice BEFORE Phase 1.

## Disposition

Incubates. Becomes a SPEC only if the maintainer decides to reorg (then: name the folders — NOW DONE, see `## DECIDED 2026-06-16` — write Phase 0 as its own slice riding the centralized `work-layout` module, then Phase 1 as the flip + `git mv` + dual-`protocol/`-copy update, and update skills / CLAIM-PROTOCOL / WORK-CONTRACT / ADR path references). The cheap wins (README-per-folder, the clarification sentence, the Phase-0 centralization) can be picked up independently without committing to the reorg.

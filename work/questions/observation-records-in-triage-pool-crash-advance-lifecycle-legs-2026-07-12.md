<!-- dorfl-sidecar: item=observation:records-in-triage-pool-crash-advance-lifecycle-legs-2026-07-12 type=observation slug=records-in-triage-pool-crash-advance-lifecycle-legs-2026-07-12 allAnswered=false -->

Item: [`observation:records-in-triage-pool-crash-advance-lifecycle-legs-2026-07-12`](../notes/observations/records-in-triage-pool-crash-advance-lifecycle-legs-2026-07-12.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Which of the four systemic-fix options (or combination) should be built to stop records from being swept into the triage pool?**

> The note names four options and explicitly leaves the choice to a human: (1) a distinct 'record, never a candidate' marker/type (e.g. type: record or triaged: record) touching the ledger-read pool predicate; (2) a separate work/notes/records/ bucket the triage pool does not scan; (3) auto-settle when the surfacer finds nothing to ask (risky — fights the deliberate limbo-loudness); (4) enforce candidate-vs-record at capture-signal / verify. The note's own read: 3 alone is risky; 1 or 2 plus 4 is the likely durable shape.

_Suggested default: Option 2 (separate work/notes/records/ bucket) + Option 4 (enforce marker at capture) — cleanest separation, plus belt-and-braces so a record can never enter the pool unmarked._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Promote to a task to stop records being swept into the triage pool (this is a live crash class in the advance lifecycle legs, so it warrants a real fix, not a note). Do NOT auto-select among the four systemic-fix options here: the specific option (or combination) needs to be reviewed against the four candidates before committing, since the choice is a design fork with different blast radii. The disposition is 'promote'; the option pick is deferred to that task's design step.

## Q3

**Should the corpus-wide vocabulary sweep triaged: keep -> triaged: resolve across ~23 legacy work/notes/observations/*.md files be done now, or left as residue?**

> Captured as cleanup residue in the note's 'Vocabulary caveat' block: this session's new stamps use triaged: resolve for consistency with the retired-keep direction (apply-decide-resolve-verdict-mint-nothing established resolve as the preferred word), but ~23 existing files still carry triaged: keep. Both are mechanically identical (presence-keyed drop-out) so nothing breaks; it is purely a vocabulary-uniformity chore touching 23 unrelated files.

_Suggested default: Mint a small standalone task for the sweep; do not bundle it into the systemic-fix work._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should the sibling untriaged observation surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10 be promoted to a task as the Mode-2 (agent-flake) fix?**

> The note explicitly flags this sibling as pre-existing, untriaged, and covering the OPPOSITE root cause of the same 'no parseable {questions} result' error (agent reliability: always emit a bare {questions:[]}, and/or skip the model round-trip for decision-record shapes). It says the sibling 'should be PROMOTED, not left latent'. Distinct from the systemic gap this observation is about.

_Suggested default: Yes — promote it now so Mode-2 flakes stop crashing legs independently of the Mode-1 systemic fix._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

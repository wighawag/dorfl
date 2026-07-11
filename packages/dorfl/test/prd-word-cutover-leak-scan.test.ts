import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The `prd` → `spec` WORD/PROSE CUTOVER leak-scan GATE (spec
 * `prd-to-spec-vocabulary-cutover-and-migration-command`, task
 * `erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary`). This is the
 * SIBLING of the identifier-scoped source-part scan
 * (`prd-to-spec-leak-scan.test.ts`): where THAT gate proves the CODE vocabulary
 * is `spec`, THIS gate proves the artifact WORD `prd`/`PRD`/`Prd` and the
 * `work/prds/`/`prds/<lifecycle>` FOLDER PATH are gone from the human-readable
 * TREES too, so the cutover can never silently re-drift.
 *
 * # WHAT IT WALKS (the swept trees)
 *
 * `CONTEXT.md` + `README.md` + `AGENTS.md`, `skills/**` (EXCLUDING
 * `skills/setup/protocol/**` — the protocol SOURCE is mirror-managed and its
 * `prd:` survivors are the contract's own back-compat mentions), `docs/**`, and
 * ALL of `work/**` (active AND terminal history) EXCEPT `work/protocol/**` (the
 * byte-identical mirror of the protocol source). `.git`/`node_modules` are never
 * descended.
 *
 * # WHAT IT FLAGS (the artifact WORD, not identity) — BI-WORD
 *
 * A leak is a STANDALONE artifact-word `prd`/`PRD`/`Prd` OR the doubly-retired
 * `brief`/`BRIEF`/`Brief` (a whole word, boundary = not `[A-Za-z0-9_]` on either
 * side) OR a `work/prds/`/`prds/<lifecycle>` FOLDER PATH, that is NOT on the
 * concrete PRESERVE allow-list below. The gate is BI-WORD by design: the
 * `spec → brief → spec` thrash means a `spec`-only scan would silently pass a
 * stray `brief`. TWO asymmetries between the words: (1) `prd` has ZERO English
 * collisions, `brief` is real English (`debrief`/`briefly`/"a brief note"), so
 * the `brief` lens carries an English allow-list; (2) `prd`'s `prd:` field/verb
 * is gated on ACTIVE `work/**` items (terminal-history-exempt), whereas every
 * live `brief` mention in a `work/**` body is dated PROVENANCE narration, so the
 * `brief` lens gates the LIVING DOCS only (`docs/adr/**` included — its sweep is
 * done), NOT `work/**` bodies (where a live `brief` is immutable provenance).
 *
 * # THE PRESERVE ALLOW-LIST (concrete, each class JUSTIFIED)
 *
 *   1. **Slug identities / cross-references** — a `prd`-containing hyphenated
 *      slug that names a landed file / a frontmatter `slug:`/`spec:`/`blockedBy:`/
 *      `covers:`/`taskedAfter:` value. Enumerated in {@link PRESERVE_SLUGS} from
 *      the ACTUAL `prd`-containing basenames + frontmatter values present in the
 *      tree. Rewriting the word inside one renames a file / desyncs a reference;
 *      `prd-to-spec` is the migration command's own published name.
 *   2. **PROVENANCE `prd:` in TERMINAL HISTORY** — a `prd:` frontmatter-FIELD /
 *      `do prd:` / `advance prd:` VERB reference in a `work/tasks/done/` body or
 *      title, an observation/finding note, or an ADR that RECORDS the field/verb
 *      AS IT WAS at build time. HARD CUTOVER (task
 *      `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`): the `prd:`
 *      field read + the `do prd:`/`advance prd:` verb are DEAD in live code (the
 *      field read removed from `parseFrontmatter`, the verb refs flipped to
 *      `spec`). Enforcing that on LIVE CODE is the SRC-prose scan's job
 *      (`prd-src-prose-leak-scan.test.ts`, which no longer exempts `prd:`). This
 *      WORD scan walks the human-readable trees incl. terminal history, where a
 *      `prd:` is immutable PROVENANCE — rewriting it FALSIFIES history. So a `prd:`
 *      prose reference stays exempt HERE as provenance, not as a live alias.
 *      PLUS the inert NAMESPACE / lock-ref forms `refs/dorfl/lock/prd-<slug>` /
 *      `work/prd-<slug>` (branch) / `prd-<slug>` (lock/sidecar) / `prd-*` (a ref
 *      glob): the `prd-`-hyphen constructs the tooling still reads on-disk for
 *      un-migrated data.
 *   3. **camelCase / PascalCase historical API names** — `renderPrdBody`,
 *      `prdTitle`, `LedgerPrdItem`, … in `work/tasks/done/` bodies are the NAMES
 *      of (now-renamed) symbols AS THEY WERE at build time. Covered by the
 *      word-boundary rule (a `prd`/`Prd` glued to a letter/digit/`_` is not a
 *      standalone word), so they are never flagged.
 *   4. **Legacy FLAT-layout folder names in a migration MAP** — `work/prd/`,
 *      `work/pre-prd/`, `work/prd-tasked/` (the OLD on-disk folder names a
 *      pre-umbrella repo LITERALLY has; `setup`'s `git mv` map + the taxonomy
 *      ADR name them as the rename SOURCE). Covered by the namespace-form rule
 *      (`prd/`, `pre-prd/`, `prd-tasked` are `prd`-hyphen/slash constructs, not
 *      the bare word). `prd-tasked` is also the taxonomy ADR's named awkward-old
 *      candidate.
 *   5. **English** — `prd` is a coined acronym with ZERO English false-positives
 *      (see the `prd-has-zero-english-false-positives` finding), so unlike the
 *      `brief` half of the prior cutover there is no English allow-list to carry.
 *   6. **A token reference inside an inline-code / fenced-code span** — the
 *      artifact word inside a markdown `` `…` `` inline span or a ``` fenced ```
 *      block is naming the RETIRED TOKEN / an EXAMPLE / a code snippet (a
 *      `` `renderPrdBody` `` symbol, a `` `grep … \bprd\b` `` command, a
 *      `` `prd-body` `` compound cited AS an example, this scan's own meta-docs),
 *      NOT the live artifact NOUN. This is the SAME "judge code spans, gate
 *      prose" cut the source-part scan applies: the bare-word lens runs only over
 *      PROSE (code spans stripped); the FOLDER-PATH lens (`work/prds/`) still runs
 *      over the RAW line so a migrated-away path in a code span is STILL caught.
 *      Verified non-false-negative: the tree has NO live artifact-NOUN inside a
 *      code span (the sweep flipped every one), only token/example references.
 *
 * NOTE (scope boundary vs the source scan): this WORD scan is the deferred
 * "tree-wide gate over `work/`" the source-part scan flagged as this final
 * task's — but WORD-scoped (the artifact word + folder path in prose), NOT the
 * structural data conversion the `dorfl prd-to-spec` command runs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..');

// ───────────────────────────────────────────────────────────────────────────
// The concrete PRESERVE allow-list of `prd`-containing SLUG IDENTITIES.
// Every entry is a real landed-file basename or a frontmatter cross-ref value
// present in the tree (a file identity / proper noun that can never be renamed).
// ───────────────────────────────────────────────────────────────────────────

const PRESERVE_SLUGS: readonly string[] = [
	'build-prd-to-spec-migration-command',
	'ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices',
	'close-job-via-prd-to-brief-rename-verify-and-flip-masked-test',
	'code-identifier-slice-prd-to-task-brief-rename',
	'complete-intake-slice-prd-to-task-brief-cutover',
	'contract-spec-blocked-by-untasked-residual-prd-exported-symbols-2026-07-10',
	'contract-spec-frontmatter-prd-key-read-is-command-data-territory-not-contract-2026-07-10',
	'erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary',
	'explicit-do-prd-not-gated-by-autoslice',
	'extend-renderprdbody-with-solution-and-userstories-inputs',
	'finish-spec-cutover-prd-placeholder-and-resolvedtask-field-renamed-2026-07-10',
	'folder-taxonomy-and-prd-edit-handshake',
	'intake-posts-completion-comment-on-slice-prd-outcomes',
	'intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3',
	'migrate-batch-left-resolveClosingIssue-prd-read-to-brief-sweep-task-2026-07-09',
	'observation-discharge-by-deletion-self-contained-promotion-and-prd-route',
	'prd-complete-query',
	'prd-has-zero-english-false-positives-unlike-brief-and-spec',
	'prd-sliced-folder-step-a',
	'prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10',
	'prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10',
	'prd-to-spec-4f-cli-flags-clean-break-full-internal-purge-and-the-c-audit-single-lens-pattern-2026-07-10',
	'prd-to-spec-4g-verdict-contract-flip-and-4d-section4-inconsistency-2026-07-10',
	'prd-to-spec-contract-leak-scan-source-part-tree-wide-gate-deferred-2026-07-10',
	'prd-to-spec-identity-layer-needs-expand-first-not-hard-swap',
	'prd-to-spec-migrate-left-namespace-emit-sites-and-local-unions-on-prd-contract-cannot-close',
	'prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green',
	'prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename',
	'prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch',
	'prd-to-spec-vocabulary-cutover-and-migration-command',
	'pre-prd-staging-pool-split-and-untrusted-prd-placement',
	'promote-prd-disposition-and-triage-local-cas-prd-writer',
	'rename-cli-verb-and-flags-do-prd-to-do-brief',
	'rename-lock-cli-namespace-tokens-prd-slice-to-brief-task',
	'rename-spec-intake-cli-flags-and-residual-prd-identifiers',
	'rename-spec-residual-exported-symbols-and-prdsland',
	'rename-spec-residual-exported-symbols-and-prdslandIn-plumbing',
	'review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07',
	'run-prd-to-spec-on-dorfl-acceptance',
	'shared-buildable-task-and-prd-body-renderer-extract',
	'slice-task-prd-brief-vocabulary-hard-cutover',
	'stale-prd-slice-tokens-in-cli-namespace-guard-comments',
	'surface-promote-prd-as-human-only-disposition',
	'tasking-buildtaskingspec-still-hardcodes-work-prds-folder-paths-2026-07-10',
];

// ───────────────────────────────────────────────────────────────────────────
// Tree walk (option-A scope, WORD-widened to work/**).
// ───────────────────────────────────────────────────────────────────────────

const CONTEXT_MD = join(REPO_ROOT, 'CONTEXT.md');
const README_MD = join(REPO_ROOT, 'README.md');
const AGENTS_MD = join(REPO_ROOT, 'AGENTS.md');

function isExcludedDir(rel: string): boolean {
	// Never descend into build/vendor output, the .git store, the protocol
	// SOURCE (mirror-managed, its `prd:` survivors are contract mentions), or the
	// byte-identical protocol MIRROR.
	return (
		rel === 'node_modules' ||
		rel === '.git' ||
		rel === join('skills', 'setup', 'protocol') ||
		rel === join('work', 'protocol')
	);
}

function collect(dir: string, out: string[]): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const full = join(dir, entry.name);
		const rel = relative(REPO_ROOT, full);
		if (entry.isDirectory()) {
			if (isExcludedDir(rel) || entry.name === 'node_modules') continue;
			collect(full, out);
		} else if (/\.(md|txt)$/.test(entry.name)) {
			out.push(full);
		}
	}
}

/** Every file the WORD scan walks. */
function scannedFiles(): string[] {
	const out: string[] = [];
	for (const single of [CONTEXT_MD, README_MD, AGENTS_MD]) {
		if (existsSync(single)) out.push(single);
	}
	collect(join(REPO_ROOT, 'skills'), out);
	collect(join(REPO_ROOT, 'docs'), out);
	collect(join(REPO_ROOT, 'work'), out);
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// PROVENANCE FILES: task/observation bodies whose OWN SUBJECT is the retired
// `prd` vocabulary sweep. Such a body legitimately QUOTES the retired word +
// the migrated-away `work/prds/…` folder path in prose to describe what it
// converts FROM (the SLUG-based `PRESERVE_SLUGS` mechanism cannot reach these
// content lines when the slug itself carries no `prd` substring). File-scoped
// analogue of `PRESERVE_SLUGS`; a concrete, enumerated basename list (asserted
// non-vacuous below), so it cannot silently swallow a real re-drift elsewhere.
// See work/notes/observations/word-scan-exempts-prd-cutover-task-bodies-2026-
// 07-10.md for the decision record.
// ───────────────────────────────────────────────────────────────────────────

const PROVENANCE_FILE_BASENAMES: readonly string[] = [
	'sweep-prd-artifact-word-in-src-prose-and-runtime-strings.md',
	'word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md',
	'advance-lifecycle-template-src-prose-still-says-prd-2026-07-10.md',
	// The hard-cutover task body: its OWN subject is removing the last `prd`
	// back-compat surfaces, so it legitimately quotes the retired `prd`/`prd:`
	// word + folder path in prose to describe what it removes.
	'hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md',
	// The forward-looking idea note whose OWN subject is widening the prd-to-spec
	// sweep beyond `work/` + harvesting the reusable cutover pattern: it quotes the
	// retired `prd` word throughout to describe what the tooling should convert.
	'prd-to-spec-sweep-beyond-work-tree-and-reusable-cutover-pattern.md',
];

function isProvenanceFile(rel: string): boolean {
	return PROVENANCE_FILE_BASENAMES.some((b) => rel.endsWith(b));
}

// A `prd:` field / `do prd:` verb reference is exempt ONLY as immutable
// PROVENANCE inside a TERMINAL-HISTORY body (a done/cancelled task, a
// tasked/dropped spec, or an append-only note), where rewriting it would
// FALSIFY the record of what a build did. In a LIVING doc (`CONTEXT.md`,
// `README.md`, `AGENTS.md`, `skills/`, `docs/`, and ACTIVE `work/` items) the
// hard cutover killed the `prd:` field-read + `do prd:`/`advance prd:` verb, so
// a `prd:`/`do prd:` there is a stale reference and MUST be swept.
function isTerminalHistory(rel: string): boolean {
	const p = rel.split('\\').join('/');
	return (
		p.startsWith('work/tasks/done/') ||
		p.startsWith('work/tasks/cancelled/') ||
		p.startsWith('work/specs/tasked/') ||
		p.startsWith('work/specs/dropped/') ||
		p.startsWith('work/notes/') // observations/ideas/findings: append-only capture
	);
}

// A WORK-ITEM BODY is any file under `work/**` (active OR terminal): a task, a
// spec, an append-only note, a question sidecar. The `prd`→`spec` sweep already
// runs over these (the `prd:` field/verb is gated on ACTIVE items via
// `isTerminalHistory`), but the DOUBLY-retired `brief` word is treated
// differently: a `brief` in ANY work-item body is immutable PROVENANCE (the body
// narrates a dated past incident/review under the then-current `brief`
// vocabulary, e.g. "landed under brief `code-identifier-slice-…`"), so rewriting
// it would FALSIFY the record whether the item is still active or terminal. The
// `brief` artifact-word lens therefore gates the LIVING DOCS ONLY (`CONTEXT.md`/
// `README.md`/`AGENTS.md`, `skills/**`, `docs/**` — the current-guidance surface),
// NOT `work/**` bodies. (`prd` retains its stricter active-vs-terminal split; only
// `brief`, whose live mentions are all provenance narration, is body-exempt.)
function isWorkItemBody(rel: string): boolean {
	return rel.split('\\').join('/').startsWith('work/');
}

// NOTE (`docs/adr/**` IS gated). The ADR vocabulary sweep is DONE: live-reference
// / stale-guidance `prd`/`brief` in the ADRs was swept to `spec`, and the genuine
// dated DECISION-RECORD mentions that must stay (naming the retired word AS the
// thing that was retired, or the migration's pre-cutover INPUT) are either
// backticked token references or wrapped in the ''…'' provenance marker. So the
// bi-word `brief` gate walks `docs/adr/**` like every other living-doc tree —
// there is no longer any deferred-tree carve-out.

// ───────────────────────────────────────────────────────────────────────────
// The leak lens (WORD + folder path, minus the PRESERVE allow-list).
// ───────────────────────────────────────────────────────────────────────────

interface Leak {
	file: string;
	line: number;
	token: string;
	why: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Is the `prd`/`Prd`/`PRD` hit at `idx` on `line` an ALLOWED survivor (not a
 * leak)? Applies the concrete allow-list: camelCase/snake boundary, the `prd:`
 * verb/field alias, the `prd-`/`prd/` NAMESPACE + legacy-folder forms, and the
 * enumerated slug identities.
 */
function isAllowedWordHit(
	line: string,
	idx: number,
	lower: string,
	terminalHistory: boolean,
): boolean {
	const before = line[idx - 1] ?? '';
	const after = line[idx + 3] ?? '';
	// camelCase / PascalCase / snake_case → not a standalone word (historical API
	// names like renderPrdBody, prdTitle, prd_flag).
	if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) return true;
	// A `prd:`-prefixed token in PROSE. HARD CUTOVER (task
	// `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`): this is NO
	// LONGER a LIVE back-compat alias — the `parseFrontmatter` `prd:` field read is
	// GONE and the `do prd:`/`advance prd:` verb refs are flipped to `spec`. The
	// enforcement of that hard cutover on LIVE CODE is the SRC-prose scan's job
	// (`prd-src-prose-leak-scan.test.ts`, which no longer exempts `prd:` and FAILS
	// on a stray live `prd:` field-key / `do prd:` verb). This WORD scan walks the
	// human-readable TREES — including TERMINAL HISTORY (`work/tasks/done/`,
	// observation/finding notes) and this cutover's own provenance — where a `prd:`
	// in a done body/title RECORDS the field/verb AS IT WAS at build time. That is
	// immutable PROVENANCE (survivor class per this task: provenance is exempt);
	// rewriting it would FALSIFY history. So a `prd:` in prose stays exempt ONLY in
	// TERMINAL-HISTORY trees (provenance), NOT in a LIVING doc where the dead field/
	// verb must be swept to `spec:`. (A backticked `prd:` token is already stripped
	// by the inline-code lens, preserve #6.)
	if (after === ':') return terminalHistory;
	// The NAMESPACE / legacy-folder forms: `prd-<…>` (lock/sidecar/branch glob),
	// `prd/` (legacy flat folder). Only a `prd` that is the HEAD of a
	// hyphen/slash construct — the bare word `prd` never survives here.
	if (after === '-' || after === '/') {
		// A slug identity present on the line covers this hit.
		if (slugCovers(line, lower)) return true;
		// The published namespace + legacy-folder constructs.
		const ctx = line.slice(Math.max(0, idx - 24), idx + 24);
		if (
			/(?:refs\/dorfl\/lock\/|work\/)?prd-(?:<|\$\{|\*|tasked|slug|name)/.test(
				ctx,
			) ||
			/\bpre-prd\/|\bwork\/prd\/|\bprd\/\b|`prd\/`|\bprd-\*/.test(ctx)
		) {
			return true;
		}
		// Any other `prd-`/`prd/` construct is a PROSE compound (`prd-body`,
		// `prd-level`) that SHOULD have been swept → a leak.
		return false;
	}
	// A truly bare word `prd` (no hyphen/colon/slash after): allowed ONLY if it is
	// inside an enumerated slug present on the line.
	return slugCovers(line, lower);
}

/** Does an enumerated PRESERVE slug appear on this line and contain `prd`? */
function slugCovers(line: string, _lower: string): boolean {
	for (const slug of PRESERVE_SLUGS) {
		if (line.includes(slug)) return true;
	}
	return false;
}

const PRD_HIT = /[Pp][Rr][Dd]/g;
/** `work/prds/…` or bare `prds/<lifecycle>` folder path (the migrated-away dir). */
const PRDS_FOLDER =
	/work\/prds(?:\/|\b)|(?:^|[^A-Za-z0-9_/-])prds\/(?:proposed|ready|tasked|dropped)\b/;

// ───────────────────────────────────────────────────────────────────────────
// The DOUBLY-RETIRED `brief` word (the `spec → brief → spec` thrash's remnant).
// The bi-word gate: a standalone artifact-word `brief`/`BRIEF`/`Brief` in a
// LIVING DOC (not a `work/**` body, per `isWorkItemBody`) is a leak, UNLESS it
// is English, a namespace/slug identity, or a code-span/marker reference.
// ───────────────────────────────────────────────────────────────────────────

const BRIEF_HIT = /[Bb][Rr][Ii][Ee][Ff]/g;

/**
 * GENUINE-ENGLISH `brief` compounds/inflections that are NOT the retired
 * artifact word (unlike `prd`, `brief` is a real English word). A keep-case
 * word-replace must never mangle these: `debrief`, `briefly`, `briefing`,
 * `briefcase`, and the adjective/verb `brief` in "a brief note"/"brief the team".
 * The `debrief`/`briefly`/`briefing`/`briefcase` forms are caught by the
 * word-boundary rule (a letter glued after `brief`); the bare adjective/verb
 * "brief" in prose is admitted by the SURROUNDING-WORD heuristic below.
 */
// NOTE the deliberate ASYMMETRY vs `prd` (which had ZERO English collisions):
// bare "a brief" is the retired NOUN (the artifact) and MUST flag; "a brief
// <noun>" ("a brief note", "a brief summary") is the English ADJECTIVE and is
// exempt. So the adjective is admitted only when a following noun disambiguates
// it — never bare "a brief".
const BRIEF_ENGLISH_CONTEXT =
	/\bbrief (?:note|mention|summary|overview|description|moment|window|pause|comment|aside|recap|list|explanation|paragraph|sentence)\b|\bbe brief\b|\bbrief the\b|, brief,/i;

/**
 * Is the `brief`/`Brief`/`BRIEF` hit at `idx` on `line` an ALLOWED survivor (not
 * a leak)? camelCase/inflection boundary (English `debrief`/`briefly`/… +
 * historical API names), the `brief:`/`brief-` namespace + `task-brief` rung /
 * `brief-tasked` folder forms, the enumerated slug identities, and genuine
 * English adjective/verb `brief`.
 */
function isAllowedBriefHit(line: string, idx: number, lower: string): boolean {
	const before = line[idx - 1] ?? '';
	const after = line[idx + 5] ?? '';
	// camelCase / snake / inflection (a letter/digit/_ glued either side) →
	// `debrief`, `briefly`, `briefing`, `briefcase`, `debriefing`, a `BriefBody`
	// symbol: not a standalone artifact word.
	if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) return true;
	// `brief:` (namespace prefix) / `brief-` (lock/folder/rung: `brief-<slug>`,
	// `brief-tasked`) / `brief/` (legacy folder). A HEAD-of-hyphen/colon/slash form
	// is the retired NAMESPACE identity the tooling/records still carry, not the
	// artifact NOUN.
	if (after === ':' || after === '-' || after === '/') return true;
	// `task-brief` rung / `spec→brief` / `prd-<slug> → brief-<slug>` cutover
	// narration: the `brief` is TAILED to a hyphen construct or an arrow — a token
	// reference. Covered by a slug on the line, or the `-brief`/`→ brief` context.
	if (before === '-') return true;
	if (slugCovers(line, lower)) return true;
	// Genuine English adjective/verb `brief` ("a brief note", "brief the team").
	if (BRIEF_ENGLISH_CONTEXT.test(line)) return true;
	return false;
}

/**
 * Blank out markdown CODE spans on a single line (inline `` `…` `` spans) AND
 * the ''…'' PROVENANCE-MARKER spans, REPLACING each span's characters with
 * spaces so column indices are preserved for accurate leak-line reporting. A
 * `prd` inside a code span is a token/example reference (preserve #6), so the
 * bare-WORD lens runs over the returned PROSE-only text. The ''…''
 * (double-single-quote) form is the same uniquely-greppable RETIRED-TOKEN
 * provenance marker the src-prose scan strips (a `grep "''prd''"` handle for the
 * narrate-the-removal mentions), treated identically to a backtick span.
 * (Fenced-code blocks are stripped by the caller, which tracks the ``` fence
 * state across lines.)
 */
function stripInlineCode(line: string): string {
	return line
		.replace(/''[^']*''/g, (span) => ' '.repeat(span.length))
		.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
}

function fileLeaks(rel: string, text: string): Leak[] {
	if (isProvenanceFile(rel)) return []; // a prd-cutover doc quoting the retired word
	const leaks: Leak[] = [];
	const lines = text.split('\n');
	let inFence = false;
	lines.forEach((line, i) => {
		// Track ``` fenced-code blocks: their body is code/example territory
		// (preserve #6) for the bare-WORD lens — but the FOLDER-PATH lens still
		// runs on every line (a migrated-away path is a leak anywhere).
		const isFenceMarker = /^\s*```/.test(line);

		// (a) FOLDER PATH `work/prds/…` / `prds/<lifecycle>` on the RAW line (never
		//     on the allow-list — the command MOVES these dirs; must read specs/).
		if (PRDS_FOLDER.test(line)) {
			leaks.push({
				file: rel,
				line: i + 1,
				token: (line.match(PRDS_FOLDER) ?? ['prds/'])[0].trim(),
				why: 'migrated-away work/prds/ (or prds/<lifecycle>) folder path — must read work/specs/',
			});
		}

		if (isFenceMarker) {
			inFence = !inFence;
			return;
		}
		// (b) STANDALONE artifact WORD prd/Prd/PRD outside the allow-list — judged
		//     over PROSE ONLY (inline-code spans blanked; fenced-code skipped), so a
		//     token/example reference in code is not a live-noun leak (preserve #6).
		if (inFence) return;
		const prose = stripInlineCode(line);
		let m: RegExpExecArray | null;
		PRD_HIT.lastIndex = 0;
		while ((m = PRD_HIT.exec(prose))) {
			const idx = m.index;
			const tok = prose.slice(idx, idx + 3);
			if (
				isAllowedWordHit(prose, idx, tok.toLowerCase(), isTerminalHistory(rel))
			)
				continue;
			leaks.push({
				file: rel,
				line: i + 1,
				token: tok,
				why: 'standalone artifact-word prd/PRD/Prd — must read spec (or be an enumerated slug/alias)',
			});
		}
		// (c) BI-WORD: the doubly-retired artifact WORD brief/Brief/BRIEF, gated in
		//     LIVING DOCS ONLY (a `work/**` body's `brief` is provenance narration —
		//     see `isWorkItemBody`; `docs/adr/**` IS gated, its sweep is done). English
		//     / namespace / slug survivors allowed.
		if (!isWorkItemBody(rel)) {
			BRIEF_HIT.lastIndex = 0;
			while ((m = BRIEF_HIT.exec(prose))) {
				const idx = m.index;
				const tok = prose.slice(idx, idx + 5);
				if (isAllowedBriefHit(prose, idx, tok.toLowerCase())) continue;
				leaks.push({
					file: rel,
					line: i + 1,
					token: tok,
					why: 'standalone artifact-word brief/BRIEF/Brief in a living doc — the doubly-retired word must read spec (or be English / an enumerated slug / a namespace form)',
				});
			}
		}
	});
	return leaks;
}

function relTo(file: string): string {
	return relative(REPO_ROOT, file);
}

function formatLeaks(leaks: Leak[]): string {
	return leaks
		.map((l) => `  ${l.file}:${l.line}: '${l.token}' — ${l.why}`)
		.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Tests.
// ───────────────────────────────────────────────────────────────────────────

describe('prd → spec WORD cutover leak scan — the tree-wide prose/path GATE', () => {
	it('the leak lens is non-vacuous (detector self-check)', () => {
		// A standalone artifact word + a migrated-away folder path MUST flag.
		const bad = [
			'The prd is a north-star doc.', // bare word
			'lives in `work/prds/ready/`', // folder path
			'a prd-level concern', // prose compound (prd-<word>, not a slug)
			'PRD advance-loop, US #27', // upper bare word
		].join('\n');
		const badLeaks = fileLeaks('probe.md', bad);
		expect(badLeaks.some((l) => l.token === 'prd')).toBe(true);
		expect(badLeaks.some((l) => l.token === 'PRD')).toBe(true);
		expect(badLeaks.some((l) => /prds\//.test(l.token))).toBe(true);

		// A migrated-away folder path in a CODE span is STILL a leak (the
		// folder-path lens runs on the raw line), but a fenced example is skipped
		// by the bare-WORD lens — so a fenced `work/prds/` line flags on the PATH,
		// while a fenced bare-word `prd` does not.
		expect(fileLeaks('f.md', '```\nwork/prds/ready/\n```').length).toBe(1);
		expect(fileLeaks('f.md', '```\na prd example line\n```')).toEqual([]);

		// The PRESERVE survivors must NOT flag.
		const good = [
			"Set each task's `spec:` field (`prd:` in backticks is stripped).", // backticked token ref (preserve #6)
			'dispatch a `do spec:<slug>` tasking run', // the live verb
			'the `renderPrdBody` symbol / `prdTitle` field', // camelCase historical API
			'ref glob `prd-*`; `refs/dorfl/lock/prd-<slug>`; `work/prd-<slug>`', // namespace forms
			'migration map: `work/prd/` -> `work/specs/ready/`', // legacy flat folder
			'the taxonomy note flags `prd-tasked` as awkward', // legacy folder name
			'the spec `prd-to-spec-vocabulary-cutover-and-migration-command`', // slug identity
			'see `folder-taxonomy-and-prd-edit-handshake`', // slug identity
			'the whole `spec` lifecycle lives in `work/specs/`', // the live spelling
			'name the retired token `prd` / `PRD` in inline code (a meta-doc)', // code-span token reference
			'cite `prd-body` / `prd-level` AS an example inside code', // code-span example
			"name the retired token ''prd'' / ''prd:'' in the '' … '' provenance marker", // marker span
		].join('\n');
		expect(fileLeaks('good.md', good)).toEqual([]);

		// The ''…'' PROVENANCE MARKER is stripped like a backtick span, but a BARE
		// `prd` (no marker) on the SAME line still FAILS (span-scoped, not line-scoped).
		expect(
			fileLeaks('n.md', "the ''prd:'' key names the retired prd artifact").some(
				(l) => l.token === 'prd',
			),
		).toBe(true);

		// HARD CUTOVER + PROVENANCE: a NON-backticked `prd:` in a TERMINAL-HISTORY
		// body stays exempt (this WORD scan walks immutable history where `prd:`
		// RECORDS the dead field/verb as-was); rewriting it would falsify the record.
		expect(
			fileLeaks('work/tasks/done/x.md', 'Fixed at launch in the prd: ...'),
		).toEqual([]);
		expect(
			fileLeaks('work/tasks/done/x.md', 'Route do prd:<slug> output ...'),
		).toEqual([]);

		// but the SAME `prd:` / `do prd:` reference in a LIVING doc IS a leak (the
		// hard cutover killed the field/verb; a living doc must read `spec:`/`do
		// spec:`). This is the distinction the terminal-history scoping enforces.
		expect(
			fileLeaks('CONTEXT.md', 'a task\u2019s prd: field points at').length,
		).toBe(1);
		expect(
			fileLeaks('docs/x.md', 'Route do prd:<slug> output ...').length,
		).toBe(1);

		// BI-WORD: the doubly-retired artifact word `brief`/`BRIEF`/`Brief` in a
		// LIVING doc FAILS the scan (a `spec`-only scan would have passed it).
		expect(
			fileLeaks('CONTEXT.md', 'author a brief and then task it').some(
				(l) => l.token === 'brief',
			),
		).toBe(true);
		expect(
			fileLeaks('skills/x/SKILL.md', 'the BRIEF is the north-star doc').some(
				(l) => l.token === 'BRIEF',
			),
		).toBe(true);

		// `brief` survivors that must NOT flag in a living doc: English, namespace/
		// slug/rung forms, code-span + ''…'' marker references.
		const goodBrief = [
			'add a brief note near the relevant code', // English adjective
			'debrief the run; answer briefly in a briefing', // English inflections
			'the `brief:<slug>` namespace / `brief-<slug>` lock entry', // namespace forms
			'the `task-brief` rung / a `brief-tasked` terminal folder', // rung + folder
			'the slug `code-identifier-slice-prd-to-task-brief-rename`', // slug identity
			"the old ''brief'' vocabulary is retired (marker span)", // ''…'' marker
			'name the retired `brief` token in inline code', // code-span reference
		].join('\n');
		expect(fileLeaks('docs/x.md', goodBrief)).toEqual([]);

		// PROVENANCE: the SAME artifact-word `brief` in a `work/**` BODY (active OR
		// terminal) is exempt — the body narrates a dated incident under the retired
		// vocabulary; rewriting would falsify it. (`prd` keeps its stricter split.)
		expect(
			fileLeaks('work/tasks/ready/x.md', 'landed under the original brief'),
		).toEqual([]);
		expect(
			fileLeaks('work/tasks/done/x.md', 'task or brief seeded in backlog/'),
		).toEqual([]);
	});

	it('the walk reaches a representative spread (exhaustive-by-construction)', () => {
		const files = scannedFiles();
		expect(files.length).toBeGreaterThan(100);
		expect(files.some((f) => f === CONTEXT_MD)).toBe(true);
		expect(files.some((f) => relTo(f).startsWith(join('docs', 'adr')))).toBe(
			true,
		);
		expect(
			files.some((f) => relTo(f).startsWith(join('work', 'tasks', 'done'))),
		).toBe(true);
		expect(files.some((f) => relTo(f).startsWith(join('work', 'specs')))).toBe(
			true,
		);
		expect(files.some((f) => relTo(f).startsWith('skills'))).toBe(true);
		// It must NOT descend into the protocol source or the mirror.
		expect(
			files.some((f) =>
				relTo(f).startsWith(join('skills', 'setup', 'protocol')),
			),
		).toBe(false);
		expect(
			files.some((f) => relTo(f).startsWith(join('work', 'protocol'))),
		).toBe(false);
	});

	it('NO standalone artifact-word prd/PRD/Prd and NO work/prds/ path outside the PRESERVE allow-list', () => {
		const leaks: Leak[] = [];
		for (const file of scannedFiles()) {
			leaks.push(...fileLeaks(relTo(file), readFileSync(file, 'utf8')));
		}
		expect(
			leaks,
			leaks.length === 0
				? ''
				: `WORD leak-scan: the artifact word 'prd'/'PRD' or a work/prds/ folder ` +
						`path leaked OUTSIDE the concrete PRESERVE allow-list — the prd→spec ` +
						`WORD cutover is NOT complete (sweep it to 'spec'/'work/specs/', or ` +
						`add a JUSTIFIED slug/alias if it is a genuine identity):\n${formatLeaks(
							leaks,
						)}`,
		).toEqual([]);
	});

	it('the PRESERVE allow-list is concrete + non-vacuous (every entry names a real prd identity)', () => {
		// Every enumerated slug really contains the retired word (a file identity).
		for (const slug of PRESERVE_SLUGS) {
			expect(/prd/i.test(slug), slug).toBe(true);
		}
		// And it is load-bearing: at least one enumerated slug is present in a
		// scanned file (removing the list would flag real identities).
		const anyPresent = scannedFiles().some((f) => {
			const text = readFileSync(f, 'utf8');
			return PRESERVE_SLUGS.some((s) => text.includes(s));
		});
		expect(anyPresent).toBe(true);
		// The PROVENANCE-FILE exemption is non-vacuous too: each named basename is a
		// real file in the tree that WOULD flag without the exemption (it quotes the
		// retired word in prose).
		const files = scannedFiles();
		for (const base of PROVENANCE_FILE_BASENAMES) {
			const hit = files.find((f) => relTo(f).endsWith(base));
			expect(hit, `provenance file missing: ${base}`).toBeTruthy();
			if (hit) {
				expect(/prd/i.test(readFileSync(hit, 'utf8')), base).toBe(true);
			}
		}
	});
});

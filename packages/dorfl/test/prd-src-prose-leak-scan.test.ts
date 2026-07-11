import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The `prd` → `spec` WORD cutover leak-scan GATE for `packages/dorfl/src`
 * COMMENT/JSDoc PROSE and LIVE runtime + agent-prompt STRINGS (spec
 * `prd-to-spec-vocabulary-cutover-and-migration-command`, task
 * `sweep-prd-artifact-word-in-src-prose-and-runtime-strings`). This is the THIRD
 * sibling of the two existing scans:
 *
 *   - `prd-to-spec-leak-scan.test.ts` (the SOURCE-part IDENTIFIER scan) gates
 *     CODE tokens but deliberately EXEMPTS prose (comments/strings).
 *   - `prd-word-cutover-leak-scan.test.ts` (the WORD scan) gates the artifact
 *     WORD in the human-readable TREES (`CONTEXT.md`/`docs`/`skills`/`work/**`)
 *     but does NOT walk `packages/dorfl/src` at all.
 *
 * So the artifact WORD `prd`/`PRD`/`Prd` (and the doubly-retired `brief` — the
 * gate is BI-WORD, since a `spec`-only scan would pass a stray `brief`) in `src`
 * doc-comment PROSE and the `work/prds/…` FOLDER PATH inside `src`
 * runtime/agent-prompt STRINGS silently survived both gates (see
 * `work/notes/observations/advance-lifecycle-template-src-prose-still-says-prd-
 * 2026-07-10.md`). THIS scan closes that hole: it walks `packages/dorfl/src/*.ts`
 * and, over the PROSE positions the other two skip (comment/JSDoc text +
 * string-literal content), FAILS on a standalone artifact-word `prd`/`PRD`/`Prd`
 * or a migrated-away `work/prds/`/`prds/<lifecycle>` path OUTSIDE the concrete
 * code-alias allow-list — so `src` prose + runtime strings can never re-drift.
 *
 * # WHAT IS PROSE HERE (the cut vs the identifier scan)
 *
 * The identifier scan strips comments and judges CODE tokens; THIS scan does the
 * INVERSE: it strips the CODE and judges the COMMENT text + the STRING-literal
 * content (the two prose positions the identifier scan exempts). A `prd`-carrying
 * CODE IDENTIFIER (`prdsLandIn`, `PrdToSpecOptions`, the `Frontmatter.prd` field)
 * is the identifier scan's territory and is NOT judged here — this scan only ever
 * looks at comment prose and string content.
 *
 * # THE PRESERVE ALLOW-LIST (concrete, each class JUSTIFIED)
 *
 * After the HARD CUTOVER (task
 * `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`) there is NO
 * `prd:` field/verb back-compat alias to exempt: the `parseFrontmatter` `prd:`
 * KEY read is GONE and the `do prd:`/`advance prd:` verb refs are flipped to
 * `spec`. So a stray `prd:` field-key or `do prd:` verb in src prose OUTSIDE the
 * migration command + provenance allow-list is now a LEAK the scan FAILS on. The
 * only legitimate `prd`/`prd:` survivors are:
 *
 *   1. **The inert NAMESPACE / lock-ref forms** — `refs/dorfl/lock/prd-<slug>` /
 *      `work/prd-<slug>` (branch) / `prd-<slug>` (lock/sidecar) / `prd-*` (a ref
 *      glob): the `prd-`-hyphen constructs the tooling still writes/reads on-disk
 *      for un-migrated data (the file-path DATA alias the migration command
 *      converts, NOT the `prd:` field/verb). These are `prd-<…>` HEAD-of-hyphen
 *      forms, never the bare word or a `prd:` prefix.
 *   2. **camelCase / PascalCase / snake_case historical API names** — a
 *      `renderPrdBody` / `prdTitle` / `prd_flag` mention in a comment is the NAME
 *      of a (possibly renamed) symbol. Covered by the word-boundary rule (a
 *      `prd`/`Prd` glued to a letter/digit/`_` is not a standalone word).
 *   3. **Slug identities / provenance** — a `prd`-containing hyphenated slug that
 *      names a landed file / a cross-reference. Enumerated in {@link
 *      PRESERVE_SLUG_SUBSTRINGS}; `prd-to-spec` is the migration command's own
 *      published name.
 *   4. **The migration ENGINE's own data territory** — `src/prd-to-spec.ts` (the
 *      `dorfl prd-to-spec` command that MIGRATES `work/prds/* → work/specs/*`)
 *      and the `prd-to-spec` CLI-command description in `cli.ts` legitimately NAME
 *      the legacy `work/prds/…` folder as the migration SOURCE. That module +
 *      that one command block are exempt (they are the command's data territory,
 *      the same carve-out the identifier scan makes for `prd-to-spec.ts`).
 *   5. **Legacy FLAT-layout folder names** — `work/prd/`, `pre-prd/`,
 *      `prd-tasked` (the OLD on-disk folder names a migration MAP names as the
 *      rename SOURCE). Covered by the namespace-form rule.
 *   6. **English** — `prd` is a coined acronym with ZERO English false-positives,
 *      so there is no English allow-list to carry.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(here, '..', 'src');
const REPO_ROOT = join(here, '..', '..', '..');

// ───────────────────────────────────────────────────────────────────────────
// The concrete PRESERVE allow-list.
// ───────────────────────────────────────────────────────────────────────────

/**
 * IMMUTABLE PROVENANCE SLUG substrings that permanently carry the retired word
 * (they name a landed task/spec/observation) + this cutover's own
 * `prd-to-spec`/`rename-spec` slugs. Matched as a whole-token substring of a
 * longer slug on the line: a `prd `<slug>`` doc-comment attribution keeps the
 * slug (only the free word `prd`/`PRD` around it flips to `spec`/`SPEC`).
 */
const PRESERVE_SLUG_SUBSTRINGS: readonly string[] = [
	// This cutover's own chain + its purpose-named verb.
	'prd-to-spec',
	'rename-spec',
	'preisolate-spec',
	'contract-spec',
	// Landed task/spec slug identities present in src doc-comments (a `prd \`<slug>\``
	// attribution keeps the slug; only the free word around it flips).
	'pre-prd-staging-pool-split-and-untrusted-prd-placement',
	'explicit-do-prd-not-gated-by-autoslice',
	'intake-lone-task-skips-adversarial-review-the-prd-path-gets',
	'folder-taxonomy-and-prd-edit-handshake',
	'shared-buildable-task-and-prd-body-renderer-extract',
	'prd-complete-query',
	'prd-sliced-folder-step-a',
	'tasked-prd-needsanswers-sidecar-stranded-no-apply-pool',
	'tasking-lock-does-not-stabilise-prd-content',
	'ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices',
];

/**
 * The migration ENGINE + the one CLI command block that legitimately name the
 * legacy `work/prds/…` folder as the migration SOURCE. These are the command's
 * DATA territory (ADR §7e: the purpose-named `dorfl prd-to-spec` verb), NOT a
 * re-drift. `prd-to-spec.ts` is exempt WHOLE; in `cli.ts` only the
 * `prd-to-spec`-command description + report block is exempt (see
 * {@link isInPrdToSpecCommandBlock}).
 */
function isMigrationEngineFile(rel: string): boolean {
	return rel.endsWith(join('src', 'prd-to-spec.ts'));
}

/**
 * Blank out markdown-style inline-code spans (`` `…` ``) AND the ''…''
 * PROVENANCE-MARKER spans on a line, preserving column positions with spaces. A
 * `prd`/`PRD` inside a `` `…` `` span in a doc-comment / prompt string is a TOKEN
 * reference (the retired token named in backticks, e.g. "the legacy `prd` outcome
 * is GONE", a `` `prd-body` `` example), NOT the live artifact NOUN — the SAME
 * "judge prose, exempt code spans" cut the WORD scan (preserve #6) applies.
 *
 * The ''…'' (double-single-quote) form is a DELIBERATE, uniquely-greppable
 * PROVENANCE MARKER this cutover writes around the RETIRED token in
 * narrate-the-removal comments (e.g. "the legacy ''prd:'' KEY read is GONE"): a
 * distinct marker from ordinary backticks (which appear ~40× in src) so a
 * maintainer can `grep "''prd''"` for exactly the "named here only as retired
 * provenance" mentions. Treated identically to a backtick span (a token
 * reference, not the live noun). The FOLDER-PATH lens still runs on the RAW line,
 * so a migrated-away `work/prds/` inside either span is STILL caught.
 */
function stripInlineCode(line: string): string {
	return line
		.replace(/''[^']*''/g, (span) => ' '.repeat(span.length))
		.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/** Does an enumerated PRESERVE slug appear on this line? */
function slugCovers(line: string): boolean {
	return PRESERVE_SLUG_SUBSTRINGS.some((slug) => line.includes(slug));
}

/**
 * Is the `prd`/`Prd`/`PRD` hit at `idx` on `line` an ALLOWED survivor (a code
 * alias / historical identifier / slug identity), not a leak? Same lens as the
 * WORD scan's `isAllowedWordHit`.
 */
function isAllowedWordHit(line: string, idx: number): boolean {
	const before = line[idx - 1] ?? '';
	const after = line[idx + 3] ?? '';
	// camelCase / PascalCase / snake_case → not a standalone word (historical API
	// names like renderPrdBody, prdTitle, prd_flag, prdsLandIn).
	if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) return true;
	// HARD CUTOVER: a `prd:`-prefixed token is NO LONGER exempt — the `prd:`
	// field-key read is gone and the `do prd:`/`advance prd:` verb refs are flipped
	// to `spec`, so a stray `prd:` in prose is a leak (fall through to the leak).
	// The NAMESPACE / legacy-folder forms: `prd-<…>` (lock/sidecar/branch glob),
	// `prd/` (legacy flat folder). Only a `prd` that is the HEAD of a
	// hyphen/slash construct — the bare word `prd` never survives here.
	if (after === '-' || after === '/') {
		if (slugCovers(line)) return true;
		const ctx = line.slice(Math.max(0, idx - 28), idx + 28);
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
	// A truly bare word `prd`/`PRD`: allowed ONLY if an enumerated slug on the
	// line covers it (a provenance attribution).
	return slugCovers(line);
}

// ───────────────────────────────────────────────────────────────────────────
// BI-WORD: the doubly-retired `brief` word in src PROSE. Same lens as the WORD
// scan's `isAllowedBriefHit` (English inflection/adjective, `brief:`/`brief-`
// namespace + rung/folder forms, an enumerated slug). `brief` is gated in ALL
// src prose (there is no `work/**`-body provenance carve-out inside `src`).
// ───────────────────────────────────────────────────────────────────────────
const BRIEF_HIT = /[Bb][Rr][Ii][Ee][Ff]/g;
const BRIEF_ENGLISH_CONTEXT =
	/\bbrief (?:note|mention|summary|overview|description|moment|window|pause|comment|aside|recap|list|explanation|paragraph|sentence)\b|\bbe brief\b|\bbrief the\b|, brief,/i;

function isAllowedBriefHit(line: string, idx: number): boolean {
	const before = line[idx - 1] ?? '';
	const after = line[idx + 5] ?? '';
	// English inflection / camelCase (a letter/digit/_ glued either side): `debrief`,
	// `briefly`, `briefing`, `briefcase`, a `BriefBody` symbol.
	if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) return true;
	// `brief:` / `brief-` / `brief/` namespace, `task-brief` rung: HEAD/TAIL of a
	// hyphen/colon/slash construct — the retired identity, not the artifact noun.
	if (after === ':' || after === '-' || after === '/' || before === '-')
		return true;
	if (slugCovers(line)) return true;
	// Genuine English adjective/verb `brief`.
	return BRIEF_ENGLISH_CONTEXT.test(line);
}

// ───────────────────────────────────────────────────────────────────────────
// TS tokenizer: split into CODE spans (comments removed) vs COMMENT + STRING
// spans (the PROSE positions). Mirrors the identifier scan's hand-tokenizer,
// but it KEEPS the comment/string text (that scan discards comments).
// ───────────────────────────────────────────────────────────────────────────

interface ProseToken {
	line: number;
	kind: 'comment' | 'string';
	value: string;
}

/**
 * Extract only the PROSE spans from a TS source: comment bodies (`//` and
 * `/* … *\/`, incl. JSDoc) and string/template-literal content, each tagged with
 * its 1-based start line. CODE tokens are DELIBERATELY dropped — they are the
 * identifier scan's territory.
 */
function proseTokens(src: string): ProseToken[] {
	const out: ProseToken[] = [];
	let i = 0;
	let line = 1;
	const n = src.length;
	while (i < n) {
		const c = src[i];
		const d = src[i + 1];
		if (c === '\n') {
			line++;
			i++;
			continue;
		}
		if (c === '/' && d === '/') {
			const startLine = line;
			let buf = '';
			i += 2;
			while (i < n && src[i] !== '\n') {
				buf += src[i];
				i++;
			}
			out.push({line: startLine, kind: 'comment', value: buf});
			continue;
		}
		if (c === '/' && d === '*') {
			const startLine = line;
			let buf = '';
			i += 2;
			while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
				if (src[i] === '\n') line++;
				buf += src[i];
				i++;
			}
			i += 2;
			out.push({line: startLine, kind: 'comment', value: buf});
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			const delim = c;
			const startLine = line;
			let buf = '';
			i++;
			while (i < n && src[i] !== delim) {
				if (src[i] === '\\') {
					buf += src[i] + (src[i + 1] ?? '');
					i += 2;
					continue;
				}
				if (src[i] === '\n') line++;
				buf += src[i];
				i++;
			}
			i++;
			out.push({line: startLine, kind: 'string', value: buf});
			continue;
		}
		i++;
	}
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Tree walk.
// ───────────────────────────────────────────────────────────────────────────

function collectTs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			out.push(...collectTs(full));
		} else if (entry.name.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// The leak lens (WORD + folder path over PROSE spans, minus the allow-list).
// ───────────────────────────────────────────────────────────────────────────

interface Leak {
	file: string;
	line: number;
	token: string;
	why: string;
}

const PRD_HIT = /[Pp][Rr][Dd]/g;
/** `work/prds/…` or bare `prds/<lifecycle>` folder path (the migrated-away dir). */
const PRDS_FOLDER =
	/work\/prds(?:\/|\b)|(?:^|[^A-Za-z0-9_/-])prds\/(?:proposed|ready|tasked|dropped)\b/;

/**
 * Is this STRING-literal's WHOLE content a CODE-VALUE alias token the code
 * legitimately matches (NOT prose)? After the HARD CUTOVER the `'prd'` /
 * `'prd:'` field/verb value tokens are GONE (no `key === 'prd'`, no `case 'prd'`,
 * no `do prd:` dispatch), so they are NO LONGER exempt — the surviving whole-value
 * aliases are the inert `prd-<…>` NAMESPACE / lock-ref forms the tooling still
 * reads on-disk for un-migrated data: a `'prd-<…>'` / `'work/prd-<…>'` ref, a
 * `'prd-*'` glob. These are the identifier scan's territory (a whole-literal code
 * token), so this PROSE scan must NOT flag them. The distinction from a prose
 * STRING is decisive: a prose string CONTAINS `prd` as a word amid other text; a
 * code-value literal IS the token in its entirety.
 */
function isWholeAliasLiteral(value: string): boolean {
	const v = value.trim();
	return (
		/^prd-(?:<|\$\{|\*|tasked|slug|name)/.test(v) ||
		/^work\/prd-/.test(v) ||
		/^refs\/dorfl\/lock\/prd-/.test(v) ||
		v === 'prd-*'
	);
}

function relTo(file: string): string {
	return relative(REPO_ROOT, file);
}

function fileLeaks(rel: string, text: string): Leak[] {
	if (isMigrationEngineFile(rel)) return []; // migration engine's data territory
	const leaks: Leak[] = [];
	const inCli = rel.endsWith(join('src', 'cli.ts'));
	for (const tok of proseTokens(text)) {
		// A string literal whose WHOLE content is a code-value alias token is the
		// identifier scan's territory (the published `prd:` field/verb/namespace
		// back-compat aliases), NOT prose — never a leak here.
		if (tok.kind === 'string' && isWholeAliasLiteral(tok.value)) continue;
		// Each prose token may span multiple lines; judge line-by-line for accurate
		// leak lines.
		const spanLines = tok.value.split('\n');
		spanLines.forEach((lineText, offset) => {
			const lineNo = tok.line + offset;
			// The `prd-to-spec` CLI-command block in cli.ts legitimately names the
			// legacy folder as the migration source (carve-out #4).
			if (inCli && isInPrdToSpecCommandLine(lineText)) return;

			// (a) FOLDER PATH `work/prds/…` / `prds/<lifecycle>` — the migrated-away
			//     dir; never on the allow-list (must read work/specs/).
			if (PRDS_FOLDER.test(lineText)) {
				leaks.push({
					file: rel,
					line: lineNo,
					token: (lineText.match(PRDS_FOLDER) ?? ['prds/'])[0].trim(),
					why: 'migrated-away work/prds/ (or prds/<lifecycle>) path in src prose/string — must read work/specs/',
				});
			}
			// (b) STANDALONE artifact WORD prd/Prd/PRD outside the allow-list, judged
			//     over PROSE ONLY (inline-code `…` spans blanked — a backticked token
			//     reference is not the live noun, preserve #6).
			const prose = stripInlineCode(lineText);
			let m: RegExpExecArray | null;
			PRD_HIT.lastIndex = 0;
			while ((m = PRD_HIT.exec(prose))) {
				const idx = m.index;
				const t = prose.slice(idx, idx + 3);
				if (isAllowedWordHit(prose, idx)) continue;
				leaks.push({
					file: rel,
					line: lineNo,
					token: t,
					why: 'standalone artifact-word prd/PRD/Prd in src prose/string — must read spec (or be an enumerated slug/alias)',
				});
			}
			// (c) BI-WORD: the doubly-retired artifact word brief/Brief/BRIEF in src
			//     prose (English / namespace / slug survivors allowed).
			BRIEF_HIT.lastIndex = 0;
			while ((m = BRIEF_HIT.exec(prose))) {
				const idx = m.index;
				const t = prose.slice(idx, idx + 5);
				if (isAllowedBriefHit(prose, idx)) continue;
				leaks.push({
					file: rel,
					line: lineNo,
					token: t,
					why: 'standalone artifact-word brief/BRIEF/Brief in src prose/string — the doubly-retired word must read spec (or be English / a namespace form / an enumerated slug)',
				});
			}
		});
	}
	return leaks;
}

/**
 * Is this line part of the `prd-to-spec` CLI command's description/report block
 * in `cli.ts` (carve-out #4)? A cheap heuristic: the line names the migration
 * verb `prd-to-spec` (its `.command('prd-to-spec')`, its description mentioning
 * the verb) so its `work/prds/*` source-folder mentions are the command's data
 * territory. The `console.log` report lines carry the verb banner `prd-to-spec`.
 */
function isInPrdToSpecCommandLine(line: string): boolean {
	// The verb name itself (its `.command('prd-to-spec')`, report banners, its
	// description mentioning the verb).
	if (/prd-to-spec/.test(line)) return true;
	// The migration COMMAND's `--help` DESCRIPTION string (cli.ts) legitimately
	// names the legacy `work/prds/*` folder as the migration SOURCE: a
	// single-line string whose banner is "Migrate THIS repo's work/ DATA". Anchor
	// on that banner so the desc's `work/prds/*` mentions are the command's data
	// territory (carve-out #4), not a re-drift.
	return /Migrate THIS repo's work\/ DATA/.test(line);
}

function formatLeaks(leaks: Leak[]): string {
	return leaks
		.map((l) => `  ${l.file}:${l.line}: '${l.token}' — ${l.why}`)
		.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Tests.
// ───────────────────────────────────────────────────────────────────────────

describe('prd → spec src PROSE + runtime-string leak scan', () => {
	it('the leak lens is non-vacuous (detector self-check)', () => {
		// A standalone artifact word + a migrated-away folder path in prose/strings
		// MUST flag.
		const bad = [
			'/** A PRD is a north-star doc. */',
			"const help = 'writes the prd file (work/prds/ready/<slug>.md)';",
			'// a prd-level concern (prose compound, not a slug)',
		].join('\n');
		const badLeaks = fileLeaks('src/probe.ts', bad);
		expect(badLeaks.some((l) => l.token === 'PRD')).toBe(true);
		expect(badLeaks.some((l) => l.token === 'prd')).toBe(true);
		expect(badLeaks.some((l) => /prds\//.test(l.token))).toBe(true);

		// The PRESERVE survivors must NOT flag. (A backticked `prd:` / `do prd:`
		// TOKEN reference is stripped by the inline-code lens — preserve #6 — so it is
		// not a WORD leak even after the hard cutover; only a NON-backticked `prd:` in
		// prose leaks. See the hard-cutover self-check below.)
		const good = [
			'// a `prd:`-token reference in backticks is stripped (preserve #6)',
			'// dispatch a `do spec:<slug>` tasking run; ref glob `prd-*`',
			'// the `renderPrdBody` symbol / `prdTitle` field / `prdsLandIn` key',
			'// inert lock-ref `refs/dorfl/lock/prd-<slug>`; branch `work/prd-<slug>`',
			'// migration map: `work/prd/` -> `work/specs/ready/`; `pre-prd/` legacy',
			'// spec `prd-to-spec-vocabulary-cutover-and-migration-command`',
			"const desc = 'the spec lifecycle lives in work/specs/ready/';",
			'// the slug `folder-taxonomy-and-prd-edit-handshake` names a landed file',
			'// a `prd`-token reference in backticks is preserved (the retired token)',
			"// the legacy ''prd:'' KEY read is GONE (''…'' provenance marker, preserve #6)",
			"// the verdict outcome renamed from ''prd'' to 'spec' (marker stripped)",
		].join('\n');
		expect(fileLeaks('src/good.ts', good)).toEqual([]);

		// The ''…'' PROVENANCE MARKER is stripped exactly like a backtick span, but a
		// BARE `prd` (no marker/backtick) on the SAME line still FAILS — the marker
		// exemption is span-scoped, not line-scoped.
		expect(
			fileLeaks('src/mk.ts', "// the ''prd:'' key is a prd concept").some(
				(l) => l.token === 'prd',
			),
		).toBe(true);

		// BI-WORD: the doubly-retired artifact word `brief` in src prose FAILS (a
		// `spec`-only scan would pass it); English / namespace / slug forms do not.
		expect(
			fileLeaks('src/b.ts', '// the brief is the north-star doc').some(
				(l) => l.token === 'brief',
			),
		).toBe(true);
		expect(
			fileLeaks(
				'src/b.ts',
				[
					'// add a brief note; debrief; answer briefly in a briefing',
					'// the `brief:<slug>` namespace / `brief-<slug>` entry / `task-brief` rung',
					"// the old ''brief'' vocabulary is retired",
				].join('\n'),
			),
		).toEqual([]);

		// HARD CUTOVER: the `prd:` field/verb alias is NO LONGER exempt. A NON-backtick
		// `prd:` field key or `do prd:` verb in prose is now a LEAK (the field read is
		// gone, the verb refs are flipped to `spec`).
		expect(
			fileLeaks('src/hc.ts', '// the prd: frontmatter key is read here').some(
				(l) => l.token === 'prd',
			),
		).toBe(true);
		expect(
			fileLeaks('src/hc.ts', '// dispatch a do prd:<slug> tasking run').some(
				(l) => l.token === 'prd',
			),
		).toBe(true);

		// A provenance-word attribution whose SLUG has no prd (`runner-in-ci`) is a
		// leak on the WORD `PRD` (it must flip to spec; the slug is untouched).
		expect(
			fileLeaks('src/x.ts', '// PRD `runner-in-ci`, task foo').some(
				(l) => l.token === 'PRD',
			),
		).toBe(true);

		// HARD CUTOVER: the whole-string `'prd'` field/verb VALUE alias is GONE (no
		// `key === 'prd'`, no `case 'prd'` dispatch), so a whole-`'prd'` literal is NO
		// LONGER exempt — it flags. Only the inert `'prd-<…>'` NAMESPACE / lock-ref
		// forms the tooling still reads on-disk survive.
		expect(
			fileLeaks('src/fm.ts', "if (key === 'prd') {}").some(
				(l) => l.token === 'prd',
			),
		).toBe(true);
		expect(
			fileLeaks('src/n.ts', "switchToWorkBranch(cwd, 'prd-<slug>', slug);"),
		).toEqual([]);

		// The migration engine file is exempt WHOLE.
		expect(
			fileLeaks(
				join('src', 'prd-to-spec.ts'),
				'// migrates work/prds/* -> work/specs/*; a PRD becomes a spec',
			),
		).toEqual([]);
	});

	it('the walk reaches a representative spread of src (exhaustive-by-construction)', () => {
		const files = collectTs(SRC_DIR);
		expect(files.length).toBeGreaterThan(40);
		expect(files.some((f) => f.endsWith(join('src', 'cli.ts')))).toBe(true);
		expect(files.some((f) => f.endsWith(join('src', 'intake.ts')))).toBe(true);
		expect(files.some((f) => f.endsWith(join('src', 'review-gate.ts')))).toBe(
			true,
		);
	});

	it('NO artifact-word prd/PRD/Prd prose and NO work/prds/ runtime string in src outside the code-alias allow-list', () => {
		const leaks: Leak[] = [];
		for (const file of collectTs(SRC_DIR)) {
			leaks.push(...fileLeaks(relTo(file), readFileSync(file, 'utf8')));
		}
		expect(
			leaks,
			leaks.length === 0
				? ''
				: `src PROSE/STRING leak-scan: the artifact word 'prd'/'PRD' or a ` +
						`work/prds/ folder path leaked in packages/dorfl/src comment prose ` +
						`or a runtime/agent-prompt string OUTSIDE the code-alias allow-list ` +
						`— the prd→spec word cutover is NOT complete in src (sweep it to ` +
						`'spec'/'work/specs/' — prefer workFolderRel('specs-*') for a path a ` +
						`string BUILDS — or add a JUSTIFIED alias/slug):\n${formatLeaks(leaks)}`,
		).toEqual([]);
	});

	it('the allow-list is concrete + non-vacuous', () => {
		// Every enumerated provenance substring really carries the retired word.
		for (const slug of PRESERVE_SLUG_SUBSTRINGS) {
			expect(/(prd|spec)/i.test(slug), slug).toBe(true);
		}
		// The migration-engine carve-out really IS load-bearing: prd-to-spec.ts
		// names the legacy folder (removing the exemption would flag it).
		const engine = readFileSync(join(SRC_DIR, 'prd-to-spec.ts'), 'utf8');
		expect(engine).toMatch(/work\/prds\//);
	});
});

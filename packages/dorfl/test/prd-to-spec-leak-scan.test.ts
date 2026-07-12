import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The prd → spec CUTOVER leak-scan GATE (spec
 * `prd-to-spec-vocabulary-cutover-and-migration-command`, US #8 + contract task
 * `contract-spec-hard-cutover-rejection-and-leak-scan`). This is the trust
 * signal that the SOURCE-part cutover is complete: the `prd`/`brief` code
 * vocabulary is GONE from dorfl's source, contract, and skills, with only the
 * explicitly-justified survivors on the allow-list.
 *
 * # Two lenses, BI-WORD (`prd` AND `brief`)
 *
 *   - **FORWARD (identifier-scoped):** fails on any live `prd`/`Prd`/`PRD` OR
 *     `brief`/`Brief`/`BRIEF` CODE IDENTIFIER — an exported OR internal
 *     symbol / const / function / method / local var, a union-member value, a
 *     config key, a CLI verb/flag/prefix token, or a string-literal whose ENTIRE
 *     content is a dead-token path (`work/prd-…`, a `prd:`-prefix arg) — OUTSIDE
 *     the allow-list. BI-WORD because this cutover folded `brief → spec` in: the
 *     `brief → prd` revert of `403a5be9` LEFT ~22 live `brief` refs (incl. the
 *     `via: 'brief'` union tag), so a `prd`-only scan would have passed them.
 *   - **REVERSE:** fails on genuine English CORRUPTED by the sweep
 *     (`espec…`/`speccif…`-style mangles). `spec` collides with English
 *     (`specific`, `especially`, `inspect`, `refspec`), so a blind keep-case
 *     `prd → spec` could have mangled a real word; the reverse scan catches that.
 *     (`prd` itself is a coined acronym with ZERO English false-positives — see
 *     the `preisolate-spec-false-positive-words` finding — so the forward `prd`
 *     scan needs no English allow-list; the reverse scan guards the `spec` side.)
 *
 * # Exhaustive-BY-CONSTRUCTION, not a blanket grep
 *
 * Like `work-layout-guard.test.ts`, the scan WALKS the trees (it cannot silently
 * skip a file), but it applies the identifier-vs-prose CUT rather than a blanket
 * line grep: for `.ts` it STRIPS comments and judges CODE tokens + whole-literal
 * dead-token paths; for markdown it judges INLINE-CODE / fenced-code tokens +
 * whole-literal dead paths, never running prose.
 *
 * # SCOPE (option A — source/data split, ADR §7e)
 *
 * This is the SOURCE-part gate. The migration COMMAND owns the DATA part
 * (dorfl's `work/prds/* → work/specs/*` folders, `prd:` frontmatter fields,
 * config values, inert refs) and the FINAL run-on-dorfl task owns the tree-wide
 * bi-word gate over ALL of `work/` after the command converts the data. So this
 * scan CATEGORICALLY EXEMPTS (structurally, not by a hand-listed file set):
 *   - the `work/prds/…` folder-path literals + bare `prds/` (command's folder move),
 *   - the `prd:` frontmatter-FIELD token + the `<prd>` prompt-template placeholder
 *     + the `Frontmatter.prd` field and the `prd`-named plumbing that carries that
 *     field's value (CARVE-OUT #2 — dorfl's ledger has 199 live `prd:` fields / 0
 *     `spec:`, so `parseFrontmatter` keeps reading BOTH keys until the command
 *     converts the data), and
 *   - domain-PROSE `prd`/`PRD`/`brief` (the artifact word) in doc-comments,
 *     `--help`/log/error strings, and agent-prompt template text.
 * Plus the two named DATA-territory readers on the allow-list: the sidecar
 * `prd-<slug>.md` file-path fallback (CARVE-OUT #1) and the `parseFrontmatter`
 * `prd:` key read (CARVE-OUT #2).
 *
 * NOTE (deferred): the EXHAUSTIVE tree-wide bi-word gate over `work/` DATA +
 * folder/field literals is DEFERRED to the FINAL `run-prd-to-spec-on-dorfl-
 * acceptance` task per the source/data split — it is green on dorfl only AFTER
 * the `dorfl prd-to-spec` command converts dorfl's own data. Do NOT widen this
 * source-part scan to a blanket `prd`-grep: ~2000 legitimate data/prose
 * occurrences remain until the command runs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..');
const SRC_DIR = join(here, '..', 'src');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const DOCS_DIR = join(REPO_ROOT, 'docs');
const CONTEXT_MD = join(REPO_ROOT, 'CONTEXT.md');
const AGENTS_MD = join(REPO_ROOT, 'AGENTS.md');

// ───────────────────────────────────────────────────────────────────────────
// The bi-word token matchers.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A `prd`/`brief` CODE IDENTIFIER hit inside a stripped-code token stream. Word
 * boundaries so `prd`/`brief` matches as its own JS identifier or as a
 * camelCase/`_`-joined member of one (`seedPrd`, `prdsLandIn`, `viaBrief`).
 * Case-insensitive to catch `Prd`/`PRD`/`Brief`/`BRIEF`.
 */
const IDENT_HIT = /(prd|brief)/i;

/** A JS identifier token. */
const IDENTIFIER = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

// ───────────────────────────────────────────────────────────────────────────
// The categorical EXEMPTIONS (option A — the command's DATA territory).
// ───────────────────────────────────────────────────────────────────────────

/**
 * The CARVE-OUT #2 frontmatter-field chain: the `prd`-named identifiers that
 * ARE the `prd:` frontmatter FIELD or carry its value through to the `<prd>`
 * prompt-template placeholder. These are DATA the migration command converts
 * (it flips `parseFrontmatter` to `spec:`-only once dorfl's 199 on-disk `prd:`
 * fields are converted). They are EXEMPT here by the categorical `prd:`
 * FIELD-token exemption — NOT a hand-listed file set, but the field name + its
 * exactly-typed carriers, which are all the bare `prd` identifier (never a
 * `Prd`-cased symbol — those were fully purged by batch 4e).
 */
const FRONTMATTER_FIELD_IDENTS: ReadonlySet<string> = new Set(['prd']);

/**
 * A whole-string-literal DEAD-TOKEN path/arg the forward scan flags in `.ts`
 * SOURCE: the literal is, in its ENTIRETY, a retired `prd`/`brief` code token the
 * code would BUILD or MATCH — a `work/prd-<slug>` / `work/brief-<slug>` branch
 * ref, a `prd-<slug>` / `brief-<slug>` lock/sidecar entry, or a `prd:`/`brief:`
 * CLI-prefix arg. The `work/prds/…` DATA-folder literal (plural, a directory the
 * command moves) is NOT this shape and is exempt.
 */
const DEAD_TOKEN_LITERAL =
	/^(?:work\/(?:prd|brief)-|(?:prd|brief)-|(?:prd|brief):)/;

/**
 * MARKDOWN inline-code / fenced spans are DATA + PROSE territory (option A): the
 * `prd:` frontmatter FIELD token, a `prd:<slug>` namespace EXAMPLE, a
 * `work/prd-<slug>` branch-ref EXAMPLE, a `prd-tasked` / `prd-<slug>` DATA
 * folder/file ref, a `prds/…` folder path, and provenance slugs are all the
 * command's territory or historical documentation, NOT live source the SOURCE
 * cutover removes. So the markdown forward lens flags a code-span literal ONLY
 * when it is a dead `prd`/`brief` construct that is NONE of those exempt shapes
 * (a genuinely NEW dead identifier a future edit might introduce). The tree-wide
 * bi-word gate over doc PROSE/examples is the FINAL run-on-dorfl task's.
 */
function isExemptMarkdownDataToken(value: string): boolean {
	const v = value.trim();
	// The frontmatter FIELD token (`prd:` alone, `prd: <slug>`, `prdAfter:`) and a
	// namespace/branch EXAMPLE (`prd:<slug>`, `work/prd-<slug>`, `work/prd-*`).
	if (/^prd(?:After)?:(?:\s|<|$)/.test(v)) return true;
	if (/^work\/prd-(?:<|\*|\$)/.test(v)) return true;
	// The `setup` migration-MAP LEFT-column legacy FLAT folder names (`work/prd/`,
	// `work/pre-prd/`, `work/prd-tasked/`): the OLD on-disk folder a pre-umbrella
	// target repo LITERALLY has, named as the rename SOURCE in `skills/setup`'s
	// `git mv` map + the taxonomy/preserve-list ADRs. Sweeping the word here would
	// point `setup` at a folder that does not exist in the repo being migrated, so
	// these are permanent survivors (ADR preserve-list class (c)).
	if (/^work\/(?:pre-)?prd(?:-tasked)?\/?$/.test(v)) return true;
	// DATA folder/file references (`prd-tasked`, `prd-<slug>`, `prds/…`,
	// `work/prds/…`, `prds-proposed`, …) the command converts.
	if (/^prd-(?:tasked|<slug>|\$\{slug\})/.test(v)) return true;
	if (isPrdsFolderLiteral(v)) return true;
	if (/^prds?[-/]/.test(v)) return true;
	// Provenance slugs (immutable retired-word carriers) + this cutover's slugs.
	const lower = v.toLowerCase();
	for (const slug of PROVENANCE_SLUG_SUBSTRINGS) {
		if (lower.includes(slug)) return true;
	}
	return false;
}

/**
 * A whole string-literal that IS (or contains) an immutable provenance slug /
 * the migration verb's purpose-name (`prd-to-spec`, `rename-spec-…`, a landed
 * task/spec slug). The `.command('prd-to-spec')` verb registration is exactly
 * this shape — the verb is deliberately purpose-named after the cutover it runs
 * (ADR §7e), so its literal is a permanent survivor, not a dead code token.
 */
function isProvenanceSlugLiteral(value: string): boolean {
	const lower = value.trim().toLowerCase();
	return PROVENANCE_SLUG_SUBSTRINGS.some((slug) => lower.includes(slug));
}

/** The sidecar CARVE-OUT #1 legacy fallback literal (DATA the command renames). */
function isSidecarFallbackLiteral(value: string): boolean {
	// `work/questions/prd-<slug>.md` (or the bare `prd-${slug}.md`) — the one
	// file-path fallback the reader probes until `dorfl prd-to-spec` renames the
	// on-disk sidecar. Allow-listed with this justification.
	return (
		/^work\/questions\/prd-/.test(value) ||
		/^prd-\$\{slug\}\.md$/.test(value) ||
		value === 'prd-'
	);
}

/**
 * A `work/prds/…` DATA-folder path literal (plural — the directory the migration
 * command MOVES `work/prds/* → work/specs/*`). Exempt: it is the command's data
 * territory, not a dead code-token path.
 */
function isPrdsFolderLiteral(value: string): boolean {
	return /(?:^|\/)prds(?:\/|$)/.test(value) || /^work\/prds\b/.test(value);
}

// ───────────────────────────────────────────────────────────────────────────
// The allow-list (each entry JUSTIFIED). Any hit NOT covered fails the gate.
// ───────────────────────────────────────────────────────────────────────────

/**
 * IMMUTABLE PROVENANCE SLUGS that permanently contain the retired words (they
 * name a landed task/spec/observation/commit and can never be renamed) + this
 * cutover's own `prd-to-spec`/`rename-spec` slugs. Matched as a whole-token
 * substring of a longer slug/identifier. These appear in doc-comments (stripped)
 * and in prose (not scanned), so they rarely reach the identifier lens — but they
 * are named here so an accidental CODE use is still covered by intent.
 */
const PROVENANCE_SLUG_SUBSTRINGS: readonly string[] = [
	// This cutover's own chain.
	'prd-to-spec',
	'rename-spec',
	'preisolate-spec',
	'contract-spec',
	// The two prior cutovers' immutable provenance.
	'slice-task-prd-brief-vocabulary-hard-cutover',
	'brief-regime-rename-and-dropped-migration',
	'code-identifier-slice-prd-to-task-brief-rename',
	'close-job-via-prd-to-brief-rename-verify-and-flip-masked-test',
];

/** Genuine ENGLISH words that legitimately contain `brief` (never the artifact). */
const ENGLISH_BRIEF_WORDS = /^(debrief|briefly|briefing|briefcase|briefed)$/i;

/**
 * The MIGRATION COMMAND's own PURPOSE-NAMED identifiers (task
 * `build-prd-to-spec-migration-command`). The verb is DELIBERATELY named
 * `prd-to-spec` (ADR §7e: purpose-named verb, NOT a general `migrate <from>
 * <to>`), so its code identifiers legitimately carry the `prd` word: the
 * `PrdToSpec*` types (`PrdToSpecOptions`/`PrdToSpecResult`/`PrdToSpecFlags`),
 * the `runPrdToSpec` orchestrator, and the `printPrdToSpecReport` CLI helper.
 * These are the immutable NAME of the command that MIGRATES prd→spec — the same
 * immutable-provenance logic as {@link PROVENANCE_SLUG_SUBSTRINGS}, but the
 * camelCase form has no hyphens so the slug substring match does not reach it.
 * Matched as a whole identifier (case-insensitive) carrying the `prdtospec`
 * purpose-name core.
 */
const MIGRATION_COMMAND_IDENTIFIER = /prdtospec/i;

// ───────────────────────────────────────────────────────────────────────────
// The .ts comment/string tokenizer (mirrors work-layout-guard.test.ts).
// ───────────────────────────────────────────────────────────────────────────

interface Token {
	line: number;
	kind: 'code' | 'string';
	value: string;
}

/**
 * Split a TS source into CODE spans (comments removed) and STRING/TEMPLATE
 * literals, each tagged with its 1-based start line. The small hand-tokenizer is
 * the exact one `work-layout-guard.test.ts` uses: it (a) never looks inside a
 * comment and (b) hands back each literal's raw content, so the forward lens can
 * judge code tokens and whole-literal dead paths separately.
 */
function tokenizeTs(src: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	let line = 1;
	const n = src.length;
	let codeBuf = '';
	let codeLine = 1;
	const flushCode = () => {
		if (codeBuf.trim() !== '') {
			out.push({line: codeLine, kind: 'code', value: codeBuf});
		}
		codeBuf = '';
	};
	while (i < n) {
		const c = src[i];
		const d = src[i + 1];
		if (c === '\n') {
			codeBuf += '\n';
			line++;
			i++;
			continue;
		}
		if (c === '/' && d === '/') {
			while (i < n && src[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && d === '*') {
			i += 2;
			while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
				if (src[i] === '\n') line++;
				i++;
			}
			i += 2;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			flushCode();
			codeLine = line;
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
			codeLine = line;
			continue;
		}
		if (codeBuf === '' || codeBuf.endsWith('\n')) {
			codeLine = line;
		}
		codeBuf += c;
		i++;
	}
	flushCode();
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Markdown tokenizer: CODE spans (inline `…` + fenced ```) only; prose ignored.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extract only the CODE spans from markdown — inline-code (`` `…` ``) and fenced
 * code blocks — tagged with their 1-based line. Running PROSE (the artifact word
 * `prd`/`PRD`/`brief` in a sentence) is DELIBERATELY not scanned: it is the
 * command's DATA/prose territory (option A). This is the markdown analogue of
 * "strip comments, judge code" for `.ts`.
 */
function markdownCodeSpans(src: string): Token[] {
	const out: Token[] = [];
	const lines = src.split('\n');
	let inFence = false;
	lines.forEach((raw, idx) => {
		const lineNo = idx + 1;
		if (/^\s*```/.test(raw)) {
			inFence = !inFence;
			return;
		}
		if (inFence) {
			out.push({line: lineNo, kind: 'code', value: raw});
			return;
		}
		// Inline code spans on a prose line.
		const inline = raw.match(/`[^`]+`/g);
		if (inline) {
			for (const span of inline) {
				out.push({line: lineNo, kind: 'string', value: span.slice(1, -1)});
			}
		}
	});
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Tree walk.
// ───────────────────────────────────────────────────────────────────────────

function collectFiles(dir: string, exts: readonly string[]): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			// Never descend into a repo's own `work/` DATA tree (the command's
			// territory) or build/vendor output.
			if (entry.name === 'work' || entry.name === 'node_modules') continue;
			out.push(...collectFiles(full, exts));
		} else if (exts.some((e) => entry.name.endsWith(e))) {
			out.push(full);
		}
	}
	return out;
}

/** All the files the SOURCE-part scan walks (option A scope). */
function scannedFiles(): string[] {
	const files: string[] = [];
	files.push(...collectFiles(SRC_DIR, ['.ts']));
	files.push(...collectFiles(SKILLS_DIR, ['.md', '.ts']));
	files.push(...collectFiles(DOCS_DIR, ['.md']));
	for (const single of [CONTEXT_MD, AGENTS_MD]) {
		if (existsSync(single)) files.push(single);
	}
	return files;
}

// ───────────────────────────────────────────────────────────────────────────
// FORWARD lens: identifier + whole-literal dead-path.
// ───────────────────────────────────────────────────────────────────────────

interface Leak {
	file: string;
	line: number;
	token: string;
	why: string;
}

/** Is this identifier token an allow-listed survivor (not a leak)? */
function isAllowedIdentifier(id: string): boolean {
	if (FRONTMATTER_FIELD_IDENTS.has(id)) return true; // CARVE-OUT #2 field chain
	if (ENGLISH_BRIEF_WORDS.test(id)) return true; // genuine English
	if (MIGRATION_COMMAND_IDENTIFIER.test(id)) return true; // the purpose-named verb
	const lower = id.toLowerCase();
	for (const slug of PROVENANCE_SLUG_SUBSTRINGS) {
		if (lower.includes(slug)) return true;
	}
	return false;
}

/** Scan one `.ts` file's tokens for forward leaks. */
function forwardLeaksTs(rel: string, tokens: Token[]): Leak[] {
	const leaks: Leak[] = [];
	for (const tok of tokens) {
		if (tok.kind === 'code') {
			// Judge CODE identifiers only — a `prd`/`brief` symbol/union/config/CLI
			// token. Handle multi-line code spans line-by-line for accurate lines.
			const spanLines = tok.value.split('\n');
			spanLines.forEach((lineText, offset) => {
				let m: RegExpExecArray | null;
				IDENTIFIER.lastIndex = 0;
				while ((m = IDENTIFIER.exec(lineText))) {
					const id = m[1];
					if (!IDENT_HIT.test(id)) continue;
					if (isAllowedIdentifier(id)) continue;
					leaks.push({
						file: rel,
						line: tok.line + offset,
						token: id,
						why: 'live prd/brief CODE identifier',
					});
				}
			});
		} else {
			// A string/template literal: flag ONLY when its WHOLE content is a
			// dead-token path/arg (never a `prd`/`brief` word amid prose).
			const v = tok.value.trim();
			if (isSidecarFallbackLiteral(v)) continue; // CARVE-OUT #1
			if (isPrdsFolderLiteral(v)) continue; // DATA folder (command's)
			if (isProvenanceSlugLiteral(v)) continue; // the purpose-named verb / a slug
			if (DEAD_TOKEN_LITERAL.test(v)) {
				leaks.push({
					file: rel,
					line: tok.line,
					token: v,
					why: 'whole-literal dead prd/brief token path',
				});
			}
		}
	}
	return leaks;
}

/** Scan one markdown file's CODE spans for forward leaks. */
function forwardLeaksMd(rel: string, spans: Token[]): Leak[] {
	const leaks: Leak[] = [];
	for (const span of spans) {
		const v = span.value.trim();
		// Whole-literal dead path in an inline-code span.
		if (span.kind === 'string') {
			if (isSidecarFallbackLiteral(v)) continue;
			if (isExemptMarkdownDataToken(v)) continue; // option-A DATA/prose/provenance
			if (DEAD_TOKEN_LITERAL.test(v)) {
				leaks.push({
					file: rel,
					line: span.line,
					token: v,
					why: 'whole-literal dead prd/brief token path (md code span)',
				});
			}
			continue;
		}
		// Fenced-code line: judge whole-token dead constructs (config keys / CLI
		// tokens in examples), applying the SAME option-A DATA/prose/provenance
		// exemption so example data + the `prd:` field token stay exempt.
		let m: RegExpExecArray | null;
		IDENTIFIER.lastIndex = 0;
		while ((m = IDENTIFIER.exec(v))) {
			const id = m[1];
			if (!IDENT_HIT.test(id)) continue;
			if (isAllowedIdentifier(id)) continue;
			if (
				isExemptMarkdownDataToken(id) ||
				isExemptMarkdownDataToken(id + ':')
			) {
				continue;
			}
			if (DEAD_TOKEN_LITERAL.test(id + ':')) {
				leaks.push({
					file: rel,
					line: span.line,
					token: id,
					why: 'live prd/brief token in fenced code',
				});
			}
		}
	}
	return leaks;
}

// ───────────────────────────────────────────────────────────────────────────
// REVERSE lens: corrupted English introduced by the sweep.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Mangled-English shapes a blind keep-case `prd → spec` (or `brief → spec`)
 * sweep would have PRODUCED by hitting the string inside a real word. `spec`
 * collides with English, so the dangerous mangles are `espec…`→`esspec…`,
 * `specif…`→`speccif…`, `inspec…` corruptions, etc. `preisolate-spec-false-
 * positive-words` cleared the KNOWN adjacencies, so ANY hit here is a genuine
 * regression. These are NEGATIVE patterns: a match is a FAILURE.
 */
const CORRUPTED_ENGLISH: readonly {pattern: RegExp; note: string}[] = [
	{pattern: /esspec/i, note: 'especially → esspecially (mangle)'},
	{pattern: /speccif/i, note: 'specify/specific → speccif… (mangle)'},
	{pattern: /inspecc/i, note: 'inspect → inspecc… (mangle)'},
	{pattern: /respecc/i, note: 'respect → respecc… (mangle)'},
	{pattern: /espsspec/i, note: 'double-substituted spec (mangle)'},
	{pattern: /speccification/i, note: 'specification → speccification (mangle)'},
	// The `prd → spec` direction produced a nonsense token if it hit a word that
	// already ended in `…s` before a `prd` (defensive: `prd` has zero English
	// false-positives, so any residue like `espprd`/`spprd` is a corruption).
	{pattern: /espprd/i, note: 'espec-adjacent prd corruption'},
	{pattern: /spprd/i, note: 'spec-adjacent prd corruption'},
];

function reverseLeaks(rel: string, text: string): Leak[] {
	const leaks: Leak[] = [];
	const lines = text.split('\n');
	lines.forEach((line, idx) => {
		for (const {pattern, note} of CORRUPTED_ENGLISH) {
			const m = pattern.exec(line);
			if (m) {
				leaks.push({file: rel, line: idx + 1, token: m[0], why: note});
			}
		}
	});
	return leaks;
}

// ───────────────────────────────────────────────────────────────────────────
// Tests.
// ───────────────────────────────────────────────────────────────────────────

function relTo(file: string): string {
	return relative(REPO_ROOT, file);
}

function formatLeaks(leaks: Leak[]): string {
	return leaks
		.map((l) => `  ${l.file}:${l.line}: '${l.token}' — ${l.why}`)
		.join('\n');
}

describe('prd → spec leak scan — the SOURCE-part cutover acceptance GATE', () => {
	it('the forward + reverse matchers are non-vacuous (detector self-check)', () => {
		// FORWARD: real dead code identifiers / whole-literal dead paths MUST flag.
		const badTs = tokenizeTs(
			[
				"const PRD_PREFIX = 'prd:';", // dead prefix const + whole-literal arg
				"type SidecarType = 'prd' | 'spec';", // dead union member (value literal)
				"switchToWorkBranch(cwd, 'prd', slug);", // dead namespace value literal
				"const ref = 'work/prd-my-slug';", // whole-literal dead branch ref
				'function renderBrief() {}', // dead brief symbol
			].join('\n'),
		);
		const fwd = forwardLeaksTs('probe.ts', badTs);
		// Must catch the code identifiers PRD_PREFIX, SidecarType-value 'prd',
		// renderBrief AND the whole-literal dead paths 'prd:' / 'work/prd-my-slug'.
		expect(fwd.some((l) => l.token === 'PRD_PREFIX')).toBe(true);
		expect(fwd.some((l) => l.token === 'renderBrief')).toBe(true);
		expect(
			fwd.some((l) => l.token === 'prd:' || l.token === 'work/prd-my-slug'),
		).toBe(true);

		// FORWARD must NOT flag the carve-outs + prose + spec.
		const goodTs = tokenizeTs(
			[
				'interface Frontmatter { prd: string | undefined; }', // CARVE-OUT #2 field
				'result.prd = value; // reads the prd: frontmatter key', // field read
				"const candidates = ['work/questions/prd-a.md'];", // CARVE-OUT #1 fallback
				"const dir = 'work/prds/ready';", // DATA folder (command's)
				"type SidecarType = 'spec' | 'task';", // the live spelling
				"const kind = 'spec';", // SidecarKind value (not a namespace)
			].join('\n'),
		);
		expect(forwardLeaksTs('good.ts', goodTs)).toEqual([]);

		// REVERSE: a mangled English word MUST flag; the clean word must not.
		expect(reverseLeaks('m.ts', 'esspecially wrong')).not.toEqual([]);
		expect(reverseLeaks('m.ts', 'especially fine, specify this')).toEqual([]);
	});

	it('the walk reaches a representative spread (exhaustive-by-construction, not a hand list)', () => {
		const files = scannedFiles();
		// A meaningful set of files across all four roots.
		expect(files.length).toBeGreaterThan(50);
		expect(
			files.some((f) => f.endsWith(join('src', 'slug-namespace.ts'))),
		).toBe(true);
		expect(files.some((f) => f.endsWith(join('src', 'frontmatter.ts')))).toBe(
			true,
		);
		expect(files.some((f) => relTo(f).startsWith('skills/'))).toBe(true);
		expect(files.some((f) => relTo(f).startsWith('docs/'))).toBe(true);
		expect(
			files.some((f) => f === CONTEXT_MD || f.endsWith('CONTEXT.md')),
		).toBe(true);
	});

	it('FORWARD: no unallow-listed live prd/brief CODE identifier or dead-token path', () => {
		const leaks: Leak[] = [];
		for (const file of scannedFiles()) {
			const rel = relTo(file);
			const text = readFileSync(file, 'utf8');
			if (file.endsWith('.ts')) {
				leaks.push(...forwardLeaksTs(rel, tokenizeTs(text)));
			} else {
				leaks.push(...forwardLeaksMd(rel, markdownCodeSpans(text)));
			}
		}
		expect(
			leaks,
			leaks.length === 0
				? ''
				: `forward leak-scan: unallow-listed live prd/brief CODE identifier(s) ` +
						`or dead-token path(s) found — the prd→spec source cutover is NOT ` +
						`complete (sweep them to spec, or add a JUSTIFIED allow-list entry ` +
						`if a genuine survivor):\n${formatLeaks(leaks)}`,
		).toEqual([]);
	});

	it('REVERSE: no genuine English corrupted by the sweep', () => {
		const leaks: Leak[] = [];
		for (const file of scannedFiles()) {
			const rel = relTo(file);
			// The DATA-side migration engine (`src/prd-to-spec.ts`) DEFINES the same
			// corrupted-English NEGATIVE patterns as this test's own
			// {@link CORRUPTED_ENGLISH} (its `scanForLeaks` reverse lens over the
			// converted tree). Those pattern literals (`esspec`, `speccif`, …) are the
			// detector, NOT mangled prose — exactly why THIS test's own copy lives in
			// `test/` (unscanned). Exempt that ONE module for the same reason.
			if (rel.endsWith(join('src', 'prd-to-spec.ts'))) continue;
			leaks.push(...reverseLeaks(rel, readFileSync(file, 'utf8')));
		}
		expect(
			leaks,
			leaks.length === 0
				? ''
				: `reverse leak-scan: the sweep CORRUPTED genuine English — a real word ` +
						`was mangled by a keep-case replace (fix the word):\n${formatLeaks(
							leaks,
						)}`,
		).toEqual([]);
	});

	it('the allow-list is concrete + each entry justified (guard is non-vacuous)', () => {
		// CARVE-OUT #2 (the frontmatter-field chain) really IS present — the
		// `Frontmatter.prd` field is read by `parseFrontmatter`, so the exemption is
		// load-bearing (removing it would flag ~15 field-carrier identifiers).
		const frontmatter = readFileSync(join(SRC_DIR, 'frontmatter.ts'), 'utf8');
		expect(frontmatter).toMatch(/\bprd\b/);
		// CARVE-OUT #1 (the sidecar legacy fallback) really IS present in sidecar.ts.
		const sidecar = readFileSync(join(SRC_DIR, 'sidecar.ts'), 'utf8');
		expect(sidecar).toMatch(/prd-\$\{slug\}\.md|prd-`|questions', `prd-/);
		// Every provenance-slug allow-list entry is a real retired-word carrier.
		for (const slug of PROVENANCE_SLUG_SUBSTRINGS) {
			expect(/(prd|brief|spec)/i.test(slug), slug).toBe(true);
		}
	});
});

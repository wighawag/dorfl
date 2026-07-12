import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORK_FOLDER_NAME, type WorkFolderKey} from '../src/work-layout.js';

/**
 * Structural guard for the `folder-taxonomy-reorg-and-rename` PRD (US #4/#5):
 * NO `.ts` under `packages/dorfl/src`, except the `work-layout` module
 * itself, may contain a RAW `work/<folder>` PATH-CONSTRUCTION literal. This locks
 * in the Phase-0 centralisation (`work-layout-module-centralises-all-work-paths`):
 * once every `join(cwd, 'work', …)` / `'work/<folder>'` / prefix-task routes
 * through `work-layout`, this guard is what stops a future edit re-scattering a raw
 * `work/backlog/…` path string back across the package (which would also re-expose
 * the later rename to a fragile find-replace).
 *
 * House style: a source-scanning invariant test, the same shape as
 * `ledger-lint.test.ts` (a detector + fixtures) and the `no claimedBy symbol`
 * guard in `flag-cleanup-renames.test.ts` (read `src/` relative to the test, assert
 * an invariant, name the offender). The allow-list is EXACTLY the `work-layout`
 * module — the one permitted home of these literals; the rule cannot be satisfied
 * by per-file disables.
 *
 * CONTEXT-AWARE, by deliberate design (the conductor's forward-pointer): the
 * centralisation routed every PATH-CONSTRUCTION site through `work-layout` but
 * DELIBERATELY left ~70 `work/<folder>` literals in `src/*.ts` that are NOT path
 * construction — doc-comments, error/log/`--help`/agent-prompt PROSE, and embedded
 * CI-workflow template YAML (the `work/questions/**` push-trigger globs). Those are
 * legitimate human-readable text, NOT paths, and the centralisation correctly left
 * them. So this guard does NOT blanket-regex every source line. It instead:
 *   1. STRIPS comments (so the markdown-backtick paths in JSDoc never count), and
 *   2. inspects only STRING/TEMPLATE LITERALS, flagging one ONLY when its ENTIRE
 *      content is a `work/<folder>` path (optionally a `${ref}:` git-ref prefix and
 *      `${slug}.md`-style interpolations) — i.e. a standalone path the code is
 *      BUILDING, never a `work/<folder>` token embedded amid sentence words (prose)
 *      or a `triggers:`-glob.
 * That "the whole literal is a path" cut line is exactly the
 * inside-a-path-site-vs-prose distinction: a path-construction literal IS the path;
 * a prose/template string carries other words around the token.
 */

const FOLDER_NAMES: readonly string[] = Object.values(WORK_FOLDER_NAME);

/** The one module allowed to hold raw `work/<folder>` path literals. */
const ALLOW = 'work-layout.ts';

/**
 * The path-construction matcher. A string-literal CONTENT matches iff it is, in its
 * entirety, a `work/<folder>` path:
 *   - an OPTIONAL prefix before `work/`, EITHER a git-ref prefix ending in `:`
 *     (e.g. `${ref}:`, `${arbiter}/main:`) OR a single interpolated path-prefix
 *     segment ending in `/` (e.g. `${root}/`, `${cwd}/`) — the latter admits
 *     the ABSOLUTE form `${root}/work/<folder>/...` alongside the repo-relative
 *     and git-ref forms,
 *   - the `work/` root + one of the known folder NAMES (not a longer word that
 *     merely starts with one — the `(?![A-Za-z-])` boundary stops a folder name
 *     from matching only a PREFIX of a longer same-rooted token, e.g.
 *     `work/tasks/done` must not match inside `work/tasks/done-ish`),
 *   - then zero or more `/segment` path continuations, where a segment is any run of
 *     `${…}` interpolations, `<…>` placeholders, and path-safe chars (NOT `*`, so a
 *     `work/questions/**` template glob is NOT a path-construction literal).
 *
 * Built once, anchored `^…$`, so it fires on the WHOLE literal only.
 */
function buildPathLiteralRegex(): RegExp {
	const folderAlt = FOLDER_NAMES.map((n) => n.replace(/[-]/g, '\\$&')).join(
		'|',
	);
	// Two parallel OPTIONAL prefix branches before `work/`, kept separate so a
	// bare unrelated prefix is not absorbed by either:
	//   - refPrefix: a git-ref prefix ending in `:` (e.g. `${ref}:`,
	//     `${arbiter}/main:`) — the originally-shipped branch.
	//   - pathPrefix: a single interpolated path-prefix segment ending in `/`
	//     (e.g. `${root}/`, `${cwd}/`) — admits the ABSOLUTE form
	//     `${root}/work/<folder>/...`. The `${…}/` shape is REQUIRED so
	//     `${root}/something` (no `work/<folder>` body) is NOT flagged.
	const refPrefix = `[A-Za-z0-9_.$\\{\\}/-]*:`;
	const pathPrefix = `\\$\\{[^}]*\\}/`;
	const prefix = `(?:${refPrefix}|${pathPrefix})?`;
	const segment = `(?:\\$\\{[^}]*\\}|<[^>]*>|[A-Za-z0-9_.-]+)+`;
	return new RegExp(
		`^${prefix}work/(?:${folderAlt})(?![A-Za-z-])(?:/(?:${segment})?)*$`,
	);
}

const PATH_LITERAL = buildPathLiteralRegex();

interface FoundLiteral {
	line: number;
	value: string;
}

/**
 * Extract every string/template literal (with its 1-based start line) from a TS
 * source, SKIPPING `//` and block comments so markdown-backtick paths in JSDoc are
 * never seen. A deliberately small hand-tokenizer (no TS-compiler dep): it is exact
 * enough for this guard because it only needs to (a) not look inside comments and
 * (b) hand back each literal's raw content. Template-expression nesting is treated
 * as literal text — fine here, since a `${…}` inside a path literal is exactly what
 * the matcher expects, and a non-path template never matches the anchored regex.
 */
function extractStringLiterals(src: string): FoundLiteral[] {
	const out: FoundLiteral[] = [];
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
			i++; // consume the closing delimiter
			out.push({line: startLine, value: buf});
			continue;
		}
		i++;
	}
	return out;
}

/** Does this literal CONTENT read as a raw `work/<folder>` path the code builds? */
function isRawWorkPathLiteral(value: string): boolean {
	return PATH_LITERAL.test(value.trim());
}

/** Recursively collect every `*.ts` file under a directory. */
function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(here, '..', 'src');

describe('work-layout guard — no raw work/<folder> path literal outside work-layout', () => {
	it('the matcher fires on path-construction literals and NOT on prose/templates (detector self-check)', () => {
		// Path-construction literals (the SHAPES the centralisation removed) MUST match
		// — otherwise the guard could rot into a vacuous pass. After the notes-regroup +
		// task-board-rename flip the task board lives under `tasks/` and the capture
		// buckets under `notes/`; after the prd→spec rename the spec lifecycle
		// lives under `specs/` (`specs/proposed`/`specs/ready`/`specs/tasked`) and
		// the won't-proceed terminals are per-regime (`tasks/cancelled`/`specs/dropped`).
		// A path-construction literal for any of those is now the NESTED form — the
		// matcher fires on the WHOLE nested path because the folder NAME the alternation
		// carries is itself `prds/ready` etc. `questions` keeps its flat shape.
		for (const path of [
			'work/tasks/ready',
			'work/specs/proposed',
			'work/specs/ready/',
			'work/tasks/ready/',
			'work/tasks/backlog/',
			'work/tasks/cancelled/',
			'work/specs/dropped/',
			'work/notes/observations/',
			'work/tasks/ready/${slug}.md',
			'work/tasks/done/${slug}.md',
			'work/specs/tasked/${slug}.md',
			'work/questions/${type}-${slug}.md',
			'work/tasks/done/<slug>.md',
			'${ref}:work/tasks/done',
			'${ref}:work/tasks/ready',
			'${arbiter}/main:work/tasks/backlog',
			// Absolute interpolated-prefix forms: a future regression that
			// re-scatters a `${root}/work/<folder>/...` literal must also flag.
			'${root}/work/tasks/backlog/${slug}.md',
			'${cwd}/work/tasks/done',
		]) {
			expect(isRawWorkPathLiteral(path), `should flag: ${path}`).toBe(true);
		}

		// Legitimate residual that the centralisation DELIBERATELY left — PROSE and
		// the CI-template glob — MUST NOT match (they would otherwise red the gate).
		for (const prose of [
			// Retired-folder PROSE (the `work/needs-attention/` folder is gone post
			// lock-cutover; docstrings still name it to explain it is retired) must not
			// be mistaken for a raw work-path literal.
			'the `work/needs-attention/` folder is retired — stuck is the lock state',
			'work/tasks/ready/${slug}.md (nor work/in-progress/${slug}.md nor ',
			'Read the source spec (work/specs/ready/${input.slug}.md) and review the candidate',
			'(A repo participates iff it has a work/tasks/ready/ with >= 1 .md file.)',
			'work/questions/**', // the advance-CI template push-trigger glob
			'workspace', // a word that merely starts with "work"
			// A bare interpolated prefix with NO `work/<folder>` body must not be
			// absorbed by the new `${…}/`-prefix branch.
			'${root}/something',
		]) {
			expect(isRawWorkPathLiteral(prose), `should NOT flag: ${prose}`).toBe(
				false,
			);
		}
	});

	it('scans src/ recursively and excludes the work-layout module only', () => {
		const files = collectTsFiles(SRC_DIR);
		// Sanity: the scan reached a representative spread of the package (not zero,
		// and including the nested install-ci-capabilities/ subtree).
		expect(files.length).toBeGreaterThan(20);
		expect(
			files.some((f) =>
				f.endsWith(join('install-ci-capabilities', 'intake.ts')),
			),
		).toBe(true);
		// The allow-list is exactly work-layout.ts, and it really is in the tree.
		expect(files.some((f) => f.endsWith(ALLOW))).toBe(true);
	});

	it('NO src/ file except work-layout contains a raw work/<folder> path literal', () => {
		const offenders: string[] = [];
		for (const file of collectTsFiles(SRC_DIR)) {
			if (file.endsWith(ALLOW)) continue; // the single permitted home
			const text = readFileSync(file, 'utf8');
			for (const lit of extractStringLiterals(text)) {
				if (isRawWorkPathLiteral(lit.value)) {
					offenders.push(
						`${relative(SRC_DIR, file)}:${lit.line}: ${lit.value.trim()}`,
					);
				}
			}
		}
		// A LOUD, locatable failure: every offender names file + line + the literal,
		// so a regression is trivially found and routed back through work-layout.
		expect(
			offenders,
			offenders.length === 0
				? ''
				: `raw work/<folder> path literal(s) found outside work-layout — route ` +
						`these through the work-layout module (workFolderRel / workItemRel / ` +
						`workFolderPath / workItemPath / workFolderPrefix):\n  ${offenders.join(
							'\n  ',
						)}`,
		).toEqual([]);
	});

	it('the allow-listed work-layout module is what actually holds the literals (guard is non-vacuous)', () => {
		// The flip side of the allow-list: the permitted home really DOES contain the
		// folder-name path literals — so the exclusion is load-bearing, not cosmetic.
		const text = readFileSync(join(SRC_DIR, ALLOW), 'utf8');
		const keys = Object.keys(WORK_FOLDER_NAME) as WorkFolderKey[];
		expect(keys.length).toBeGreaterThan(0);
		// work-layout names every folder; the WORK_ROOT literal lives here too.
		expect(text).toContain("'work'");
		for (const key of keys) {
			expect(text).toContain(WORK_FOLDER_NAME[key]);
		}
	});
});

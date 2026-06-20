import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureFolderRel} from './helpers/gitRepo.js';
import {
	detectDuplicateSlugs,
	lintLocalLedger,
	sweepLedgerDuplicates,
	formatDuplicateWarnings,
	formatLedgerSweep,
	LEDGER_STATUS_FOLDERS,
	type LedgerStatusFolder,
} from '../src/ledger-lint.js';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-ledger-lint-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

/** Write `work/<folder>/<slug>.md` in the fixture repo (a minimal slice body). */
function place(folder: string, slug: string, content?: string): void {
	const dir = join(root, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		content ?? `---\nslug: ${slug}\n---\n\nbody`,
	);
}

describe('detectDuplicateSlugs (pure)', () => {
	it('flags a slug present in two status folders, lifecycle-ordered', () => {
		const map = new Map<LedgerStatusFolder, Set<string>>([
			['tasks-todo', new Set(['ghost'])],
			['done', new Set(['ghost'])],
		]);
		const dups = detectDuplicateSlugs(map);
		expect(dups).toHaveLength(1);
		expect(dups[0].slug).toBe('ghost');
		// `done/` outranks `tasks-todo/` (most-advanced lifecycle stage first).
		expect(dups[0].folders).toEqual(['done', 'tasks-todo']);
		expect(dups[0].candidateCanonical).toBe('done');
	});

	it('reports clean (no duplicates) when every slug is in exactly one folder', () => {
		const map = new Map<LedgerStatusFolder, Set<string>>([
			['tasks-todo', new Set(['a', 'b'])],
			['done', new Set(['c'])],
		]);
		expect(detectDuplicateSlugs(map)).toEqual([]);
	});

	it('sorts multiple duplicates by slug', () => {
		const map = new Map<LedgerStatusFolder, Set<string>>([
			['tasks-todo', new Set(['zebra', 'apple'])],
			['done', new Set(['zebra', 'apple'])],
		]);
		expect(detectDuplicateSlugs(map).map((d) => d.slug)).toEqual([
			'apple',
			'zebra',
		]);
	});
});

describe('lintLocalLedger (over a working tree)', () => {
	it('surfaces a slug deliberately placed in two status folders, naming both', () => {
		place('backlog', 'orphan');
		place('done', 'orphan');
		const dups = lintLocalLedger(root);
		expect(dups).toHaveLength(1);
		expect(dups[0].slug).toBe('orphan');
		expect(dups[0].folders).toContain('tasks-todo');
		expect(dups[0].folders).toContain('done');
	});

	it('covers cancelled as a status folder (the full lifecycle set)', () => {
		place('backlog', 'wont');
		place('cancelled', 'wont');
		const dups = lintLocalLedger(root);
		expect(dups.map((d) => d.slug)).toEqual(['wont']);
		expect(dups[0].folders).toContain('cancelled');
	});

	it('reports a clean ledger with NO false positives (durable set only)', () => {
		place('backlog', 'a');
		place('done', 'd');
		place('cancelled', 'e');
		// The transient `in-progress`/`needs-attention` are retired from `main`'s tree
		// (per-item lock state now); even if present they are NOT lint-set folders, so
		// they never count.
		place('in-progress', 'b');
		place('needs-attention', 'c');
		expect(lintLocalLedger(root)).toEqual([]);
	});

	it('EXCLUDES capture buckets and PRD folders (a same-named note/PRD is NOT a duplicate)', () => {
		place('backlog', 'shared');
		// A same-named idea/observation/finding and a same-named PRD are NOT status
		// residence — they must never count as a one-slug-one-folder violation.
		place('ideas', 'shared');
		place('observations', 'shared');
		place('findings', 'shared');
		place('prd', 'shared');
		place('prd-sliced', 'shared');
		expect(lintLocalLedger(root)).toEqual([]);
	});

	it('resolves the slug from frontmatter, not the filename', () => {
		// Two files with DIFFERENT names but the SAME frontmatter slug, in two folders.
		mkdirSync(join(root, 'work', 'tasks', 'todo'), {recursive: true});
		mkdirSync(join(root, 'work', 'tasks', 'done'), {recursive: true});
		writeFileSync(
			join(root, 'work', 'tasks', 'todo', 'a.md'),
			'---\nslug: same\n---\n',
		);
		writeFileSync(
			join(root, 'work', 'tasks', 'done', 'b.md'),
			'---\nslug: same\n---\n',
		);
		const dups = lintLocalLedger(root);
		expect(dups.map((d) => d.slug)).toEqual(['same']);
	});

	it('reports clean for a repo with no work/ tree at all', () => {
		expect(lintLocalLedger(root)).toEqual([]);
	});
});

describe('sweepLedgerDuplicates (the gc-style on-demand REPORT)', () => {
	it('reports the duplicate set + candidate canonical folder, NEVER deleting', () => {
		place('cancelled', 'stuck');
		place('done', 'stuck');
		const result = sweepLedgerDuplicates(root);
		expect(result.duplicates).toHaveLength(1);
		expect(result.duplicates[0].slug).toBe('stuck');
		expect(result.duplicates[0].candidateCanonical).toBe('done');
		// The sweep is REPORT-ONLY: both files are still present afterwards.
		expect(
			existsSync(join(root, 'work', 'tasks', 'cancelled', 'stuck.md')),
		).toBe(true);
		expect(existsSync(join(root, 'work', 'tasks', 'done', 'stuck.md'))).toBe(
			true,
		);
	});

	it('reports a clean ledger as clean', () => {
		place('backlog', 'a');
		place('done', 'b');
		expect(sweepLedgerDuplicates(root).duplicates).toEqual([]);
	});
});

describe('formatting', () => {
	it('formats a LOUD warning naming the slug and its folders', () => {
		place('backlog', 'ghost');
		place('done', 'ghost');
		const lines = formatDuplicateWarnings(lintLocalLedger(root));
		const text = lines.join('\n');
		expect(text).toMatch(/one-slug-one-folder VIOLATED/);
		expect(text).toContain('ghost');
		expect(text).toContain('work/tasks/done/');
		expect(text).toContain('work/tasks/todo/');
	});

	it('a clean ledger produces NO warning lines (silent)', () => {
		place('backlog', 'a');
		expect(formatDuplicateWarnings(lintLocalLedger(root))).toEqual([]);
	});

	it('the gc-style sweep report names folders, the canonical candidate, and "never auto-deleted"', () => {
		place('backlog', 'dup');
		place('done', 'dup');
		const text = formatLedgerSweep(sweepLedgerDuplicates(root));
		expect(text).toContain('dup');
		expect(text).toContain('work/tasks/done/');
		expect(text).toContain('candidate canonical: work/tasks/done/');
		expect(text).toMatch(/NEVER auto-deleted/);
	});

	it('the gc-style sweep report says clean when there is nothing to report', () => {
		place('backlog', 'a');
		expect(formatLedgerSweep(sweepLedgerDuplicates(root))).toMatch(
			/Ledger clean/,
		);
	});
});

describe('the status-folder set', () => {
	it('is exactly the durable lifecycle folders (transient/buckets/PRD folders excluded)', () => {
		// After the capstone cut-over (slice
		// `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`) the only
		// `work/` moves on `main` are the durable resting transitions, so a slice's
		// ledger file rests only in the durable set; the transient
		// `in-progress`/`needs-attention` are per-item lock state now.
		expect([...LEDGER_STATUS_FOLDERS]).toEqual([
			'tasks-todo',
			'done',
			'cancelled',
		]);
	});
});

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentLedgerRead} from '../src/ledger-read.js';
import {
	parseSlugArg,
	resolveSlug,
	resolveSliceOnlyArg,
	workBranchRef,
	parseWorkBranchRef,
	SlugResolutionError,
} from '../src/slug-namespace.js';

let root: string;

/** Seed one `work/<folder>/<file>` with the given frontmatter. */
function writeItem(
	folder: 'backlog' | 'in-progress' | 'done' | 'prd' | 'slicing',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, 'repo', 'work', folder);
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', body);
	writeFileSync(join(dir, file), lines.join('\n'));
}

function repoPath(): string {
	return join(root, 'repo');
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-slug-ns-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('parseSlugArg — pure prefix splitting', () => {
	it('strips an explicit slice: prefix', () => {
		expect(parseSlugArg('slice:foo')).toEqual({explicit: 'slice', slug: 'foo'});
	});

	it('strips an explicit prd: prefix', () => {
		expect(parseSlugArg('prd:foo')).toEqual({explicit: 'prd', slug: 'foo'});
	});

	it('treats a bare slug as having no explicit namespace', () => {
		expect(parseSlugArg('foo')).toEqual({explicit: undefined, slug: 'foo'});
	});

	it('does NOT treat a slug that merely starts like a prefix as prefixed', () => {
		// `slicer` is not `slice:` — only the exact `slice:`/`prd:` tokens count.
		expect(parseSlugArg('slicer')).toEqual({
			explicit: undefined,
			slug: 'slicer',
		});
		expect(parseSlugArg('prder')).toEqual({explicit: undefined, slug: 'prder'});
	});
});

describe('resolveSlug — the §3a cross-namespace resolver', () => {
	it('a bare slug resolves to the SLICE when no PRD shares it', () => {
		writeItem('backlog', 'feature.md', {slug: 'feature'});

		const resolved = resolveSlug({
			arg: 'feature',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'slice',
			slug: 'feature',
			explicit: false,
		});
	});

	it('a bare slug resolves to the slice even when the slice itself does not exist (no silent PRD guess)', () => {
		// Bare = slice ALWAYS (the slice machinery downstream reports "absent");
		// the only thing that diverts a bare slug is a PRD COLLISION, below.
		const resolved = resolveSlug({
			arg: 'ghost',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(resolved.namespace).toBe('slice');
		expect(resolved.slug).toBe('ghost');
	});

	it('a bare slug ERRORS on a slice/PRD collision (never silently guesses)', () => {
		// Seed BOTH a slice and a PRD named `auto-slice` — the ADR's example.
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});

		expect(() =>
			resolveSlug({
				arg: 'auto-slice',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);

		try {
			resolveSlug({
				arg: 'auto-slice',
				repoPath: repoPath(),
				read: currentLedgerRead,
			});
		} catch (err) {
			expect((err as Error).message).toContain('ambiguous');
			expect((err as Error).message).toContain('slice:auto-slice');
			expect((err as Error).message).toContain('prd:auto-slice');
		}
	});

	it('a bare slug ERRORS on collision even when the PRD is mid-slice (held in work/slicing/)', () => {
		// A PRD currently being sliced is held under the lock at work/slicing/<slug>.md
		// (transient, not a "sliced" resting state); the PRD namespace still claims the
		// slug, so a bare slug is still ambiguous.
		writeItem('backlog', 'shared.md', {slug: 'shared'});
		writeItem('slicing', 'shared.md', {slug: 'shared'});

		expect(() =>
			resolveSlug({
				arg: 'shared',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);
	});

	it('an explicit slice: prefix is ALWAYS unambiguous — resolves to the slice even on a collision, no error', () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});

		const resolved = resolveSlug({
			arg: 'slice:auto-slice',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'slice',
			slug: 'auto-slice',
			explicit: true,
		});
	});

	it('an explicit prd: prefix is ALWAYS unambiguous — resolves to the PRD even on a collision, no error', () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});

		const resolved = resolveSlug({
			arg: 'prd:auto-slice',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'prd',
			slug: 'auto-slice',
			explicit: true,
		});
	});

	it('an explicit prefix does NOT pay the existence read (unambiguous by construction)', () => {
		// With NO files seeded, an explicit prd: still resolves (it is collision-
		// proof by construction; the check is the bare path's concern only).
		const resolved = resolveSlug({
			arg: 'prd:never-written',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(resolved.namespace).toBe('prd');
	});

	it('the PRD existence check resolves the slug from frontmatter, not just the filename', () => {
		// A PRD file named oddly but whose frontmatter slug matches still collides.
		writeItem('backlog', 'feature.md', {slug: 'feature'});
		writeItem('prd', 'renamed-on-disk.md', {slug: 'feature'});

		expect(() =>
			resolveSlug({
				arg: 'feature',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);
	});
});

describe('resolveSliceOnlyArg — the slice-only command guard', () => {
	it('accepts a bare slug (= the slice)', () => {
		expect(resolveSliceOnlyArg('feature')).toBe('feature');
	});

	it('accepts an explicit slice: prefix (the explicit alias) and strips it', () => {
		expect(resolveSliceOnlyArg('slice:feature')).toBe('feature');
	});

	it('REJECTS a prd: argument with an "operates on slices, not PRDs" error', () => {
		expect(() => resolveSliceOnlyArg('prd:feature')).toThrow(
			SlugResolutionError,
		);
		try {
			resolveSliceOnlyArg('prd:feature');
		} catch (err) {
			expect((err as Error).message).toContain('slices, not PRDs');
		}
	});

	it('is PURE — a bare slug on a slice-only command never reads files (no PRD ambiguity here)', () => {
		// Even with a colliding PRD seeded, the slice-only path resolves the bare
		// slug straight to the slice (the PRD namespace is unreachable here), so
		// there is no cross-namespace check and no error.
		writeItem('prd', 'feature.md', {slug: 'feature'});
		expect(resolveSliceOnlyArg('feature')).toBe('feature');
	});
});

describe('ledger-read seam — resolvePrdExistence (the NEW PRD read path)', () => {
	it('reports a PRD present in work/prd/', () => {
		writeItem('prd', 'p.md', {slug: 'p'});
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 'p',
		});
		expect(r.exists).toBe(true);
		expect(r.prdFile).toBe('p.md');
		expect(r.slicingFile).toBeUndefined();
	});

	it('reports a PRD present only via its work/slicing/ lock file (mid-slice)', () => {
		writeItem('slicing', 's.md', {slug: 's'});
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 's',
		});
		expect(r.exists).toBe(true);
		expect(r.prdFile).toBeUndefined();
		expect(r.slicingFile).toBe('s.md');
	});

	it('resolves the slug from frontmatter, falling back to filename', () => {
		// Frontmatter slug wins over the filename.
		writeItem('prd', 'on-disk-name.md', {slug: 'real-slug'});
		expect(
			currentLedgerRead.resolvePrdExistence({
				repoPath: repoPath(),
				slug: 'real-slug',
			}).exists,
		).toBe(true);
		// Filename fallback when no frontmatter slug.
		writeItem('prd', 'filename-slug.md', {});
		expect(
			currentLedgerRead.resolvePrdExistence({
				repoPath: repoPath(),
				slug: 'filename-slug',
			}).exists,
		).toBe(true);
	});

	it('reports absent when no PRD or slicing record names the slug (no throw on missing folders)', () => {
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 'nope',
		});
		expect(r.exists).toBe(false);
		expect(r.prdFile).toBeUndefined();
		expect(r.slicingFile).toBeUndefined();
	});
});

describe('workBranchRef / parseWorkBranchRef — the ONE branch-identity derivation', () => {
	it('namespaces the branch by item type (slice vs prd) — same slug, DISTINCT refs', () => {
		// The structural bug: a same-slug slice and PRD collided on `work/<slug>`.
		const slice = workBranchRef('slice', 'advance-loop');
		const prd = workBranchRef('prd', 'advance-loop');
		expect(slice).toBe('work/slice-advance-loop');
		expect(prd).toBe('work/prd-advance-loop');
		expect(slice).not.toBe(prd);
	});

	it('prefixes an intake-produced branch so it never collides with a build/slicing branch for the same slug', () => {
		// The FIRING collision: `intake` left a branch a later `do slice:` reused.
		const intakeSlice = workBranchRef('slice', 'add-quiet-flag', {
			producer: 'intake',
		});
		const intakePrd = workBranchRef('prd', 'add-quiet-flag', {
			producer: 'intake',
		});
		const build = workBranchRef('slice', 'add-quiet-flag');
		const slicing = workBranchRef('prd', 'add-quiet-flag');
		expect(intakeSlice).toBe('work/intake-slice-add-quiet-flag');
		expect(intakePrd).toBe('work/intake-prd-add-quiet-flag');
		// All four forms for ONE slug are mutually distinct (the full collision set).
		const all = [intakeSlice, intakePrd, build, slicing];
		expect(new Set(all).size).toBe(4);
	});

	it('round-trips every form back to {producer?, namespace, slug}', () => {
		expect(parseWorkBranchRef('work/slice-foo')).toEqual({
			namespace: 'slice',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/prd-foo')).toEqual({
			namespace: 'prd',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/intake-slice-foo')).toEqual({
			producer: 'intake',
			namespace: 'slice',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/intake-prd-foo')).toEqual({
			producer: 'intake',
			namespace: 'prd',
			slug: 'foo',
		});
	});

	it('a slug that literally starts with a type/producer token is NOT mis-parsed', () => {
		// The `slug` group must never swallow the `slice-`/`intake-` prefixes.
		expect(parseWorkBranchRef('work/slice-intake-slice-foo')).toEqual({
			namespace: 'slice',
			slug: 'intake-slice-foo',
		});
		expect(parseWorkBranchRef('work/intake-prd-slice-bar')).toEqual({
			producer: 'intake',
			namespace: 'prd',
			slug: 'slice-bar',
		});
	});

	it('returns undefined for a non-work / pre-rename un-namespaced branch (the breaking cutover)', () => {
		expect(parseWorkBranchRef('main')).toBeUndefined();
		expect(parseWorkBranchRef('work/foo')).toBeUndefined(); // pre-rename form
		expect(parseWorkBranchRef('claim/foo')).toBeUndefined();
		expect(parseWorkBranchRef('feature/x')).toBeUndefined();
	});

	it('workBranchRef and parseWorkBranchRef are inverses (no second derivation)', () => {
		for (const ns of ['slice', 'prd'] as const) {
			for (const producer of [undefined, 'intake'] as const) {
				const ref = workBranchRef(ns, 'my-slug', {producer});
				const parsed = parseWorkBranchRef(ref);
				expect(parsed?.namespace).toBe(ns);
				expect(parsed?.slug).toBe('my-slug');
				expect(parsed?.producer).toBe(producer);
			}
		}
	});
});

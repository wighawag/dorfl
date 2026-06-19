import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureFolderRel} from './helpers/gitRepo.js';
import {currentLedgerRead} from '../src/ledger-read.js';
import {
	parseSlugArg,
	resolveSlug,
	resolveAdvanceArg,
	resolveSliceOnlyArg,
	workBranchRef,
	parseWorkBranchRef,
	SlugResolutionError,
} from '../src/slug-namespace.js';

let root: string;

/** Seed one `work/<folder>/<file>` with the given frontmatter. */
function writeItem(
	folder: 'backlog' | 'in-progress' | 'done' | 'prd' | 'prd-sliced',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, 'repo', 'work', fixtureFolderRel(folder));
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
	it('strips an explicit task: prefix', () => {
		expect(parseSlugArg('task:foo')).toEqual({explicit: 'task', slug: 'foo'});
	});

	it('strips an explicit brief: prefix', () => {
		expect(parseSlugArg('brief:foo')).toEqual({explicit: 'brief', slug: 'foo'});
	});

	it('treats a bare slug as having no explicit namespace', () => {
		expect(parseSlugArg('foo')).toEqual({explicit: undefined, slug: 'foo'});
	});

	it('does NOT treat a slug that merely starts like a prefix as prefixed', () => {
		// `tasked` is not `task:` — only the exact `task:`/`brief:` tokens count.
		expect(parseSlugArg('tasked')).toEqual({
			explicit: undefined,
			slug: 'tasked',
		});
		expect(parseSlugArg('briefing')).toEqual({
			explicit: undefined,
			slug: 'briefing',
		});
	});

	it('the HARD CUTOVER: a pre-rename slice:/prd: prefix is NOT a namespace prefix anymore (no alias)', () => {
		// After the cutover the old prefixes are plain slug text — they carry no
		// explicit namespace, so they fall through to the bare path (where they
		// resolve as a literal `slice:foo` / `prd:foo` slug, never as the old
		// namespace). No migration-window alias.
		expect(parseSlugArg('slice:foo')).toEqual({
			explicit: undefined,
			slug: 'slice:foo',
		});
		expect(parseSlugArg('prd:foo')).toEqual({
			explicit: undefined,
			slug: 'prd:foo',
		});
	});
});

describe('resolveSlug — the §3a cross-namespace resolver', () => {
	it('a bare slug resolves to the TASK when no brief shares it', () => {
		writeItem('backlog', 'feature.md', {slug: 'feature'});

		const resolved = resolveSlug({
			arg: 'feature',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'task',
			slug: 'feature',
			explicit: false,
		});
	});

	it('a bare slug resolves to the task even when the task itself does not exist (no silent brief guess)', () => {
		// Bare = task ALWAYS (the task machinery downstream reports "absent");
		// the only thing that diverts a bare slug is a brief COLLISION, below.
		const resolved = resolveSlug({
			arg: 'ghost',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(resolved.namespace).toBe('task');
		expect(resolved.slug).toBe('ghost');
	});

	it('a bare slug ERRORS on a task/brief collision (never silently guesses)', () => {
		// Seed BOTH a task and a brief named `auto-slice` — the ADR's example.
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
			expect((err as Error).message).toContain('task:auto-slice');
			expect((err as Error).message).toContain('brief:auto-slice');
		}
	});

	it('a bare slug ERRORS on collision even when the brief is mid-slice (body stays in work/briefs/ready/)', () => {
		// A brief currently being sliced KEEPS its body in work/briefs/ready/<slug>.md (the slicing
		// lock no longer moves it — the `slicing/` folder is retired; the in-flight state
		// is the per-item lock ref). The brief namespace still claims the slug via its
		// ready/ residence, so a bare slug is still ambiguous.
		writeItem('backlog', 'shared.md', {slug: 'shared'});
		writeItem('prd', 'shared.md', {slug: 'shared'});

		expect(() =>
			resolveSlug({
				arg: 'shared',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);
	});

	it('an explicit task: prefix is ALWAYS unambiguous — resolves to the task even on a collision, no error', () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});

		const resolved = resolveSlug({
			arg: 'task:auto-slice',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'task',
			slug: 'auto-slice',
			explicit: true,
		});
	});

	it('an explicit brief: prefix is ALWAYS unambiguous — resolves to the brief even on a collision, no error', () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});

		const resolved = resolveSlug({
			arg: 'brief:auto-slice',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});

		expect(resolved).toEqual({
			namespace: 'brief',
			slug: 'auto-slice',
			explicit: true,
		});
	});

	it('an explicit prefix does NOT pay the existence read (unambiguous by construction)', () => {
		// With NO files seeded, an explicit brief: still resolves (it is collision-
		// proof by construction; the check is the bare path's concern only).
		const resolved = resolveSlug({
			arg: 'brief:never-written',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(resolved.namespace).toBe('brief');
	});

	it('the HARD CUTOVER: a pre-rename slice:/prd: arg is NOT accepted as the old namespace (resolves as a bare literal task)', () => {
		// After the cutover `slice:foo` is no longer a task prefix — it parses as a
		// bare slug whose literal text is `slice:foo` (resolved to the TASK
		// namespace because bare = task), NOT the old `slice` namespace. Likewise
		// `prd:foo` is no longer the brief prefix.
		const slice = resolveSlug({
			arg: 'slice:foo',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(slice).toEqual({
			namespace: 'task',
			slug: 'slice:foo',
			explicit: false,
		});
		const prd = resolveSlug({
			arg: 'prd:foo',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(prd).toEqual({namespace: 'task', slug: 'prd:foo', explicit: false});
	});

	it('the brief existence check resolves the slug from frontmatter, not just the filename', () => {
		// A brief file named oddly but whose frontmatter slug matches still collides.
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

describe('parseSlugArg — the NEW obs: / observation: namespace', () => {
	it('strips an explicit obs: prefix to the observation namespace', () => {
		expect(parseSlugArg('obs:foo')).toEqual({
			explicit: 'observation',
			slug: 'foo',
		});
	});

	it('strips the canonical observation: long form too', () => {
		expect(parseSlugArg('observation:foo')).toEqual({
			explicit: 'observation',
			slug: 'foo',
		});
	});

	it('does NOT treat a slug that merely starts like obs as prefixed', () => {
		expect(parseSlugArg('obsolete')).toEqual({
			explicit: undefined,
			slug: 'obsolete',
		});
	});
});

describe('resolveAdvanceArg — the advance verb resolver (task/brief/obs, bare = task)', () => {
	it('resolves an explicit obs: arg to the NEW observation namespace (no existence check)', () => {
		const resolved = resolveAdvanceArg({
			arg: 'obs:bar',
			repoPath: repoPath(),
			read: currentLedgerRead,
		});
		expect(resolved).toEqual({
			namespace: 'observation',
			slug: 'bar',
			explicit: true,
		});
	});

	it('resolves the canonical observation: long form to the observation namespace', () => {
		expect(
			resolveAdvanceArg({
				arg: 'observation:bar',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}).namespace,
		).toBe('observation');
	});

	it('resolves an explicit brief: arg to the brief namespace (unambiguous by construction)', () => {
		expect(
			resolveAdvanceArg({
				arg: 'brief:autoslice',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toEqual({namespace: 'brief', slug: 'autoslice', explicit: true});
	});

	it('a bare slug resolves to the TASK when no brief shares it (bare = task, as do has it)', () => {
		writeItem('backlog', 'feature.md', {slug: 'feature'});
		expect(
			resolveAdvanceArg({
				arg: 'feature',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toEqual({namespace: 'task', slug: 'feature', explicit: false});
	});

	it('keeps the bare-slug cross-check: ERRORS on a task/brief collision (same as do)', () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});
		expect(() =>
			resolveAdvanceArg({
				arg: 'auto-slice',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);
	});

	it('an observation sharing a slug does NOT make a bare slug ambiguous (bare stays the task)', () => {
		// Only a task/brief collision diverts a bare slug; an observation must be
		// named explicitly (obs:<slug>) — the bare path is the task, as everywhere.
		writeItem('backlog', 'shared.md', {slug: 'shared'});
		expect(
			resolveAdvanceArg({
				arg: 'shared',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}).namespace,
		).toBe('task');
	});
});

describe('resolveSlug — `do` does NOT span the observation namespace', () => {
	it('REJECTS a do obs:<slug> arg, pointing the human at `advance obs:`', () => {
		expect(() =>
			resolveSlug({
				arg: 'obs:bar',
				repoPath: repoPath(),
				read: currentLedgerRead,
			}),
		).toThrow(SlugResolutionError);
		try {
			resolveSlug({
				arg: 'obs:bar',
				repoPath: repoPath(),
				read: currentLedgerRead,
			});
		} catch (err) {
			expect((err as Error).message).toContain('advance obs:bar');
		}
	});
});

describe('resolveSliceOnlyArg — the task-only command guard', () => {
	it('accepts a bare slug (= the task)', () => {
		expect(resolveSliceOnlyArg('feature')).toBe('feature');
	});

	it('accepts an explicit task: prefix (the explicit alias) and strips it', () => {
		expect(resolveSliceOnlyArg('task:feature')).toBe('feature');
	});

	it('REJECTS a brief: argument with an "operates on tasks, not briefs" error', () => {
		expect(() => resolveSliceOnlyArg('brief:feature')).toThrow(
			SlugResolutionError,
		);
		try {
			resolveSliceOnlyArg('brief:feature');
		} catch (err) {
			expect((err as Error).message).toContain('tasks, not briefs');
		}
	});

	it('REJECTS an obs: argument with an "operates on tasks, not observations" error', () => {
		expect(() => resolveSliceOnlyArg('obs:bar')).toThrow(SlugResolutionError);
		try {
			resolveSliceOnlyArg('obs:bar');
		} catch (err) {
			expect((err as Error).message).toContain('tasks, not observations');
			expect((err as Error).message).toContain('advance obs:bar');
		}
	});

	it('the HARD CUTOVER: a pre-rename slice: arg is NOT stripped (it is a literal slug, not the old alias)', () => {
		// `slice:feature` is no longer the explicit task prefix; it is a bare slug
		// whose literal text is `slice:feature`, so it passes through verbatim (no
		// strip), NOT mapped to the task `feature`.
		expect(resolveSliceOnlyArg('slice:feature')).toBe('slice:feature');
	});

	it('is PURE — a bare slug on a task-only command never reads files (no brief ambiguity here)', () => {
		// Even with a colliding brief seeded, the task-only path resolves the bare
		// slug straight to the task (the brief namespace is unreachable here), so
		// there is no cross-namespace check and no error.
		writeItem('prd', 'feature.md', {slug: 'feature'});
		expect(resolveSliceOnlyArg('feature')).toBe('feature');
	});
});

describe('ledger-read seam — resolvePrdExistence (the brief read path)', () => {
	it('reports a brief present in work/briefs/ready/', () => {
		writeItem('prd', 'p.md', {slug: 'p'});
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 'p',
		});
		expect(r.exists).toBe(true);
		expect(r.prdFile).toBe('p.md');
		expect(r.prdSlicedFile).toBeUndefined();
	});

	it('reports a brief present only via its work/briefs/tasked/ resting file (already sliced)', () => {
		writeItem('prd-sliced', 's.md', {slug: 's'});
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 's',
		});
		expect(r.exists).toBe(true);
		expect(r.prdFile).toBeUndefined();
		expect(r.prdSlicedFile).toBe('s.md');
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

	it('reports absent when no ready/ or tasked/ record names the slug (no throw on missing folders)', () => {
		const r = currentLedgerRead.resolvePrdExistence({
			repoPath: repoPath(),
			slug: 'nope',
		});
		expect(r.exists).toBe(false);
		expect(r.prdFile).toBeUndefined();
		expect(r.prdSlicedFile).toBeUndefined();
	});
});

describe('workBranchRef / parseWorkBranchRef — the ONE branch-identity derivation', () => {
	it('namespaces the branch by item type (task vs brief) — same slug, DISTINCT refs', () => {
		// The structural bug: a same-slug task and brief collided on `work/<slug>`.
		const task = workBranchRef('task', 'advance-loop');
		const brief = workBranchRef('brief', 'advance-loop');
		expect(task).toBe('work/task-advance-loop');
		expect(brief).toBe('work/brief-advance-loop');
		expect(task).not.toBe(brief);
	});

	it('prefixes an intake-produced branch so it never collides with a build/slicing branch for the same slug', () => {
		// The FIRING collision: `intake` left a branch a later `do task:` reused.
		const intakeTask = workBranchRef('task', 'add-quiet-flag', {
			producer: 'intake',
		});
		const intakeBrief = workBranchRef('brief', 'add-quiet-flag', {
			producer: 'intake',
		});
		const build = workBranchRef('task', 'add-quiet-flag');
		const slicing = workBranchRef('brief', 'add-quiet-flag');
		expect(intakeTask).toBe('work/intake-task-add-quiet-flag');
		expect(intakeBrief).toBe('work/intake-brief-add-quiet-flag');
		// All four forms for ONE slug are mutually distinct (the full collision set).
		const all = [intakeTask, intakeBrief, build, slicing];
		expect(new Set(all).size).toBe(4);
	});

	it('round-trips every form back to {producer?, namespace, slug}', () => {
		expect(parseWorkBranchRef('work/task-foo')).toEqual({
			namespace: 'task',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/brief-foo')).toEqual({
			namespace: 'brief',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/intake-task-foo')).toEqual({
			producer: 'intake',
			namespace: 'task',
			slug: 'foo',
		});
		expect(parseWorkBranchRef('work/intake-brief-foo')).toEqual({
			producer: 'intake',
			namespace: 'brief',
			slug: 'foo',
		});
	});

	it('a slug that literally starts with a type/producer token is NOT mis-parsed', () => {
		// The `slug` group must never swallow the `task-`/`intake-` prefixes.
		expect(parseWorkBranchRef('work/task-intake-task-foo')).toEqual({
			namespace: 'task',
			slug: 'intake-task-foo',
		});
		expect(parseWorkBranchRef('work/intake-brief-task-bar')).toEqual({
			producer: 'intake',
			namespace: 'brief',
			slug: 'task-bar',
		});
	});

	it('the HARD CUTOVER: returns undefined for a non-work / pre-rename branch (old slice-/prd- types rejected, no alias)', () => {
		expect(parseWorkBranchRef('main')).toBeUndefined();
		expect(parseWorkBranchRef('work/foo')).toBeUndefined(); // pre-rename un-namespaced form
		expect(parseWorkBranchRef('work/slice-foo')).toBeUndefined(); // pre-rename slice type
		expect(parseWorkBranchRef('work/prd-foo')).toBeUndefined(); // pre-rename prd type
		expect(parseWorkBranchRef('work/intake-slice-foo')).toBeUndefined();
		expect(parseWorkBranchRef('claim/foo')).toBeUndefined();
		expect(parseWorkBranchRef('feature/x')).toBeUndefined();
	});

	it('workBranchRef and parseWorkBranchRef are inverses (no second derivation)', () => {
		for (const ns of ['task', 'brief'] as const) {
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

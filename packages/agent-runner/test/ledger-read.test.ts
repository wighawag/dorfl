import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	currentLedgerRead,
	ledgerRead,
	type LedgerReadStrategy,
} from '../src/ledger-read.js';
import * as ledgerReadModule from '../src/ledger-read.js';
import {scanRepoPaths, readBacklogItems, readDoneSlugs} from '../src/scan.js';
import {resolveReadiness} from '../src/readiness.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	registerMirrorWithWork,
	seedRepoWithArbiter,
	seedDoneOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';

let root: string;

function writeItem(
	repo: string,
	status: 'backlog' | 'done',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, repo, 'work', fixtureFolderRel(status));
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', body);
	writeFileSync(join(dir, file), lines.join('\n'));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-ledger-read-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
	vi.restoreAllMocks();
});

describe('ledger-read seam — shape', () => {
	it('exposes ONE strategy with the three resolve-methods', () => {
		expect(typeof currentLedgerRead.resolveLocalState).toBe('function');
		expect(typeof currentLedgerRead.resolveArbiterState).toBe('function');
		expect(typeof currentLedgerRead.resolveMirrorState).toBe('function');
		// The active strategy IS the current-behaviour one (no selectable mode).
		expect(ledgerRead).toBe(currentLedgerRead);
	});
});

describe('ledger-read seam — local-tree resolve method', () => {
	it('resolves backlog and done slugs from the local tree', () => {
		writeItem('repo', 'backlog', 'b.md', {
			slug: 'b',
			humanOnly: 'true',
			needsAnswers: 'true',
			blockedBy: '[dep]',
		});
		writeItem('repo', 'done', 'dep.md', {slug: 'dep'});

		const state = currentLedgerRead.resolveLocalState({
			repoPath: join(root, 'repo'),
		});

		expect(state.todo).toHaveLength(1);
		expect(state.todo[0]).toMatchObject({
			file: 'b.md',
			slug: 'b',
			humanOnly: true,
			needsAnswers: true,
			blockedBy: ['dep'],
		});
		expect(state.doneSlugs).toEqual(new Set(['dep']));
	});

	it('is OFFLINE — synchronous, works on a non-repo dir with no remote', () => {
		// `root/repo` is a plain directory (NOT a git repo, no remote). A network
		// read would need a remote and would be async; the local method is neither.
		writeItem('repo', 'backlog', 'a.md', {slug: 'a'});
		const result = currentLedgerRead.resolveLocalState({
			repoPath: join(root, 'repo'),
		});
		// Resolved synchronously (a plain object, never a Promise) — no I/O await.
		expect(result).not.toBeInstanceOf(Promise);
		expect(result.todo.map((i) => i.slug)).toEqual(['a']);
	});
});

describe('ledger-read seam — PRD pool resolve method (the do-autopick PRD source)', () => {
	function writePrd(
		folder: 'prd' | 'tasking' | 'prd-tasked',
		file: string,
		fm: Record<string, string>,
	): void {
		const dir = join(root, 'repo', 'work', fixtureFolderRel(folder));
		mkdirSync(dir, {recursive: true});
		const lines = ['---'];
		for (const [k, v] of Object.entries(fm)) {
			lines.push(`${k}: ${v}`);
		}
		lines.push('---', '', '# PRD');
		writeFileSync(join(dir, file), lines.join('\n'));
	}

	it('enumerates work/prds/ready/*.md with each PRD’s gate axes, sorted by slug', () => {
		writePrd('prd', 'beta.md', {
			slug: 'beta',
			needsAnswers: 'true',
			prdAfter: '[alpha]',
		});
		writePrd('prd', 'alpha.md', {slug: 'alpha', humanOnly: 'true'});

		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['alpha', 'beta']);
		expect(pool.prds[0]).toMatchObject({
			file: 'alpha.md',
			slug: 'alpha',
			humanOnly: true,
			prdAfter: [],
		});
		expect(pool.prds[1]).toMatchObject({
			slug: 'beta',
			needsAnswers: true,
			prdAfter: ['alpha'],
		});
	});

	it('collects already-TASKED slugs from `work/prds/tasked/` RESIDENCE (the folder is the SOLE source of truth; the `tasked:` marker was removed)', () => {
		// alpha + gamma rest in prd-tasked/ (tasked); beta is still to-task in prd/.
		writePrd('prd-tasked', 'alpha.md', {slug: 'alpha'});
		writePrd('prd', 'beta.md', {slug: 'beta'});
		writePrd('prd-tasked', 'gamma.md', {slug: 'gamma'});
		// An INERT leftover `tasked:` line on a PRD still in prd/ does NOT count (folder
		// = truth; the marker was removed in remove-sliced-marker-step-b, so the line is
		// ignored): delta carries one but resides in prd/, so it is NOT tasked.
		writePrd('prd', 'delta.md', {slug: 'delta', tasked: '2026-03-03'});

		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.taskedSlugs).toEqual(new Set(['alpha', 'gamma']));
	});

	it('is OFFLINE/synchronous and reads an absent work/prd as an empty pool', () => {
		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool).not.toBeInstanceOf(Promise);
		expect(pool.prds).toEqual([]);
		expect(pool.taskedSlugs).toEqual(new Set());
	});

	it('falls back to the filename when a PRD has no slug frontmatter', () => {
		writePrd('prd', 'no-slug.md', {title: 'x'});
		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['no-slug']);
	});
});

describe('ledger-read seam — pool noun vocabulary (task `f1-pool-noun-todo-in-surface-and-apply-readers`)', () => {
	// Asserts the F1 vocabulary cutover: the agent POOL lives at `work/tasks/todo/`
	// and shows up as `state.todo`; STAGING lives at `work/tasks/backlog/` and is
	// NOT in the pool (it is surfaced through a separate F2 reader). No touched
	// reader treats `backlog` as the pool any more.
	function writeRaw(folderRel: string, file: string, slug: string): void {
		const dir = join(root, 'repo', 'work', folderRel);
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, file),
			['---', `slug: ${slug}`, '---', '', 'body'].join('\n'),
		);
	}

	it('local resolveLocalState maps `tasks/todo` → the pool (`state.todo`) and IGNORES `tasks/backlog` (staging)', () => {
		writeRaw('tasks/todo', 'pool-item.md', 'pool-item');
		writeRaw('tasks/backlog', 'staging-item.md', 'staging-item');

		const state = currentLedgerRead.resolveLocalState({
			repoPath: join(root, 'repo'),
		});

		// `state.todo` IS the pool (`work/tasks/todo/`).
		expect(state.todo.map((i) => i.slug)).toEqual(['pool-item']);
		// Crucially, the staging folder (`work/tasks/backlog/`) is NOT in this pool.
		// If a stale reader still treated `backlog` as the pool this would fail.
		expect(state.todo.map((i) => i.slug)).not.toContain('staging-item');
		// And the shape of LocalLedgerState exposes the pool under the `todo` field
		// (the F1 rename); there is no `backlog` pool field on the resolved state.
		expect((state as unknown as {backlog?: unknown}).backlog).toBeUndefined();
	});

	it('mirror-side resolveMirrorState maps `tasks/todo` → the pool, same as local', async () => {
		const scratch = makeScratch('agent-runner-ledger-read-pool-noun-');
		try {
			const ws = join(scratch.root, '.agent-runner');
			const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
				// The fixture word `backlog` maps to the POOL key `tasks-todo` (the
				// existing fixture-word seam — see `fixtureFolderRel`), exactly the
				// pool a `state.todo` reader expects.
				backlog: {
					'pool-item.md': ['---', 'slug: pool-item', '---', '', ''].join('\n'),
				},
				// `pre-backlog` maps to the STAGING key `tasks-backlog` — must NOT show
				// up in `state.todo`.
				'pre-backlog': {
					'staging-item.md': ['---', 'slug: staging-item', '---', '', ''].join(
						'\n',
					),
				},
			});

			const state = await currentLedgerRead.resolveMirrorState({
				mirrorPath,
				env: gitEnv(),
			});

			expect(state.todo.map((i) => i.slug)).toEqual(['pool-item']);
			expect(state.todo.map((i) => i.slug)).not.toContain('staging-item');
		} finally {
			scratch.cleanup();
		}
	});
});

describe('ledger-read seam — readers route THROUGH it', () => {
	it('readBacklogItems / readDoneSlugs / scanRepoPaths go through resolveLocalState', () => {
		writeItem('repo', 'backlog', 'a.md', {slug: 'a'});
		writeItem('repo', 'done', 'd.md', {slug: 'd'});

		const spy = vi.spyOn(ledgerReadModule.ledgerRead, 'resolveLocalState');

		readBacklogItems(join(root, 'repo'));
		readDoneSlugs(join(root, 'repo'));
		// The working-tree scan (run / in-place) routes through the local method;
		// the registry `scan` routes through resolveMirrorState (covered below).
		scanRepoPaths([join(root, 'repo')], mergeConfig({autoBuild: true}));

		expect(spy).toHaveBeenCalled();
		// Every call carried the storage-agnostic input (a repoPath only).
		for (const call of spy.mock.calls) {
			expect(Object.keys(call[0])).toEqual(['repoPath']);
		}
	});
});

describe('ledger-read seam — arbiter resolve method', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-ledger-read-arb-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('resolves the task + done slugs from <arbiter>/main', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		seedDoneOnArbiter(seeded, 'dep-a');
		// The seam's arbiter method (like the inline reads it replaced) assumes the
		// caller already fetched — the claim/readiness path fetches before reading.
		gitIn(['fetch', '-q', 'arbiter'], seeded.repo);

		const state = await currentLedgerRead.resolveArbiterState({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		expect(state.task).toMatch(/slug: feature/);
		expect(state.doneSlugs.has('dep-a')).toBe(true);
	});

	it('readiness resolves THROUGH resolveArbiterState', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		const spy = vi.spyOn(ledgerReadModule.ledgerRead, 'resolveArbiterState');

		const verdict = await resolveReadiness({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			override: false,
			env: gitEnv(),
		});

		expect(spy).toHaveBeenCalledTimes(1);
		// Storage-agnostic input: only the semantic fields, no baked-in path.
		expect(spy.mock.calls[0][0]).toMatchObject({
			slug: 'feature',
			arbiter: 'arbiter',
		});
		// Behaviour byte-identical: dep-a not done ⇒ refuse, naming the blocker.
		expect(verdict.refuse).toBe(true);
		expect(verdict.missing).toEqual(['dep-a']);
	});
});

describe('ledger-read seam — mirror-ref resolve method (bare hub mirror)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-ledger-read-mirror-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	function task(frontmatter: Record<string, string>, body = 'body'): string {
		const lines = ['---'];
		for (const [k, v] of Object.entries(frontmatter)) {
			lines.push(`${k}: ${v}`);
		}
		lines.push('---', '', body);
		return lines.join('\n');
	}

	it('resolves the FULL work/ lifecycle (backlog + done) from a BARE mirror main ref', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'b.md': task({
					slug: 'b',
					humanOnly: 'true',
					needsAnswers: 'true',
					blockedBy: '[dep]',
				}),
			},
			done: {'dep.md': task({slug: 'dep'})},
		});

		// Sanity: it IS bare (no working tree), so resolveLocalState could not read it.
		expect(
			gitIn(['rev-parse', '--is-bare-repository'], mirrorPath).trim(),
		).toBe('true');

		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});

		expect(state.todo).toHaveLength(1);
		expect(state.todo[0]).toMatchObject({
			file: 'b.md',
			slug: 'b',
			humanOnly: true,
			needsAnswers: true,
			blockedBy: ['dep'],
		});
		expect(state.doneSlugs).toEqual(new Set(['dep']));
	});

	it('reads the mirror-LOCAL `main` ref (default), not origin/main', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'only.md': task({slug: 'only'})},
		});
		// A bare mirror has no `origin/main` remote-tracking ref — reading it would
		// fail. The default `main:` ref (mirror-local branch) must be what's read.
		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});
		expect(state.todo.map((i) => i.slug)).toEqual(['only']);
	});

	it('returns empty sets for folders absent on the ref (no throw)', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': task({slug: 'a'})},
		});
		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});
		expect(state.doneSlugs).toEqual(new Set());
	});
});

describe('ledger-read seam — mirror-ref PRD pool method (the mirror-side do-autopick PRD source)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-ledger-read-mirror-prd-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	function prd(frontmatter: Record<string, string>): string {
		const lines = ['---'];
		for (const [k, v] of Object.entries(frontmatter)) {
			lines.push(`${k}: ${v}`);
		}
		lines.push('---', '', '# PRD');
		return lines.join('\n');
	}

	it('enumerates work/prds/ready/*.md (gate axes, sorted by slug) + prd-tasked/ residence from a BARE mirror main ref — the resolvePrdPool counterpart', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			prd: {
				'beta.md': prd({
					slug: 'beta',
					needsAnswers: 'true',
					prdAfter: '[alpha]',
				}),
				'gamma.md': prd({slug: 'gamma', humanOnly: 'true'}),
			},
			prdTasked: {'alpha.md': prd({slug: 'alpha'})},
		});

		const pool = await currentLedgerRead.resolveMirrorPrdPool({
			mirrorPath,
			env: gitEnv(),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['beta', 'gamma']);
		expect(pool.prds[0]).toMatchObject({
			file: 'beta.md',
			slug: 'beta',
			needsAnswers: true,
			prdAfter: ['alpha'],
		});
		expect(pool.prds[1]).toMatchObject({slug: 'gamma', humanOnly: true});
		// Tasked-ness is RESIDENCE in prd-tasked/ (the folder is the source of truth).
		expect(pool.taskedSlugs).toEqual(new Set(['alpha']));
	});

	it('falls back to the filename for a PRD with no slug frontmatter', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			prd: {'no-slug.md': '---\ntitle: x\n---\n\n# PRD'},
		});
		const pool = await currentLedgerRead.resolveMirrorPrdPool({
			mirrorPath,
			env: gitEnv(),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['no-slug']);
	});

	it('reads an absent work/prd as an empty pool (no throw)', async () => {
		const ws = join(scratch.root, '.agent-runner');
		// No prd/ folder seeded (only a done/ entry) — the pool reads as empty.
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			done: {'a.md': prd({slug: 'a'})},
		});
		const pool = await currentLedgerRead.resolveMirrorPrdPool({
			mirrorPath,
			env: gitEnv(),
		});
		expect(pool.prds).toEqual([]);
		expect(pool.taskedSlugs).toEqual(new Set());
	});
});

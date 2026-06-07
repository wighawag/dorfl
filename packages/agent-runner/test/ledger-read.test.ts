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
import {readNeedsAttentionItems} from '../src/needs-attention.js';
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
} from './helpers/gitRepo.js';

let root: string;

function writeItem(
	repo: string,
	status: 'backlog' | 'done' | 'needs-attention',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, repo, 'work', status);
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
	it('resolves backlog, done slugs and needs-attention from the local tree', () => {
		writeItem('repo', 'backlog', 'b.md', {
			slug: 'b',
			humanOnly: 'true',
			needsAnswers: 'true',
			blockedBy: '[dep]',
		});
		writeItem('repo', 'done', 'dep.md', {slug: 'dep'});
		writeItem(
			'repo',
			'needs-attention',
			'stuck.md',
			{slug: 'stuck'},
			'## Needs attention\n\nred gate',
		);

		const state = currentLedgerRead.resolveLocalState({
			repoPath: join(root, 'repo'),
		});

		expect(state.backlog).toHaveLength(1);
		expect(state.backlog[0]).toMatchObject({
			file: 'b.md',
			slug: 'b',
			humanOnly: true,
			needsAnswers: true,
			blockedBy: ['dep'],
		});
		expect(state.doneSlugs).toEqual(new Set(['dep']));
		expect(state.needsAttention).toHaveLength(1);
		expect(state.needsAttention[0].slug).toBe('stuck');
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
		expect(result.backlog.map((i) => i.slug)).toEqual(['a']);
	});
});

describe('ledger-read seam — PRD pool resolve method (the do-autopick PRD source)', () => {
	function writePrd(
		folder: 'prd' | 'slicing',
		file: string,
		fm: Record<string, string>,
	): void {
		const dir = join(root, 'repo', 'work', folder);
		mkdirSync(dir, {recursive: true});
		const lines = ['---'];
		for (const [k, v] of Object.entries(fm)) {
			lines.push(`${k}: ${v}`);
		}
		lines.push('---', '', '# PRD');
		writeFileSync(join(dir, file), lines.join('\n'));
	}

	it('enumerates work/prd/*.md with each PRD’s gate axes, sorted by slug', () => {
		writePrd('prd', 'beta.md', {
			slug: 'beta',
			needsAnswers: 'true',
			sliceAfter: '[alpha]',
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
			sliceAfter: [],
		});
		expect(pool.prds[1]).toMatchObject({
			slug: 'beta',
			needsAnswers: true,
			sliceAfter: ['alpha'],
		});
	});

	it('collects already-SLICED slugs from the `sliced:` marker (prd + slicing folders)', () => {
		writePrd('prd', 'alpha.md', {slug: 'alpha', sliced: '2026-01-01'});
		writePrd('prd', 'beta.md', {slug: 'beta'});
		// a PRD in flight under the lock still carries its prior marker.
		writePrd('slicing', 'gamma.md', {slug: 'gamma', sliced: '2026-02-02'});

		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.slicedSlugs).toEqual(new Set(['alpha', 'gamma']));
	});

	it('is OFFLINE/synchronous and reads an absent work/prd as an empty pool', () => {
		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool).not.toBeInstanceOf(Promise);
		expect(pool.prds).toEqual([]);
		expect(pool.slicedSlugs).toEqual(new Set());
	});

	it('falls back to the filename when a PRD has no slug frontmatter', () => {
		writePrd('prd', 'no-slug.md', {title: 'x'});
		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['no-slug']);
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
		scanRepoPaths([join(root, 'repo')], mergeConfig({allowAgents: true}));

		expect(spy).toHaveBeenCalled();
		// Every call carried the storage-agnostic input (a repoPath only).
		for (const call of spy.mock.calls) {
			expect(Object.keys(call[0])).toEqual(['repoPath']);
		}
	});

	it('readNeedsAttentionItems goes through resolveLocalState', () => {
		writeItem(
			'repo',
			'needs-attention',
			'x.md',
			{slug: 'x'},
			'## Needs attention\n\nstuck',
		);
		const spy = vi.spyOn(ledgerReadModule.ledgerRead, 'resolveLocalState');
		const items = readNeedsAttentionItems(join(root, 'repo'));
		expect(spy).toHaveBeenCalled();
		expect(items[0].reason).toBe('stuck');
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

	it('resolves the slice + done slugs from <arbiter>/main', async () => {
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

		expect(state.slice).toMatch(/slug: feature/);
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

	function slice(frontmatter: Record<string, string>, body = 'body'): string {
		const lines = ['---'];
		for (const [k, v] of Object.entries(frontmatter)) {
			lines.push(`${k}: ${v}`);
		}
		lines.push('---', '', body);
		return lines.join('\n');
	}

	it('resolves the FULL work/ lifecycle (backlog + done + needs-attention) from a BARE mirror main ref', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'b.md': slice({
					slug: 'b',
					humanOnly: 'true',
					needsAnswers: 'true',
					blockedBy: '[dep]',
				}),
			},
			done: {'dep.md': slice({slug: 'dep'})},
			needsAttention: {
				'stuck.md': slice({slug: 'stuck'}, '## Needs attention\n\nred gate'),
			},
		});

		// Sanity: it IS bare (no working tree), so resolveLocalState could not read it.
		expect(
			gitIn(['rev-parse', '--is-bare-repository'], mirrorPath).trim(),
		).toBe('true');

		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});

		expect(state.backlog).toHaveLength(1);
		expect(state.backlog[0]).toMatchObject({
			file: 'b.md',
			slug: 'b',
			humanOnly: true,
			needsAnswers: true,
			blockedBy: ['dep'],
		});
		expect(state.doneSlugs).toEqual(new Set(['dep']));
		expect(state.needsAttention).toHaveLength(1);
		expect(state.needsAttention[0].slug).toBe('stuck');
		expect(state.needsAttention[0].content).toMatch(/red gate/);
	});

	it('reads the mirror-LOCAL `main` ref (default), not origin/main', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'only.md': slice({slug: 'only'})},
		});
		// A bare mirror has no `origin/main` remote-tracking ref — reading it would
		// fail. The default `main:` ref (mirror-local branch) must be what's read.
		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});
		expect(state.backlog.map((i) => i.slug)).toEqual(['only']);
	});

	it('returns empty sets for folders absent on the ref (no throw)', async () => {
		const ws = join(scratch.root, '.agent-runner');
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': slice({slug: 'a'})},
		});
		const state = await currentLedgerRead.resolveMirrorState({
			mirrorPath,
			env: gitEnv(),
		});
		expect(state.doneSlugs).toEqual(new Set());
		expect(state.needsAttention).toEqual([]);
	});
});

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
import {scan, readBacklogItems, readDoneSlugs} from '../src/scan.js';
import {readNeedsAttentionItems} from '../src/needs-attention.js';
import {resolveReadiness} from '../src/readiness.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
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
	it('exposes ONE strategy with the two resolve-methods', () => {
		expect(typeof currentLedgerRead.resolveLocalState).toBe('function');
		expect(typeof currentLedgerRead.resolveArbiterState).toBe('function');
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

describe('ledger-read seam — readers route THROUGH it', () => {
	it('scan / readBacklogItems / readDoneSlugs go through resolveLocalState', () => {
		writeItem('repo', 'backlog', 'a.md', {slug: 'a'});
		writeItem('repo', 'done', 'd.md', {slug: 'd'});

		const spy = vi.spyOn(ledgerReadModule.ledgerRead, 'resolveLocalState');

		readBacklogItems(join(root, 'repo'));
		readDoneSlugs(join(root, 'repo'));
		scan(mergeConfig({roots: [root], allowAgents: true}));

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

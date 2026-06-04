import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	currentLedgerWrite,
	ledgerWrite,
	type LedgerWriteStrategy,
} from '../src/ledger-write.js';
import * as ledgerWriteModule from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-ledger-write-');
});
afterEach(() => {
	scratch.cleanup();
	vi.restoreAllMocks();
});

describe('ledger-write seam — shape', () => {
	it('exposes ONE strategy with the apply-transition method', () => {
		expect(typeof currentLedgerWrite.applyTransition).toBe('function');
		// The active strategy IS the current-behaviour one (no selectable mode).
		expect(ledgerWrite).toBe(currentLedgerWrite);
	});

	it('the public input shape is storage-agnostic (does NOT name `main`)', () => {
		// A static guard: the type is exercised below, but assert here that the
		// strategy is just an object implementing the interface — `main` is an
		// implementation detail of the strategy, never part of what callers pass.
		const strategy: LedgerWriteStrategy = currentLedgerWrite;
		expect(Object.keys(strategy)).toEqual(['applyTransition']);
	});
});

describe('ledger-write seam — claim is dispatched THROUGH it', () => {
	it('performClaim routes the claim transition via ledgerWrite.applyTransition', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const spy = vi.spyOn(ledgerWriteModule.ledgerWrite, 'applyTransition');

		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(spy).toHaveBeenCalled();
		// The claim transition kind was the one dispatched, and the public input
		// carried NO `main` (storage-agnostic): only semantic + plumbing fields.
		const input = spy.mock.calls[0][0];
		expect(input.kind).toBe('claim');
		expect(Object.keys(input)).not.toContain('main');
		expect(JSON.stringify(Object.keys(input))).not.toMatch(/main/i);
	});

	it('the strategy CAS-publishes the claim so it lands on the arbiter', async () => {
		// End-to-end through the real strategy: the claim micro-commit lands.
		const {repo} = seedRepoWithArbiter(scratch.root, ['beta']);
		const result = await performClaim({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(false);
	});

	it('a rejected publish (stale lease) is surfaced as rejected, not published', async () => {
		// Drive the strategy directly with a deliberately STALE expected base so
		// the --force-with-lease fails: the seam must report `rejected`.
		const {repo} = seedRepoWithArbiter(scratch.root, ['gamma']);
		// Prepare a real claim commit on a local branch off arbiter/main.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['checkout', '-q', '-b', 'claim/gamma', 'arbiter/main'], repo);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/gamma.md', 'work/in-progress/gamma.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim: gamma'], repo);
		const head = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const res = await currentLedgerWrite.applyTransition({
			kind: 'claim',
			arbiter: 'arbiter',
			localBranch: 'claim/gamma',
			// A bogus base the arbiter's ledger is NOT at ⇒ the lease must fail.
			expectedBase: '0000000000000000000000000000000000000000',
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(res.kind).toBe('rejected');
		// Nothing landed.
		expect(existsOnArbiterMain(repo, 'in-progress', 'gamma')).toBe(false);
	});
});

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
import {performComplete} from '../src/complete.js';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
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
	scratch = makeScratch('dorfl-ledger-write-');
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
		expect(Object.keys(strategy)).toEqual([
			'applyTransition',
			'applyCompleteTransition',
			'applyNeedsAttentionTransition',
			'applyReturnToBacklogTransition',
			'applyTreelessNeedsAttentionTransition',
			'applyResolveNeedsAttentionTransition',
		]);
	});
});

describe('ledger-write seam — a claim-kind transition is dispatched THROUGH it', () => {
	// NB: `performClaim` itself NO LONGER routes through this seam — the lock-substrate
	// cut-over (task `cutover-claim-body-stays-and-complete-sources-from-backlog`)
	// made claim acquire a per-item lock and write NOTHING to `main`, so there is no
	// `claim`-kind `applyTransition` dispatch from `performClaim` any more. The seam's
	// `kind: 'claim'` path is still exercised DIRECTLY here (a hand-built claim
	// micro-commit) because the seam itself (the `main`-CAS publish primitive) remains
	// the mechanism complete/tasking/needs-attention land their durable moves through.
	it('a claim-kind transition published directly through the seam lands the move on the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['beta']);
		const spy = vi.spyOn(ledgerWriteModule.ledgerWrite, 'applyTransition');
		// Build a real claim micro-commit (backlog → in-progress) on a local branch off
		// arbiter/main and publish it through the seam, the SAME way the seam is used
		// for any durable `main` move.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['checkout', '-q', '-B', 'claim/beta', 'arbiter/main'], repo);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/tasks/ready/beta.md', 'work/in-progress/beta.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim: beta'], repo);
		const base = gitIn(['rev-parse', 'arbiter/main'], repo).trim();
		const head = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const res = await ledgerWriteModule.ledgerWrite.applyTransition({
			kind: 'claim',
			arbiter: 'arbiter',
			localBranch: 'claim/beta',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(res.kind).toBe('published');
		expect(spy).toHaveBeenCalled();
		// The public input carried NO `main` (storage-agnostic): semantic + plumbing only.
		const input = spy.mock.calls[0][0];
		expect(input.kind).toBe('claim');
		expect(Object.keys(input)).not.toContain('main');
		expect(JSON.stringify(Object.keys(input))).not.toMatch(/main/i);
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
		gitIn(
			['mv', 'work/tasks/ready/gamma.md', 'work/in-progress/gamma.md'],
			repo,
		);
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

describe('ledger-write seam — the per-attempt CAS nonce (authoritative for same-identity racers)', () => {
	/** Build a real claim micro-commit on a fresh local branch off arbiter/main. */
	async function prepareClaim(
		repo: string,
		slug: string,
		branch: string,
	): Promise<{base: string; head: string}> {
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['checkout', '-q', '-B', branch, 'arbiter/main'], repo);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/in-progress/${slug}.md`],
			repo,
		);
		gitIn(['commit', '-q', '-m', `claim: ${slug}`], repo);
		const base = gitIn(['rev-parse', 'arbiter/main'], repo).trim();
		const head = gitIn(['rev-parse', 'HEAD'], repo).trim();
		return {base, head};
	}

	it('stamps a CAS-Nonce trailer so the LANDED sha is unique (publishedHead !== the input head)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['delta']);
		const {base, head} = await prepareClaim(repo, 'delta', 'claim/delta');

		const res = await currentLedgerWrite.applyTransition({
			kind: 'claim',
			arbiter: 'arbiter',
			localBranch: 'claim/delta',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(res.kind).toBe('published');
		// The landed sha is the nonce'd descendant-in-content, NOT the pre-nonce head.
		expect(res.publishedHead).toBeTruthy();
		expect(res.publishedHead).not.toBe(head);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const arbiterMain = gitIn(['rev-parse', 'arbiter/main'], repo).trim();
		expect(arbiterMain).toBe(res.publishedHead);
		// The trailer round-trips as a real git trailer on the landed commit, and the
		// original subject/tree are preserved (same tree, subject still `claim: delta`).
		const trailer = gitIn(
			['log', '-1', '--format=%(trailers:key=CAS-Nonce)', arbiterMain],
			repo,
		).trim();
		expect(trailer).toMatch(/^CAS-Nonce: \S+/);
		expect(gitIn(['log', '-1', '--format=%s', arbiterMain], repo).trim()).toBe(
			'claim: delta',
		);
		expect(gitIn(['rev-parse', `${arbiterMain}^{tree}`], repo).trim()).toBe(
			gitIn(['rev-parse', `${head}^{tree}`], repo).trim(),
		);
	});

	it('a SECOND publish of byte-identical content/identity off the SAME base is REJECTED, not a spurious up-to-date publish', async () => {
		// The PRODUCT defect (#90 only fixed the TEST): two same-identity racers build
		// an identical claim commit off the same base. The FIRST lands; the SECOND,
		// WITHOUT the nonce, would push the SAME sha, degrade to "Everything
		// up-to-date", and verify X === X ⇒ spuriously published. With the per-attempt
		// nonce the second attempt's sha is DISTINCT, its lease (base now stale) is
		// genuinely rejected, and the verify correctly fails ⇒ rejected.
		const {repo} = seedRepoWithArbiter(scratch.root, ['epsilon']);
		const {base, head} = await prepareClaim(repo, 'epsilon', 'claim/epsilon');

		const first = await currentLedgerWrite.applyTransition({
			kind: 'claim',
			arbiter: 'arbiter',
			localBranch: 'claim/epsilon',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(first.kind).toBe('published');

		// Re-publish the SAME prepared branch (same identity, same tree, same message,
		// same stale base) — the loser's situation. Must be rejected.
		const second = await currentLedgerWrite.applyTransition({
			kind: 'claim',
			arbiter: 'arbiter',
			localBranch: 'claim/epsilon',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(second.kind).toBe('rejected');
		expect(second.publishedHead).toBeUndefined();
		// The first publish's commit is still the tip — the second changed nothing.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(gitIn(['rev-parse', 'arbiter/main'], repo).trim()).toBe(
			first.publishedHead,
		);
	});
});

describe('ledger-write seam — shape (complete transition)', () => {
	it('exposes the complete transition on the SAME strategy', () => {
		expect(typeof currentLedgerWrite.applyCompleteTransition).toBe('function');
		expect(ledgerWrite).toBe(currentLedgerWrite);
	});
});

describe('ledger-write seam — complete is dispatched THROUGH it', () => {
	/** Claim a task, then onboard onto its work branch (the pre-complete state). */
	async function claimAndBranch(slug: string): Promise<string> {
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		const claim = await performClaim({
			slug,
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, 'arbiter/main'], repo);
		return repo;
	}

	it('performComplete routes the complete transition via ledgerWrite.applyCompleteTransition', async () => {
		const repo = await claimAndBranch('alpha');
		writeFileSync(`${repo}/feature.txt`, 'the work\n');
		const spy = vi.spyOn(
			ledgerWriteModule.ledgerWrite,
			'applyCompleteTransition',
		);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			integration: 'propose',
			verify: 'exit 0',
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(spy).toHaveBeenCalledTimes(1);
		// The complete transition carried the work branch + mode + provider, and the
		// public input is storage-agnostic (it does NOT name `main`).
		const input = spy.mock.calls[0][0];
		expect(input.branch).toBe('work/task-alpha');
		expect(input.mode).toBe('propose');
		expect(JSON.stringify(Object.keys(input))).not.toMatch(/main/i);
	});

	it('the strategy integrates the work so merge lands it on the arbiter ledger', async () => {
		const repo = await claimAndBranch('beta');
		writeFileSync(`${repo}/feature.txt`, 'merged work\n');
		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			integration: 'merge',
			verify: 'exit 0',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(false);
	});
});

describe('ledger-write seam — shape (needs-attention transition)', () => {
	it('exposes the needs-attention + return-to-backlog transitions on the SAME strategy', () => {
		expect(typeof currentLedgerWrite.applyNeedsAttentionTransition).toBe(
			'function',
		);
		expect(typeof currentLedgerWrite.applyReturnToBacklogTransition).toBe(
			'function',
		);
		expect(ledgerWrite).toBe(currentLedgerWrite);
	});
});

describe('ledger-write seam — needs-attention is dispatched THROUGH it', () => {
	/** Claim a task, onboard onto its work branch, then leave uncommitted work. */
	async function claimBranchAndEdit(slug: string): Promise<string> {
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		const claim = await performClaim({
			slug,
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, 'arbiter/main'], repo);
		writeFileSync(`${repo}/feature.txt`, 'the work\n');
		return repo;
	}

	it("complete's gate-failed abort routes needs-attention via the seam", async () => {
		const repo = await claimBranchAndEdit('alpha');
		const spy = vi.spyOn(
			ledgerWriteModule.ledgerWrite,
			'applyNeedsAttentionTransition',
		);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			integration: 'propose',
			// A RED gate so complete's abort path routes to needs-attention.
			verify: 'exit 1',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('gate-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		// The transition input is the storage-agnostic needs-attention shape — slug +
		// reason prose, NOT a `main`/folder destination (the strategy owns that).
		const input = spy.mock.calls[0][0];
		expect(input.slug).toBe('alpha');
		expect(input.reason).toMatch(/acceptance gate failed/);
		expect(JSON.stringify(Object.keys(input))).not.toMatch(/main/i);
	});

	it('the strategy bounces the item to needs-attention (behaviour-identical)', async () => {
		const repo = await claimBranchAndEdit('beta');
		const res = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'a stuck reason',
			env: gitEnv(),
		});
		// Local-only (no arbiter): the bounce is a no-op lock amend (a human is right
		// there). NO folder move — the body stays in backlog/, no needs-attention/.
		expect(res.moved).toBe(true);
		expect(existsSync(`${repo}/work/needs-attention/beta.md`)).toBe(false);
		expect(existsSync(`${repo}/work/tasks/ready/beta.md`)).toBe(true);
	});

	it('the return-to-backlog re-queue is dispatched via the seam', async () => {
		const repo = await claimBranchAndEdit('gamma');
		// Commit + push the work branch (the continue-branch the default requeue's
		// safety guard checks for) and surface to needs-attention ON THE ARBITER.
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip gamma'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/task-gamma:work/task-gamma'], repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'resolved later',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const spy = vi.spyOn(
			ledgerWriteModule.ledgerWrite,
			'applyReturnToBacklogTransition',
		);
		// The re-queue is now a TREE-LESS CAS to the arbiter (parity with claim).
		const res = await ledgerWrite.applyReturnToBacklogTransition({
			cwd: repo,
			slug: 'gamma',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(res.moved).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
	});
});

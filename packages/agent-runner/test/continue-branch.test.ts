import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	branchAheadOf,
	rebaseContinuedBranchOntoMain,
} from '../src/continue-branch.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-continue-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('branchAheadOf', () => {
	it('is false when the branch ref is absent (fresh cut, no continue)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('is true when the branch exists ahead of main (work to continue)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Cut a work branch with a commit beyond main, push it to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior attempt\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(true);
	});

	it('is false when the branch is fully merged into main (nothing beyond)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// A work branch at the SAME tip as main (no commits beyond).
		gitIn(['branch', 'work/slice-alpha', 'arbiter/main'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('works against a BARE mirror with local heads (job-worktree refs)', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Push a work branch ahead of main to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);

		// A bare mirror clone of the arbiter — local heads `main` + `work/slice-alpha`.
		const mirror = join(scratch.root, 'mirror.git');
		gitIn(['clone', '-q', '--bare', `file://${arbiter}`, mirror], scratch.root);
		expect(branchAheadOf(mirror, 'work/slice-alpha', 'main', gitEnv())).toBe(
			true,
		);
	});
});

describe('rebaseContinuedBranchOntoMain', () => {
	it('replays a clean continued branch onto a moved main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Prior attempt branch off the original main.
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();

		// Main moves (a non-conflicting file) on the arbiter.
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'unrelated.txt'), 'unrelated\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main moved'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// The work commit was replayed onto the moved main: feature.txt present,
		// unrelated.txt (from main) present, and the tip moved (rewritten SHA).
		expect(gitIn(['cat-file', '-e', 'HEAD:feature.txt'], repo)).toBe('');
		expect(gitIn(['cat-file', '-e', 'HEAD:unrelated.txt'], repo)).toBe('');
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).not.toBe(priorTip);
	});

	it('aborts a conflicting rebase (never auto-resolves) and reports conflict', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Prior attempt edits shared.txt.
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work edits shared'], repo);

		// Main edits the SAME file differently on the arbiter.
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main edits shared'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			gitEnv(),
		);
		expect(result.kind).toBe('conflict');
		// The rebase was aborted: HEAD is back on a clean work/slice-alpha (no rebase
		// in progress), still on its own tip.
		const status = gitIn(['status', '--porcelain'], repo);
		expect(status.trim()).toBe('');
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'work/slice-alpha',
		);
	});
});

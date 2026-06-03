import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {isolate, workBranchName} from '../src/isolate.js';
import {git} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-isolate-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('workBranchName', () => {
	it('is per-agent unique: includes both slug and agent id', () => {
		expect(workBranchName('feat', 'a1')).toBe('work/feat-a1');
		expect(workBranchName('feat', 'a1')).not.toBe(workBranchName('feat', 'a2'));
	});
});

describe('isolate (clone mode, preferred)', () => {
	it('produces a separate working dir with the per-agent work branch checked out', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const ws = join(scratch.root, 'ws');
		const handle = isolate({
			sourceRepo: repo,
			arbiter: 'arbiter',
			slug: 'feat',
			agentId: 'a1',
			workspace: ws,
			mode: 'clone',
			env: gitEnv(),
		});
		expect(existsSync(handle.dir)).toBe(true);
		expect(handle.dir).not.toBe(repo);
		const branch = git(['branch', '--show-current'], handle.dir, {
			env: gitEnv(),
		}).trim();
		expect(branch).toBe('work/feat-a1');
	});

	it('gives two agents on the same slug independent dirs and unique branches', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const ws = join(scratch.root, 'ws');
		const h1 = isolate({
			sourceRepo: repo,
			arbiter: 'arbiter',
			slug: 'feat',
			agentId: 'a1',
			workspace: ws,
			mode: 'clone',
			env: gitEnv(),
		});
		const h2 = isolate({
			sourceRepo: repo,
			arbiter: 'arbiter',
			slug: 'feat',
			agentId: 'a2',
			workspace: ws,
			mode: 'clone',
			env: gitEnv(),
		});
		expect(h1.dir).not.toBe(h2.dir);
		expect(h1.branch).not.toBe(h2.branch);
	});
});

describe('isolate (worktree mode)', () => {
	it('checks out a uniquely-named branch so two worktrees never share a branch', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const ws = join(scratch.root, 'wt');
		const h1 = isolate({
			sourceRepo: repo,
			arbiter: 'arbiter',
			slug: 'feat',
			agentId: 'a1',
			workspace: ws,
			mode: 'worktree',
			env: gitEnv(),
		});
		// A second worktree for the SAME slug must succeed because its branch is
		// uniquely named (git forbids two worktrees on one branch).
		const h2 = isolate({
			sourceRepo: repo,
			arbiter: 'arbiter',
			slug: 'feat',
			agentId: 'a2',
			workspace: ws,
			mode: 'worktree',
			env: gitEnv(),
		});
		expect(h1.branch).not.toBe(h2.branch);
		expect(existsSync(h1.dir)).toBe(true);
		expect(existsSync(h2.dir)).toBe(true);
		h2.dispose();
		h1.dispose();
		expect(existsSync(h1.dir)).toBe(false);
	});
});

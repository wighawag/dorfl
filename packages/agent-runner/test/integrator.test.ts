import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {
	Integrator,
	NoneProvider,
	rebaseOntoArbiterMain,
	type ReviewProvider,
} from '../src/integrator.js';
import {git} from '../src/git.js';
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
	scratch = makeScratch('agent-runner-integrator-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Create + commit a `work/<slug>` branch in a clone (the agent's work). */
function workBranch(repo: string, slug: string, file = 'x.txt'): string {
	const branch = `work/${slug}`;
	gitIn(['switch', '-c', branch, 'arbiter/main'], repo);
	writeFileSync(join(repo, file), `${slug}\n`);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug})`], repo);
	return branch;
}

describe('Integrator — propose mode (push-only) with the none provider', () => {
	it('pushes the work branch and never touches main', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		void arbiter;
		const branch = workBranch(repo, 'feat');

		const integrator = new Integrator({provider: new NoneProvider()});
		const result = integrator.integrate({
			cwd: repo,
			arbiter: 'arbiter',
			branch,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(result.mode).toBe('propose');
		expect(result.mergedToMain).toBe(false);
		expect(result.pushedRef).toBe(branch);
		expect(result.provider).toBe('none');
		// The branch is on the arbiter; main was NOT moved.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const remoteBranch = git(['rev-parse', `arbiter/${branch}`], repo, {
			env: gitEnv(),
		}).trim();
		expect(remoteBranch).toMatch(/^[0-9a-f]{40}$/);
		expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true); // unchanged
	});

	it('the none provider yields a manual-request instruction (no review API)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const branch = workBranch(repo, 'feat');
		const integrator = new Integrator({provider: new NoneProvider()});
		const result = integrator.integrate({
			cwd: repo,
			arbiter: 'arbiter',
			branch,
			mode: 'propose',
			env: gitEnv(),
		});
		expect(result.requestOpened).toBe(false);
		expect(result.instruction).toMatch(/manually|open/i);
	});

	it('calls a custom provider after the safety-bearing push', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const branch = workBranch(repo, 'feat');
		let sawBranch = '';
		const provider: ReviewProvider = {
			name: 'fake',
			openRequest({branch}) {
				sawBranch = branch;
				return {opened: true, instruction: 'opened #1'};
			},
		};
		const integrator = new Integrator({provider});
		const result = integrator.integrate({
			cwd: repo,
			arbiter: 'arbiter',
			branch,
			mode: 'propose',
			env: gitEnv(),
		});
		expect(sawBranch).toBe(branch);
		expect(result.requestOpened).toBe(true);
		expect(result.provider).toBe('fake');
	});
});

describe('Integrator — merge mode (direct to main, never --force)', () => {
	it('pushes the branch to arbiter main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const branch = workBranch(repo, 'feat');
		const integrator = new Integrator({provider: new NoneProvider()});
		const result = integrator.integrate({
			cwd: repo,
			arbiter: 'arbiter',
			branch,
			mode: 'merge',
			env: gitEnv(),
		});
		expect(result.mode).toBe('merge');
		expect(result.mergedToMain).toBe(true);
		expect(result.pushedRef).toBe('main');
		// The work commit is now on the arbiter's main.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const tip = git(['rev-parse', branch], repo, {env: gitEnv()}).trim();
		const main = git(['rev-parse', 'arbiter/main'], repo, {
			env: gitEnv(),
		}).trim();
		expect(main).toBe(tip);
	});
});

describe('rebaseOntoArbiterMain — clean → proceed, conflict → abort (ADR §10)', () => {
	it('cleanly rebases when the branch does not conflict with advanced main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		// Agent works on its own file.
		const branch = workBranch(repo, 'feat', 'agent-file.txt');

		// Meanwhile main advances with an unrelated file (no conflict).
		const other = `${repo}-other`;
		gitIn(
			['clone', '-q', `file://${join(scratch.root)}/project-work.git`, other],
			scratch.root,
		);
		gitIn(
			[
				'remote',
				'add',
				'arbiter',
				`file://${join(scratch.root)}/project-work.git`,
			],
			other,
		);
		writeFileSync(join(other, 'unrelated.txt'), 'main moved\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'advance main'], other);
		gitIn(['push', '-q', 'arbiter', 'HEAD:main'], other);

		const result = rebaseOntoArbiterMain({
			cwd: repo,
			arbiter: 'arbiter',
			branch,
			env: gitEnv(),
		});
		expect(result.clean).toBe(true);
		expect(result.conflicted).toBe(false);
		// The branch now contains main's new file (it was rebased on top).
		const log = git(['log', '--oneline'], repo, {env: gitEnv()});
		expect(log).toMatch(/advance main/);
	});

	it('aborts a conflicting rebase and routes to needs-attention (never auto-resolves)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		// Agent edits shared.txt one way.
		gitIn(['switch', '-c', 'work/feat', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'agent version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat: agent edits shared'], repo);

		// Main advances editing the SAME file the OTHER way → conflict on rebase.
		const other = `${repo}-other`;
		gitIn(
			['clone', '-q', `file://${join(scratch.root)}/project-work.git`, other],
			scratch.root,
		);
		gitIn(
			[
				'remote',
				'add',
				'arbiter',
				`file://${join(scratch.root)}/project-work.git`,
			],
			other,
		);
		writeFileSync(join(other, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'main edits shared'], other);
		gitIn(['push', '-q', 'arbiter', 'HEAD:main'], other);

		const result = rebaseOntoArbiterMain({
			cwd: repo,
			arbiter: 'arbiter',
			branch: 'work/feat',
			env: gitEnv(),
		});
		expect(result.clean).toBe(false);
		expect(result.conflicted).toBe(true);
		// The rebase was aborted: the tree is NOT in a rebase/conflict state.
		const status = git(['status', '--porcelain=v1'], repo, {
			env: gitEnv(),
		});
		expect(status).not.toMatch(/^UU /m); // no unmerged paths left behind
		// HEAD is back on the work branch (rebase aborted cleanly).
		const head = git(['branch', '--show-current'], repo, {
			env: gitEnv(),
		}).trim();
		expect(head).toBe('work/feat');
	});
});

describe('Integrator — rebase-before-integrate refuses on conflict', () => {
	it('a conflicting branch is not pushed to main; reported as needs-attention', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		gitIn(['switch', '-c', 'work/feat', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'agent version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat: agent'], repo);

		const other = `${repo}-other`;
		gitIn(
			['clone', '-q', `file://${join(scratch.root)}/project-work.git`, other],
			scratch.root,
		);
		gitIn(
			[
				'remote',
				'add',
				'arbiter',
				`file://${join(scratch.root)}/project-work.git`,
			],
			other,
		);
		writeFileSync(join(other, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'main'], other);
		gitIn(['push', '-q', 'arbiter', 'HEAD:main'], other);

		const integrator = new Integrator({provider: new NoneProvider()});
		const result = integrator.integrateWithRebase({
			cwd: repo,
			arbiter: 'arbiter',
			branch: 'work/feat',
			mode: 'merge',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(result.reason).toMatch(/conflict/i);
		// main was NOT advanced to the agent's version.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const mainShared = git(['show', 'arbiter/main:shared.txt'], repo, {
			env: gitEnv(),
		});
		expect(mainShared).toBe('main version\n');
	});
});

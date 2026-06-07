import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {
	arbiterPath,
	arbiterInit,
	arbiterStatus,
	formatArbiterStatus,
} from '../src/arbiter.js';
import {git} from '../src/git.js';
import {performClaim} from '../src/claim-cas.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-arbiter-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Seed a plain working repo (no arbiter) with a `work/backlog/<slug>.md` for
 * each slug, on `main`. This is the input `arbiter init` derives a bare arbiter
 * from. Returns the working-repo path.
 */
function seedWorkingRepo(root: string, slugs: string[]): string {
	const repo = join(root, 'project');
	mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	for (const slug of slugs) {
		writeFileSync(
			join(repo, 'work', 'backlog', `${slug}.md`),
			[
				'---',
				`title: ${slug}`,
				`slug: ${slug}`,
				'blockedBy: []',
				'---',
				'',
				'## Prompt',
				'',
				`> Implement ${slug}.`,
				'',
			].join('\n'),
		);
	}
	writeFileSync(join(repo, 'README.md'), '# project\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed'], repo);
	return repo;
}

function isBare(path: string): boolean {
	return (
		git(['rev-parse', '--is-bare-repository'], path, {env: gitEnv()}).trim() ===
		'true'
	);
}

describe('arbiterPath', () => {
	it('locates <arbitersDir>/<host>/<org>/<name>.git, hierarchical, dot→dash per segment', () => {
		expect(
			arbiterPath('/home/me/git', 'git@github.com:wighawag/agent-runner.git'),
		).toBe('/home/me/git/github-com/wighawag/agent-runner.git');
	});

	it('reuses the workspace repo→key encoding (per-segment dot→dash)', () => {
		expect(
			arbiterPath('/home/me/git', 'https://my.host.io/my.org/some.repo'),
		).toBe('/home/me/git/my-host-io/my-org/some-repo.git');
	});

	it('is NEVER under ~/.agent-runner (precious data, ADR §7)', () => {
		const p = arbiterPath('/home/me/git', 'https://github.com/o/r.git');
		expect(p).not.toMatch(/\.agent-runner/);
		expect(p.startsWith('/home/me/git/')).toBe(true);
	});
});

describe('arbiter init', () => {
	it('creates a bare arbiter at the resolved ~/git path and wires the repo remote', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const arbitersDir = join(scratch.root, 'git');

		const result = arbiterInit({
			repo,
			arbitersDir,
			remote: 'arbiter',
			env: gitEnv(),
		});

		expect(result.created).toBe(true);
		expect(result.bare).toBe(true);
		expect(result.remote).toBe('arbiter');
		// Resolved under arbitersDir, hierarchical, *.git, NEVER ~/.agent-runner.
		const expectedPath = arbiterPath(arbitersDir, `file://${repo}`);
		expect(result.path).toBe(expectedPath);
		expect(result.path).not.toMatch(/\.agent-runner/);
		expect(existsSync(result.path)).toBe(true);
		expect(isBare(result.path)).toBe(true);

		// The repo's arbiter remote points at the new bare arbiter.
		const url = gitIn(['remote', 'get-url', 'arbiter'], repo).trim();
		expect(url).toBe(`file://${result.path}`);
	});

	it('honours --at to override the resolved path', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const at = join(scratch.root, 'custom', 'place.git');

		const result = arbiterInit({repo, at, remote: 'arbiter', env: gitEnv()});

		expect(result.path).toBe(at);
		expect(result.created).toBe(true);
		expect(isBare(result.path)).toBe(true);
	});

	it('is idempotent: a second init detects the existing arbiter and does not clobber it', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const arbitersDir = join(scratch.root, 'git');

		const first = arbiterInit({
			repo,
			arbitersDir,
			remote: 'arbiter',
			env: gitEnv(),
		});
		expect(first.created).toBe(true);

		// Drop a sentinel inside the bare arbiter; a clobbering re-clone wipes it.
		const sentinel = join(first.path, 'SENTINEL');
		writeFileSync(sentinel, 'do-not-clobber\n');

		const second = arbiterInit({
			repo,
			arbitersDir,
			remote: 'arbiter',
			env: gitEnv(),
		});
		expect(second.created).toBe(false);
		expect(second.alreadyExisted).toBe(true);
		expect(second.path).toBe(first.path);
		expect(existsSync(sentinel)).toBe(true);
	});

	it('refuses to clone a non-bare repo with main checked out (the unsafe case)', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		// `at` is an existing NON-BARE repo with `main` checked out — using it as the
		// arbiter would reject claim pushes (CLAIM-PROTOCOL). init must refuse.
		const nonBare = join(scratch.root, 'non-bare');
		mkdirSync(join(nonBare, 'work', 'backlog'), {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], nonBare);
		writeFileSync(join(nonBare, 'README.md'), '# x\n');
		gitIn(['add', '-A'], nonBare);
		gitIn(['commit', '-q', '-m', 'x'], nonBare);

		expect(() =>
			arbiterInit({repo, at: nonBare, remote: 'arbiter', env: gitEnv()}),
		).toThrow(/non-bare|not bare|checked out|unsafe/i);
	});

	it('defaults <repo> to the current repo and the remote name to a sensible default', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const arbitersDir = join(scratch.root, 'git');

		// No explicit repo: defaults to cwd.
		const result = arbiterInit({cwd: repo, arbitersDir, env: gitEnv()});
		expect(result.created).toBe(true);
		expect(isBare(result.path)).toBe(true);
		// A remote with the default name now exists and points at the arbiter.
		const url = gitIn(['remote', 'get-url', result.remote], repo).trim();
		expect(url).toBe(`file://${result.path}`);
	});
});

describe('arbiter status', () => {
	it('reports remote name, path/URL, bare-ness, and main reachability for a provisioned arbiter', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const arbitersDir = join(scratch.root, 'git');
		const init = arbiterInit({
			repo,
			arbitersDir,
			remote: 'arbiter',
			env: gitEnv(),
		});

		const report = arbiterStatus({cwd: repo, remote: 'arbiter', env: gitEnv()});

		expect(report.remote).toBe('arbiter');
		expect(report.configured).toBe(true);
		expect(report.url).toBe(`file://${init.path}`);
		expect(report.path).toBe(init.path);
		expect(report.exists).toBe(true);
		expect(report.bare).toBe(true);
		expect(report.mainReachable).toBe(true);
		expect(report.unsafe).toBe(false);
	});

	it('reports a missing arbiter remote without throwing (read-only)', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const report = arbiterStatus({cwd: repo, remote: 'arbiter', env: gitEnv()});
		expect(report.configured).toBe(false);
		expect(report.exists).toBe(false);
		expect(report.mainReachable).toBe(false);
		// Renders cleanly.
		expect(formatArbiterStatus(report)).toMatch(/no .*remote|not configured/i);
	});

	it('flags the unsafe non-bare-with-main case', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const nonBare = seedWorkingRepo(scratch.root, ['other']);
		// Wire the repo's arbiter remote at a non-bare repo with main checked out.
		gitIn(['remote', 'add', 'arbiter', `file://${nonBare}`], repo);

		const report = arbiterStatus({cwd: repo, remote: 'arbiter', env: gitEnv()});
		expect(report.configured).toBe(true);
		expect(report.exists).toBe(true);
		expect(report.bare).toBe(false);
		expect(report.unsafe).toBe(true);
		expect(formatArbiterStatus(report)).toMatch(/unsafe|non-bare|not bare/i);
	});

	it('does not mutate the repo (read-only)', () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		arbiterInit({
			repo,
			arbitersDir: join(scratch.root, 'git'),
			remote: 'arbiter',
			env: gitEnv(),
		});
		const before = gitIn(['rev-parse', 'HEAD'], repo).trim();
		const statusBefore = gitIn(['status', '--porcelain'], repo);
		arbiterStatus({cwd: repo, remote: 'arbiter', env: gitEnv()});
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(before);
		expect(gitIn(['status', '--porcelain'], repo)).toBe(statusBefore);
	});
});

describe('claim against a provisioned arbiter (end-to-end)', () => {
	it('a claim succeeds end-to-end after arbiter init', async () => {
		const repo = seedWorkingRepo(scratch.root, ['feat']);
		const arbitersDir = join(scratch.root, 'git');
		const init = arbiterInit({
			repo,
			arbitersDir,
			remote: 'arbiter',
			env: gitEnv(),
		});
		expect(init.bare).toBe(true);

		// Use a fresh clone of the provisioned arbiter to claim (the isolation the
		// protocol expects); wire its arbiter remote at the bare arbiter.
		const clone = join(scratch.root, 'clone');
		git(['clone', '-q', `file://${init.path}`, clone], scratch.root, {
			env: gitEnv(),
		});
		git(['remote', 'add', 'arbiter', `file://${init.path}`], clone, {
			env: gitEnv(),
		});

		const result = await performClaim({
			slug: 'feat',
			cwd: clone,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		// The claim landed on the bare arbiter's main: in-progress, not backlog.
		git(['fetch', '-q', 'arbiter'], clone, {env: gitEnv()});
		const inProg = git(
			['cat-file', '-e', 'arbiter/main:work/in-progress/feat.md'],
			clone,
			{env: gitEnv()},
		);
		expect(inProg).toBe('');
	});
});

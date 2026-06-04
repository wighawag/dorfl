import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, writeFileSync} from 'node:fs';
import {
	encodeRepoKey,
	mirrorPath,
	ensureMirror,
	mirrorMainSha,
} from '../src/repo-mirror.js';
import {git} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-mirror-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('encodeRepoKey', () => {
	it('encodes an ssh URL: drop scheme/user/.git, dot→dash per segment, hierarchical', () => {
		expect(encodeRepoKey('git@github.com:wighawag/agent-runner.git')).toBe(
			'github-com/wighawag/agent-runner',
		);
	});

	it('encodes an https URL', () => {
		expect(encodeRepoKey('https://github.com/wighawag/agent-runner.git')).toBe(
			'github-com/wighawag/agent-runner',
		);
	});

	it('is stable with or without the .git suffix', () => {
		expect(encodeRepoKey('https://github.com/wighawag/agent-runner')).toBe(
			encodeRepoKey('https://github.com/wighawag/agent-runner.git'),
		);
	});

	it('replaces dots per segment, not across the whole path (lossless)', () => {
		// A host AND an org both containing dots must each be dashed independently.
		expect(encodeRepoKey('git@my.host.io:my.org/some.repo.git')).toBe(
			'my-host-io/my-org/some-repo',
		);
	});

	it('encodes an ssh:// URL with an explicit port', () => {
		expect(
			encodeRepoKey('ssh://git@gitlab.example.com:2222/group/sub/proj.git'),
		).toBe('gitlab-example-com/group/sub/proj');
	});

	it('encodes a file:// bare arbiter URL', () => {
		expect(encodeRepoKey('file:///home/me/git/host.com/org/repo.git')).toBe(
			'home/me/git/host-com/org/repo',
		);
	});

	it('encodes a plain local path to a bare repo', () => {
		expect(encodeRepoKey('/srv/git/org/repo.git')).toBe('srv/git/org/repo');
	});

	it('is deterministic: same input → same key', () => {
		const url = 'git@github.com:wighawag/agent-runner.git';
		expect(encodeRepoKey(url)).toBe(encodeRepoKey(url));
	});
});

describe('mirrorPath', () => {
	it('locates <workspacesDir>/repos/<key>.git', () => {
		const p = mirrorPath(
			'/home/me/.agent-runner',
			'git@github.com:wighawag/agent-runner.git',
		);
		expect(p).toBe(
			'/home/me/.agent-runner/repos/github-com/wighawag/agent-runner.git',
		);
	});

	it('lives under workspacesDir, never ~/.cache', () => {
		const p = mirrorPath(
			'/home/me/.agent-runner',
			'https://github.com/o/r.git',
		);
		expect(p.startsWith('/home/me/.agent-runner/')).toBe(true);
		expect(p).not.toMatch(/\.cache/);
	});
});

describe('ensureMirror', () => {
	it('creates a bare mirror under workspacesDir/repos/<key>.git when absent', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const result = ensureMirror({url, workspacesDir, env: gitEnv()});

		expect(result.created).toBe(true);
		expect(result.fetched).toBe(false);
		expect(result.path).toBe(mirrorPath(workspacesDir, url));
		expect(existsSync(result.path)).toBe(true);
		// It is a bare repo (no working tree).
		const isBare = git(['rev-parse', '--is-bare-repository'], result.path, {
			env: gitEnv(),
		}).trim();
		expect(isBare).toBe('true');
		// It has the arbiter's main.
		expect(result.mainSha).toMatch(/^[0-9a-f]{40}$/);
	});

	it('on a second call fetches and reuses the same mirror (no re-clone)', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const first = ensureMirror({url, workspacesDir, env: gitEnv()});
		expect(first.created).toBe(true);

		// Drop a sentinel inside the bare mirror; a re-clone would wipe it.
		const sentinel = join(first.path, 'SENTINEL');
		writeFileSync(sentinel, 'do-not-reclone\n');

		// Advance the arbiter's main with a new commit.
		writeFileSync(join(repo, 'NEW.md'), '# new\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'advance main'], repo);
		gitIn(['push', '-q', 'arbiter', 'main'], repo);

		const second = ensureMirror({url, workspacesDir, env: gitEnv()});

		// Reused the same path; fetched (not created); sentinel survived.
		expect(second.created).toBe(false);
		expect(second.fetched).toBe(true);
		expect(second.path).toBe(first.path);
		expect(existsSync(sentinel)).toBe(true);
		// The fetched main reflects the new commit.
		expect(second.mainSha).not.toBe(first.mainSha);
	});

	it('is idempotent: repeated calls without remote changes keep the same main', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const a = ensureMirror({url, workspacesDir, env: gitEnv()});
		const b = ensureMirror({url, workspacesDir, env: gitEnv()});
		const c = ensureMirror({url, workspacesDir, env: gitEnv()});
		expect(b.created).toBe(false);
		expect(c.created).toBe(false);
		expect(a.mainSha).toBe(b.mainSha);
		expect(b.mainSha).toBe(c.mainSha);
	});

	it('resolves the remote URL from a repo when given fromRepo + arbiter remote', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');

		const result = ensureMirror({
			fromRepo: repo,
			arbiter: 'arbiter',
			workspacesDir,
			env: gitEnv(),
		});
		expect(result.created).toBe(true);
		expect(result.path).toBe(mirrorPath(workspacesDir, `file://${arbiter}`));
		expect(result.mainSha).toMatch(/^[0-9a-f]{40}$/);
	});
});

describe('mirrorMainSha', () => {
	it('returns the mirror main after a fetch (the fresh arbiter main)', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const result = ensureMirror({url, workspacesDir, env: gitEnv()});

		const arbiterMain = gitIn(['rev-parse', 'main'], repo).trim();
		expect(mirrorMainSha(result.path, gitEnv())).toBe(arbiterMain);
		expect(result.mainSha).toBe(arbiterMain);
	});
});

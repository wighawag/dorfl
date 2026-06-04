import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, readFileSync} from 'node:fs';
import {
	encodeWorkId,
	jobWorktreePath,
	createJob,
	readJobRecord,
	type JobRecord,
} from '../src/workspace.js';
import {mirrorPath, encodeRepoKey} from '../src/repo-mirror.js';
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
	scratch = makeScratch('agent-runner-workspace-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('encodeWorkId', () => {
	it('is flat: host__org__name__slug (dot→dash per segment), reusing the repo-key encoding', () => {
		expect(
			encodeWorkId('git@github.com:wighawag/agent-runner.git', 'my-slice'),
		).toBe('github-com__wighawag__agent-runner__my-slice');
	});

	it('encodes an https URL the same way', () => {
		expect(
			encodeWorkId('https://github.com/wighawag/agent-runner.git', 'feat'),
		).toBe('github-com__wighawag__agent-runner__feat');
	});

	it('is deterministic and unique per (repo, slug)', () => {
		const url = 'git@github.com:o/r.git';
		expect(encodeWorkId(url, 'a')).toBe(encodeWorkId(url, 'a'));
		expect(encodeWorkId(url, 'a')).not.toBe(encodeWorkId(url, 'b'));
	});

	it('flattens a deeper path (gitlab group/subgroup)', () => {
		expect(
			encodeWorkId('ssh://git@gitlab.com:22/group/sub/proj.git', 'x'),
		).toBe('gitlab-com__group__sub__proj__x');
	});
});

describe('jobWorktreePath', () => {
	it('locates <workspacesDir>/work/<work-id>/ (flat, outside the hub)', () => {
		const p = jobWorktreePath(
			'/home/me/.agent-runner',
			'git@github.com:o/r.git',
			'feat',
		);
		expect(p).toBe('/home/me/.agent-runner/work/github-com__o__r__feat');
	});

	it('lives under workspacesDir, never ~/.cache', () => {
		const p = jobWorktreePath(
			'/home/me/.agent-runner',
			'https://github.com/o/r.git',
			'feat',
		);
		expect(p.startsWith('/home/me/.agent-runner/')).toBe(true);
		expect(p).not.toMatch(/\.cache/);
	});
});

describe('createJob — hub mirror + isolated worktree', () => {
	it('obtains the hub mirror via repo-mirror (not reimplemented) and reuses it across jobs', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['a', 'b']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const j1 = createJob({url, slug: 'a', workspacesDir, env: gitEnv()});
		expect(j1.mirror.created).toBe(true);
		expect(j1.mirror.path).toBe(mirrorPath(workspacesDir, url));

		// A second job for the same repo reuses (fetches) the same mirror.
		const j2 = createJob({url, slug: 'b', workspacesDir, env: gitEnv()});
		expect(j2.mirror.created).toBe(false);
		expect(j2.mirror.fetched).toBe(true);
		expect(j2.mirror.path).toBe(j1.mirror.path);
	});

	it('creates a worktree at <workspacesDir>/work/<work-id>/ on work/<slug>, off the fresh mirror main', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		expect(job.dir).toBe(jobWorktreePath(workspacesDir, url, 'feat'));
		expect(existsSync(job.dir)).toBe(true);
		expect(job.branch).toBe('work/feat');
		const branch = git(['branch', '--show-current'], job.dir, {
			env: gitEnv(),
		}).trim();
		expect(branch).toBe('work/feat');
		// Branch tip == the freshly-fetched mirror main.
		const tip = git(['rev-parse', 'HEAD'], job.dir, {env: gitEnv()}).trim();
		expect(tip).toBe(job.mirror.mainSha);
	});

	it('distinct slugs ⇒ distinct branches + distinct trees (no worktree collision)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['a', 'b']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');

		const ja = createJob({url, slug: 'a', workspacesDir, env: gitEnv()});
		const jb = createJob({url, slug: 'b', workspacesDir, env: gitEnv()});

		expect(ja.dir).not.toBe(jb.dir);
		expect(ja.branch).not.toBe(jb.branch);
		expect(existsSync(ja.dir)).toBe(true);
		expect(existsSync(jb.dir)).toBe(true);
	});

	it('two jobs never share a tree (each has its own working dir)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['a', 'b']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const ja = createJob({url, slug: 'a', workspacesDir, env: gitEnv()});
		const jb = createJob({url, slug: 'b', workspacesDir, env: gitEnv()});
		// Editing one tree does not affect the other.
		gitIn(['status'], ja.dir);
		expect(ja.dir).not.toBe(jb.dir);
	});

	it('writes a .agent-runner-job.json record gc/status can read', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		const recordPath = join(job.dir, '.agent-runner-job.json');
		expect(existsSync(recordPath)).toBe(true);

		const record = JSON.parse(readFileSync(recordPath, 'utf8')) as JobRecord;
		expect(record.slug).toBe('feat');
		expect(record.branch).toBe('work/feat');
		// repoKey is the encoded mirror key; for a file:// arbiter it is the path.
		expect(record.repoKey).not.toBe('');
		expect(record.repoKey).toBe(encodeRepoKey(url));
		expect(typeof record.startedAt).toBe('string');
		expect(record.state).toBe('running');
		expect(record.harness).toBeDefined();

		// readJobRecord reads it back.
		const readBack = readJobRecord(job.dir);
		expect(readBack?.slug).toBe('feat');
	});

	it('does not place the worktree inside the hub mirror', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});
		expect(job.dir.startsWith(job.mirror.path)).toBe(false);
	});
});

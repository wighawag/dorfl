import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {
	encodeWorkId,
	jobWorktreePath,
	jobRecordPath,
	createJob,
	readJobRecord,
	writeJobRecord,
	updateJobRecord,
	JOB_RECORD_FILENAME,
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
			encodeWorkId('git@github.com:wighawag/agent-runner.git', 'my-task'),
		).toBe('github-com__wighawag__agent-runner__my-task');
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
		expect(job.branch).toBe('work/task-feat');
		const branch = git(['branch', '--show-current'], job.dir, {
			env: gitEnv(),
		}).trim();
		expect(branch).toBe('work/task-feat');
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

	it('writes the per-job record at a SIBLING of the worktree (OUTSIDE the tree), readable by gc/status', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		// The record is a sibling `<work-id>.json`, NOT inside `<work-id>/`.
		const siblingPath = jobRecordPath(job.dir);
		expect(siblingPath).toBe(`${job.dir}.json`);
		expect(existsSync(siblingPath)).toBe(true);
		expect(job.recordPath).toBe(siblingPath);
		// The OLD in-tree location must NOT exist (no leak surface in the tree).
		expect(existsSync(join(job.dir, JOB_RECORD_FILENAME))).toBe(false);
		// And the sibling is OUTSIDE the worktree dir.
		expect(siblingPath.startsWith(job.dir + '/')).toBe(false);

		const record = JSON.parse(readFileSync(siblingPath, 'utf8')) as JobRecord;
		expect(record.slug).toBe('feat');
		expect(record.branch).toBe('work/task-feat');
		// repoKey is the encoded mirror key; for a file:// arbiter it is the path.
		expect(record.repoKey).not.toBe('');
		expect(record.repoKey).toBe(encodeRepoKey(url));
		expect(typeof record.startedAt).toBe('string');
		expect(record.state).toBe('running');
		expect(record.harness).toBeDefined();

		// readJobRecord (keyed on the worktree dir) reads it back from the sibling.
		const readBack = readJobRecord(job.dir);
		expect(readBack?.slug).toBe('feat');
	});

	it('a runner `git add -A` commit in the worktree can NEVER stage the record (out-of-tree), with NO .gitignore entry', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		// Sanity: the worktree has NO gitignore entry for the record name.
		const gitignore = join(job.dir, '.gitignore');
		const ignoreContents = existsSync(gitignore)
			? readFileSync(gitignore, 'utf8')
			: '';
		expect(ignoreContents).not.toContain(JOB_RECORD_FILENAME);

		// Some genuine source change so the broad staging commit is non-empty.
		writeFileSync(join(job.dir, 'src-change.txt'), 'real work\n');
		// The runner's broad staging commit (mirrors needs-attention/integration).
		git(['add', '-A'], job.dir, {env: gitEnv()});
		git(['commit', '-q', '-m', 'runner add -A'], job.dir, {env: gitEnv()});

		// The record is NOWHERE in the committed tree — structurally, no gitignore.
		const tracked = git(['ls-files'], job.dir, {env: gitEnv()});
		expect(tracked).not.toContain(JOB_RECORD_FILENAME);
		// And the record still exists + is readable (it lives out of the tree).
		expect(existsSync(jobRecordPath(job.dir))).toBe(true);
		expect(readJobRecord(job.dir)?.slug).toBe('feat');
	});

	it('updateJobRecord patches the out-of-tree sibling in place', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		const next = updateJobRecord(job.dir, {
			state: 'needs-attention',
			reason: 'gate red',
		});
		expect(next?.state).toBe('needs-attention');
		expect(readJobRecord(job.dir)?.reason).toBe('gate red');
		// Still out of the tree, still no in-tree copy.
		expect(existsSync(join(job.dir, JOB_RECORD_FILENAME))).toBe(false);
	});

	it('reads a LEGACY in-tree record as a migration fallback (old-binary in-flight job)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});

		// Simulate an OLD-binary worktree: remove the sibling, write the record
		// at the legacy in-tree path instead.
		rmSync(jobRecordPath(job.dir));
		const legacy: JobRecord = {
			slug: 'feat',
			repoKey: encodeRepoKey(url),
			branch: 'work/task-feat',
			startedAt: new Date().toISOString(),
			state: 'running',
			harness: {adapter: 'null'},
		};
		writeFileSync(
			join(job.dir, JOB_RECORD_FILENAME),
			JSON.stringify(legacy, null, 2),
		);

		// readJobRecord falls back to the in-tree path so the job stays discoverable.
		expect(readJobRecord(job.dir)?.slug).toBe('feat');
	});

	it('writeJobRecord then readJobRecord round-trips through the sibling path', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});
		const rec = readJobRecord(job.dir)!;
		rec.prUrl = 'https://example/pr/1';
		writeJobRecord(job.dir, rec);
		expect(readJobRecord(job.dir)?.prUrl).toBe('https://example/pr/1');
		expect(existsSync(jobRecordPath(job.dir))).toBe(true);
	});

	it('does not place the worktree inside the hub mirror', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const url = `file://${arbiter}`;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({url, slug: 'feat', workspacesDir, env: gitEnv()});
		expect(job.dir.startsWith(job.mirror.path)).toBe(false);
	});
});

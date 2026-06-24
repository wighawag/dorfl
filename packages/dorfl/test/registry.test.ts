import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {
	remoteAdd,
	remoteRm,
	listMirrors,
	transportForUrl,
	projectIdFromKey,
	RegistryError,
	ReplaceWouldStrandWorkError,
} from '../src/registry.js';
import {arbiterPath} from '../src/arbiter.js';
import {findParticipatingRepos} from '../src/detect.js';
import {createJob, type Job} from '../src/workspace.js';
import {git} from '../src/git.js';
import {mirrorPath, encodeRepoKey} from '../src/repo-mirror.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-registry-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A throwaway working repo with a populated `work/tasks/ready/` (a participating repo). */
function seedWorkingRepo(name: string, slugs: string[] = ['feat']): string {
	const repo = join(scratch.root, name);
	mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	for (const slug of slugs) {
		writeFileSync(
			join(repo, 'work', 'tasks', 'ready', `${slug}.md`),
			['---', `slug: ${slug}`, 'blockedBy: []', '---', '', 'body', ''].join(
				'\n',
			),
		);
	}
	writeFileSync(join(repo, 'README.md'), `# ${name}\n`);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed'], repo);
	return repo;
}

function ws(): string {
	return join(scratch.root, '.dorfl');
}

function arbitersDir(): string {
	return join(scratch.root, 'git');
}

describe('transportForUrl + projectIdFromKey', () => {
	it('derives local-bare for file:// + plain paths, remote-host otherwise', () => {
		expect(transportForUrl('file:///srv/git/o/r.git')).toBe('local-bare');
		expect(transportForUrl('/srv/git/o/r.git')).toBe('local-bare');
		expect(transportForUrl('git@github.com:o/r.git')).toBe('remote-host');
		expect(transportForUrl('https://github.com/o/r.git')).toBe('remote-host');
		expect(transportForUrl('ssh://git@github.com/o/r.git')).toBe('remote-host');
	});

	it('takes the trailing org/name of a hub key as the project identity', () => {
		expect(projectIdFromKey('github-com/wighawag/dorfl')).toBe(
			'wighawag/dorfl',
		);
		expect(projectIdFromKey('home/me/git/host-com/o/r')).toBe('o/r');
	});
});

describe('remote add / ls / rm round-trip', () => {
	it('remote add --local provisions a bare arbiter AND its mirror; both idempotent', () => {
		const repo = seedWorkingRepo('proj');

		const first = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		expect(first.created).toBe(true);
		expect(first.arbiter).toBeDefined();
		expect(first.arbiter?.created).toBe(true);
		// The arbiter is precious DATA under arbitersDir, NEVER ~/.dorfl.
		expect(first.arbiter?.path).toBe(
			arbiterPath(arbitersDir(), `file://${repo}`),
		);
		expect(first.arbiter?.path).not.toMatch(/\.dorfl/);
		expect(existsSync(first.mirrorPath)).toBe(true);
		expect(first.transport).toBe('local-bare');

		// Idempotent: a second add detects the existing arbiter + mirror, no clobber.
		const second = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		expect(second.created).toBe(false);
		expect(second.arbiter?.created).toBe(false);
		expect(second.mirrorPath).toBe(first.mirrorPath);
	});

	it('remote ls lists each mirror with its origin URL + transport (read from the mirror)', () => {
		const repo = seedWorkingRepo('proj');
		const added = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});

		const mirrors = listMirrors({workspacesDir: ws(), env: gitEnv()});
		expect(mirrors).toHaveLength(1);
		const m = mirrors[0];
		expect(m.path).toBe(added.mirrorPath);
		// The origin URL is the arbiter's file:// URL (read from the mirror, not the
		// lossy key), and the transport is derived from it.
		expect(m.originUrl).toBe(added.url);
		expect(m.transport).toBe('local-bare');
		expect(m.key).toBe(encodeRepoKey(added.url));
	});

	it('remote rm deletes a mirror by key', () => {
		const repo = seedWorkingRepo('proj');
		const added = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		expect(existsSync(added.mirrorPath)).toBe(true);

		const removed = remoteRm({target: added.key, workspacesDir: ws()});
		expect(removed.removed).toBe(true);
		expect(removed.key).toBe(added.key);
		expect(existsSync(added.mirrorPath)).toBe(false);
		expect(listMirrors({workspacesDir: ws(), env: gitEnv()})).toHaveLength(0);
	});

	it('remote rm deletes a mirror by origin URL too', () => {
		const repo = seedWorkingRepo('proj');
		const added = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		const removed = remoteRm({target: added.url, workspacesDir: ws()});
		expect(removed.removed).toBe(true);
		expect(existsSync(added.mirrorPath)).toBe(false);
	});

	it('remote rm reports nothing-removed for an unknown target', () => {
		const removed = remoteRm({target: 'no/such/mirror', workspacesDir: ws()});
		expect(removed.removed).toBe(false);
	});

	it('a remote add of a plain URL creates a mirror without an arbiter', () => {
		// Build a bare repo to clone as the "remote" (file:// ⇒ local-bare transport).
		const bare = join(scratch.root, 'remote.git');
		const src = seedWorkingRepo('src');
		gitIn(['clone', '-q', '--bare', src, bare], scratch.root);

		const url = `file://${bare}`;
		const added = remoteAdd({target: url, workspacesDir: ws(), env: gitEnv()});
		expect(added.created).toBe(true);
		expect(added.arbiter).toBeUndefined();
		expect(added.mirrorPath).toBe(mirrorPath(ws(), url));
		expect(existsSync(added.mirrorPath)).toBe(true);
	});
});

describe('remote find — discover participating repos and toggle-add', () => {
	it('discovers work/-participating repos under a folder and registers the chosen ones', () => {
		// Two participating repos + one non-participating, under a shared folder.
		const folder = join(scratch.root, 'projects');
		mkdirSync(folder, {recursive: true});
		seedWorkingRepo(join('projects', 'alpha'));
		seedWorkingRepo(join('projects', 'beta'));
		mkdirSync(join(folder, 'not-a-repo'), {recursive: true});

		const discovered = findParticipatingRepos(folder);
		expect(discovered).toContain(join(folder, 'alpha'));
		expect(discovered).toContain(join(folder, 'beta'));
		expect(discovered).not.toContain(join(folder, 'not-a-repo'));

		// `remote find` toggle-adds the chosen ones (here: just alpha).
		const chosen = [join(folder, 'alpha')];
		for (const repoPath of chosen) {
			remoteAdd({
				target: repoPath,
				local: true,
				workspacesDir: ws(),
				arbitersDir: arbitersDir(),
				env: gitEnv(),
			});
		}
		const mirrors = listMirrors({workspacesDir: ws(), env: gitEnv()});
		expect(mirrors).toHaveLength(1);
		expect(mirrors[0].projectId).toContain('alpha');
	});
});

describe('remote add — transport guard (anti-stranding)', () => {
	it('refuses registering the same project under a different transport, naming the existing one', () => {
		// Seed the working repo under a `.../wighawag/dorfl` path so its
		// project-identity tail matches the github URL below (the guard keys on the
		// org/name tail, NOT the URL).
		const repo = seedWorkingRepo(join('wighawag', 'dorfl'));
		// First register it as a LOCAL bare arbiter (file:// ⇒ local-bare).
		remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});

		// Now try to register the SAME project (same org/name tail) under a remote
		// host transport. Different key, same projectId ⇒ guard refuses BEFORE any
		// clone is attempted (so the unreachable github URL is never hit).
		expect(() =>
			remoteAdd({
				target: 'git@github.com:wighawag/dorfl.git',
				workspacesDir: ws(),
				env: gitEnv(),
			}),
		).toThrow(RegistryError);
		try {
			remoteAdd({
				target: 'git@github.com:wighawag/dorfl.git',
				workspacesDir: ws(),
				env: gitEnv(),
			});
		} catch (err) {
			// The error names the EXISTING transport (read from the existing mirror).
			expect((err as Error).message).toMatch(/local-bare/);
		}
	});

	it('--force overrides the transport guard', () => {
		const repo = seedWorkingRepo('dorfl');
		remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});

		// With force, the second (different-transport) registration goes through.
		// (We cannot reach github, so use another file:// bare with the SAME
		// org/name tail but a DIFFERENT key — still a different transport-less key.)
		const otherBare = join(scratch.root, 'other', 'wighawag', 'dorfl.git');
		const src = seedWorkingRepo('src2');
		mkdirSync(join(scratch.root, 'other', 'wighawag'), {recursive: true});
		gitIn(['clone', '-q', '--bare', src, otherBare], scratch.root);

		// Sanity: same project identity, different key.
		expect(projectIdFromKey(encodeRepoKey(`file://${otherBare}`))).toBe(
			'wighawag/dorfl',
		);

		// Same transport (both local-bare) ⇒ NOT a guard case; this proves --force
		// is accepted and lands a second mirror regardless.
		const forced = remoteAdd({
			target: `file://${otherBare}`,
			workspacesDir: ws(),
			force: true,
			env: gitEnv(),
		});
		expect(forced.created).toBe(true);
		expect(listMirrors({workspacesDir: ws(), env: gitEnv()}).length).toBe(2);
	});

	it('re-adding the SAME url (same key) is idempotent reuse, not a guard conflict', () => {
		const repo = seedWorkingRepo('proj');
		const first = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		// Same project, same transport, same key ⇒ no guard trip; fetch + reuse.
		const again = remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		expect(again.created).toBe(false);
		expect(again.key).toBe(first.key);
	});
});

describe('remote add — STRONG project-identity guard + --force replace', () => {
	/**
	 * A throwaway bare repo at `<root>/<label>/wighawag/dorfl.git` (cloned
	 * from a seeded working repo). Its hub key encodes the full filesystem path, so
	 * two labels yield DIFFERENT keys but the SAME `projectIdFromKey` tail
	 * (`wighawag/dorfl`) — exactly the project-identity collision the strong
	 * guard keys on. Returns its `file://` URL.
	 */
	function bareProject(label: string): string {
		const src = seedWorkingRepo(`src-${label}`);
		const dir = join(scratch.root, label, 'wighawag');
		mkdirSync(dir, {recursive: true});
		const bare = join(dir, 'dorfl.git');
		gitIn(['clone', '-q', '--bare', src, bare], scratch.root);
		return `file://${bare}`;
	}

	/** Commit a new file on the job's work branch (advances the tip past main). */
	function commitWork(job: Job): void {
		writeFileSync(join(job.dir, 'work.txt'), 'agent work\n');
		git(['add', '-A'], job.dir, {env: gitEnv()});
		git(['commit', '-q', '-m', 'agent work'], job.dir, {env: gitEnv()});
	}

	/** Merge the work branch into the arbiter's main (the "merged" safe path). */
	function mergeToArbiterMain(job: Job): void {
		git(['push', '-q', 'origin', `${job.branch}:main`], job.dir, {
			env: gitEnv(),
		});
	}

	it('refuses a SECOND arbiter for an already-registered project by default (project-identity collision, not only transport)', () => {
		const urlA = bareProject('a');
		const urlB = bareProject('b');
		// Same transport (both local-bare) — so this is NOT a transport mismatch; it
		// is a pure project-identity collision the cheap transport guard would MISS.
		expect(transportForUrl(urlA)).toBe('local-bare');
		expect(transportForUrl(urlB)).toBe('local-bare');
		expect(projectIdFromKey(encodeRepoKey(urlA))).toBe(
			projectIdFromKey(encodeRepoKey(urlB)),
		);
		expect(encodeRepoKey(urlA)).not.toBe(encodeRepoKey(urlB));

		remoteAdd({target: urlA, workspacesDir: ws(), env: gitEnv()});

		expect(() =>
			remoteAdd({target: urlB, workspacesDir: ws(), env: gitEnv()}),
		).toThrow(RegistryError);
		try {
			remoteAdd({target: urlB, workspacesDir: ws(), env: gitEnv()});
		} catch (err) {
			expect((err as Error).message).toMatch(/already registered/);
			expect((err as Error).message).toMatch(/--force/);
		}
		// Nothing was registered for B (the default block fired BEFORE any clone).
		expect(listMirrors({workspacesDir: ws(), env: gitEnv()})).toHaveLength(1);
	});

	it('--force REPLACES the mirror when no worktree has un-pushed work', () => {
		const urlA = bareProject('a');
		const urlB = bareProject('b');
		const keyA = encodeRepoKey(urlA);
		const keyB = encodeRepoKey(urlB);

		remoteAdd({target: urlA, workspacesDir: ws(), env: gitEnv()});

		// A live worktree of A whose work IS saved (merged onto the arbiter) — clean
		// AND reachable, so the replace is provably safe.
		const job = createJob({
			url: urlA,
			slug: 'feat',
			workspacesDir: ws(),
			env: gitEnv(),
		});
		commitWork(job);
		mergeToArbiterMain(job);

		const forced = remoteAdd({
			target: urlB,
			workspacesDir: ws(),
			force: true,
			env: gitEnv(),
		});
		expect(forced.created).toBe(true);
		expect(forced.key).toBe(keyB);

		// The prior mirror (A) is GONE (replaced), only B remains for the project.
		const keys = listMirrors({workspacesDir: ws(), env: gitEnv()}).map(
			(m) => m.key,
		);
		expect(keys).toContain(keyB);
		expect(keys).not.toContain(keyA);
		expect(existsSync(mirrorPath(ws(), urlA))).toBe(false);
	});

	it('--force is REFUSED (data-loss) when a worktree of the replaced mirror is DIRTY (uncommitted)', () => {
		const urlA = bareProject('a');
		const urlB = bareProject('b');
		const keyA = encodeRepoKey(urlA);

		remoteAdd({target: urlA, workspacesDir: ws(), env: gitEnv()});

		// A worktree of A with work that IS saved on the arbiter, BUT a DIRTY tree —
		// the uncommitted change lives ONLY on disk, invisible to a mirror-refs check.
		const job = createJob({
			url: urlA,
			slug: 'feat',
			workspacesDir: ws(),
			env: gitEnv(),
		});
		commitWork(job);
		mergeToArbiterMain(job);
		writeFileSync(join(job.dir, 'scratch.txt'), 'uncommitted\n');

		expect(() =>
			remoteAdd({
				target: urlB,
				workspacesDir: ws(),
				force: true,
				env: gitEnv(),
			}),
		).toThrow(ReplaceWouldStrandWorkError);
		try {
			remoteAdd({
				target: urlB,
				workspacesDir: ws(),
				force: true,
				env: gitEnv(),
			});
		} catch (err) {
			expect((err as Error).message).toMatch(/dirty tree/);
			expect((err as Error).message).toMatch(/feat/);
		}
		// --force did NOT override the data-loss block: A is untouched.
		expect(existsSync(mirrorPath(ws(), urlA))).toBe(true);
		expect(
			listMirrors({workspacesDir: ws(), env: gitEnv()}).map((m) => m.key),
		).toContain(keyA);
	});

	it('--force is REFUSED (data-loss) when a worktree has committed-but-unpushed work (mirror-refs case)', () => {
		const urlA = bareProject('a');
		const urlB = bareProject('b');
		const keyA = encodeRepoKey(urlA);

		remoteAdd({target: urlA, workspacesDir: ws(), env: gitEnv()});

		// A worktree of A with COMMITTED work that is neither merged nor pushed — a
		// `work/*` tip not reachable on the arbiter (the mirror-refs detectable case).
		const job = createJob({
			url: urlA,
			slug: 'feat',
			workspacesDir: ws(),
			env: gitEnv(),
		});
		commitWork(job); // committed, never pushed/merged

		expect(() =>
			remoteAdd({
				target: urlB,
				workspacesDir: ws(),
				force: true,
				env: gitEnv(),
			}),
		).toThrow(ReplaceWouldStrandWorkError);
		try {
			remoteAdd({
				target: urlB,
				workspacesDir: ws(),
				force: true,
				env: gitEnv(),
			});
		} catch (err) {
			expect((err as Error).message).toMatch(/unmerged commits|not pushed/);
		}
		// The data-loss block held: A survives.
		expect(existsSync(mirrorPath(ws(), urlA))).toBe(true);
		expect(
			listMirrors({workspacesDir: ws(), env: gitEnv()}).map((m) => m.key),
		).toContain(keyA);
	});

	it('the cheap transport-mismatch guard is NOT regressed (still refuses by default)', () => {
		const repo = seedWorkingRepo(join('wighawag', 'dorfl'));
		remoteAdd({
			target: repo,
			local: true,
			workspacesDir: ws(),
			arbitersDir: arbitersDir(),
			env: gitEnv(),
		});
		// A remote-host transport for the same project is still refused by default.
		expect(() =>
			remoteAdd({
				target: 'git@github.com:wighawag/dorfl.git',
				workspacesDir: ws(),
				env: gitEnv(),
			}),
		).toThrow(RegistryError);
	});
});

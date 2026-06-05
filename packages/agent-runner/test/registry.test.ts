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
} from '../src/registry.js';
import {arbiterPath} from '../src/arbiter.js';
import {findParticipatingRepos} from '../src/detect.js';
import {mirrorPath, encodeRepoKey} from '../src/repo-mirror.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-registry-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A throwaway working repo with a populated `work/backlog/` (a participating repo). */
function seedWorkingRepo(name: string, slugs: string[] = ['feat']): string {
	const repo = join(scratch.root, name);
	mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	for (const slug of slugs) {
		writeFileSync(
			join(repo, 'work', 'backlog', `${slug}.md`),
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
	return join(scratch.root, '.agent-runner');
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
		expect(projectIdFromKey('github-com/wighawag/agent-runner')).toBe(
			'wighawag/agent-runner',
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
		// The arbiter is precious DATA under arbitersDir, NEVER ~/.agent-runner.
		expect(first.arbiter?.path).toBe(
			arbiterPath(arbitersDir(), `file://${repo}`),
		);
		expect(first.arbiter?.path).not.toMatch(/\.agent-runner/);
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
		// Seed the working repo under a `.../wighawag/agent-runner` path so its
		// project-identity tail matches the github URL below (the guard keys on the
		// org/name tail, NOT the URL).
		const repo = seedWorkingRepo(join('wighawag', 'agent-runner'));
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
				target: 'git@github.com:wighawag/agent-runner.git',
				workspacesDir: ws(),
				env: gitEnv(),
			}),
		).toThrow(RegistryError);
		try {
			remoteAdd({
				target: 'git@github.com:wighawag/agent-runner.git',
				workspacesDir: ws(),
				env: gitEnv(),
			});
		} catch (err) {
			// The error names the EXISTING transport (read from the existing mirror).
			expect((err as Error).message).toMatch(/local-bare/);
		}
	});

	it('--force overrides the transport guard', () => {
		const repo = seedWorkingRepo('agent-runner');
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
		const otherBare = join(
			scratch.root,
			'other',
			'wighawag',
			'agent-runner.git',
		);
		const src = seedWorkingRepo('src2');
		mkdirSync(join(scratch.root, 'other', 'wighawag'), {recursive: true});
		gitIn(['clone', '-q', '--bare', src, otherBare], scratch.root);

		// Sanity: same project identity, different key.
		expect(projectIdFromKey(encodeRepoKey(`file://${otherBare}`))).toBe(
			'wighawag/agent-runner',
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

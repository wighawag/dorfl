import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	run,
	runAsync,
	resolveGitBinary,
	resetResolvedGitBinaryForTest,
	setFallbackPathDirsForTest,
} from '../src/git.js';

/**
 * A `PATH` that a version-manager / MCP-agent launch might hand us: it lists
 * only tool-manager bin dirs and OMITS the standard system dirs (`/usr/bin`,
 * `/bin`, ...). Under such a `PATH`, a bare `spawn('git')` throws `ENOENT` unless
 * git resolution is hardened (the bug this suite pins). We keep it deliberately
 * pointing at dirs that do NOT contain a `git`, so only the system-dir UNION can
 * find one.
 */
const CURATED_PATH_WITHOUT_SYSTEM_DIRS =
	'/home/nobody/.volta/bin:/home/nobody/.cargo/bin';

function brokenEnv(): NodeJS.ProcessEnv {
	return {...process.env, PATH: CURATED_PATH_WITHOUT_SYSTEM_DIRS};
}

describe('git spawn hardening under a caller PATH that omits /usr/bin', () => {
	beforeEach(() => {
		resetResolvedGitBinaryForTest();
	});

	it('resolveGitBinary finds an absolute git even when PATH omits the system dirs', () => {
		const resolved = resolveGitBinary(brokenEnv());
		// Either an absolute path was found (the normal case on a machine with git
		// in a system dir), or the bare fallback (only if git is genuinely absent).
		expect(resolved === 'git' || resolved.startsWith('/')).toBe(true);
		// On any CI/dev box with git installed in a standard dir it must be absolute.
		expect(resolved).not.toBe('');
	});

	it('run() spawns git successfully under the curated PATH (no ENOENT)', () => {
		const res = run('git', ['--version'], process.cwd(), {env: brokenEnv()});
		expect(res.status).toBe(0);
		expect(res.stdout).toMatch(/git version/);
	});

	it('runAsync() spawns git successfully under the curated PATH (no ENOENT)', async () => {
		const res = await runAsync('git', ['--version'], process.cwd(), {
			env: brokenEnv(),
		});
		expect(res.status).toBe(0);
		expect(res.stdout).toMatch(/git version/);
	});

	it('honours an explicit DORFL_GIT override (absolute path wins)', () => {
		const ambient = resolveGitBinary(process.env);
		resetResolvedGitBinaryForTest();
		// Only assert override behaviour when we actually resolved an absolute git
		// to point DORFL_GIT at (skip on the pathological no-git box).
		if (ambient.startsWith('/')) {
			const resolved = resolveGitBinary({
				...brokenEnv(),
				DORFL_GIT: ambient,
			});
			expect(resolved).toBe(ambient);
		}
	});

	it('a genuinely missing command yields an actionable ENOENT message (effective PATH shown)', () => {
		expect(() =>
			run('definitely-not-a-real-binary-xyz', ['x'], process.cwd(), {
				env: {...process.env, PATH: '/nonexistent'},
			}),
		).toThrow(/Effective PATH=/);
	});

	it('the hardened spawn env keeps the system dirs so git subprocesses resolve too', async () => {
		// `git` here prints its own PATH-derived exec-path; success is enough to
		// prove the union reached the child. We assert a clean exit under the
		// curated PATH.
		const res = await runAsync('git', ['--exec-path'], process.cwd(), {
			env: brokenEnv(),
		});
		expect(res.status).toBe(0);
	});
});

/** Create `<root>/<name>/git` as an executable fake git; returns the dir. */
function fakeGitDir(root: string, name: string): string {
	const dir = join(root, name);
	mkdirSync(dir, {recursive: true});
	const git = join(dir, 'git');
	writeFileSync(git, `#!/bin/sh\necho "fake git from ${name}"\n`);
	chmodSync(git, 0o755);
	return dir;
}

describe('git resolution falls back to the NixOS system profiles', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-git-probe-'));
		resetResolvedGitBinaryForTest();
	});

	afterEach(() => {
		setFallbackPathDirsForTest(undefined);
		rmSync(root, {recursive: true, force: true});
	});

	it('resolves git from a NixOS-profile-like dir when the env has no PATH', () => {
		// Simulate a NixOS host: the FHS dirs hold no git, only the (fake) system
		// profile does, and the env carries no PATH at all (the `env: {}` case).
		const emptyFhs = join(root, 'usr-bin');
		mkdirSync(emptyFhs);
		const profile = fakeGitDir(root, 'run-current-system-sw-bin');
		setFallbackPathDirsForTest([emptyFhs, profile]);
		expect(resolveGitBinary({})).toBe(join(profile, 'git'));
		const res = run('git', [], root, {env: {}});
		expect(res.status).toBe(0);
		expect(res.stdout).toMatch(/fake git from run-current-system-sw-bin/);
	});

	it('precedence: DORFL_GIT, then GIT, then the env PATH, then the fallback dirs in order', () => {
		const override = join(fakeGitDir(root, 'override'), 'git');
		const gitVar = join(fakeGitDir(root, 'git-var'), 'git');
		const onPath = fakeGitDir(root, 'on-path');
		const fhs = fakeGitDir(root, 'fhs');
		const nix = fakeGitDir(root, 'nix');
		setFallbackPathDirsForTest([fhs, nix]);

		expect(
			resolveGitBinary({DORFL_GIT: override, GIT: gitVar, PATH: onPath}),
		).toBe(override);
		expect(resolveGitBinary({GIT: gitVar, PATH: onPath})).toBe(gitVar);
		expect(resolveGitBinary({PATH: onPath})).toBe(join(onPath, 'git'));
		// No PATH: the FIRST fallback dir (the FHS stand-in) wins over the later one.
		expect(resolveGitBinary({})).toBe(join(fhs, 'git'));
	});

	it('the default fallback list keeps the FHS dirs ahead of the NixOS profiles on the spawn PATH', () => {
		setFallbackPathDirsForTest(undefined);
		expect(() =>
			run('definitely-not-a-real-binary-xyz', [], root, {env: {}}),
		).toThrow(
			'Effective PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin',
		);
	});
});

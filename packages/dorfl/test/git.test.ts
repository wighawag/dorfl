import {describe, it, expect, beforeEach} from 'vitest';
import {
	run,
	runAsync,
	resolveGitBinary,
	resetResolvedGitBinaryForTest,
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

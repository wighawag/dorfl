import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {buildProgram} from '../src/cli.js';
import {
	checkoutPersistsCredential,
	gitConfigListHoldsCredential,
	singleJobWarning,
} from '../src/single-job-warning.js';

/**
 * Decision 9 of ADR `ci-agent-job-holds-no-write-token` (task
 * `ci-split-warn-single-job-workflows`): an agent-spawning verb run in GitHub
 * Actions without `--phase`, in a checkout whose git config persists a
 * credential, prints a loud warning (and still runs). Never the credential.
 */

const SECRET = 'ghs_' + 'A'.repeat(36);
const HEADER = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${SECRET}`).toString('base64')}`;

const dirs: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) {
		rmSync(dir, {recursive: true, force: true});
	}
});

function gitIn(cwd: string, args: string[]): void {
	execFileSync('git', args, {cwd, stdio: 'ignore'});
}

/** A throwaway repo; `setup` adds config the way `actions/checkout` would. */
function repo(setup?: (dir: string) => void): string {
	const dir = mkdtempSync(join(tmpdir(), 'dorfl-single-job-'));
	dirs.push(dir);
	gitIn(dir, ['init', '-q']);
	setup?.(dir);
	return dir;
}

function withExtraheader(dir: string): void {
	gitIn(dir, [
		'config',
		'--local',
		'http.https://github.com/.extraheader',
		HEADER,
	]);
}

describe('gitConfigListHoldsCredential', () => {
	it('matches a non-empty http extraheader and a URL with userinfo', () => {
		expect(
			gitConfigListHoldsCredential(
				`core.bare\nfalse\0http.https://github.com/.extraheader\n${HEADER}\0`,
			),
		).toBe(true);
		expect(
			gitConfigListHoldsCredential(
				`remote.origin.url\nhttps://x-access-token:${SECRET}@github.com/o/r\0`,
			),
		).toBe(true);
	});

	it('ignores plain remotes, ssh userinfo and an empty extraheader', () => {
		expect(
			gitConfigListHoldsCredential(
				'remote.origin.url\nhttps://github.com/o/r\0' +
					'url.ssh://git@github.com/.insteadof\nhttps://github.com/\0' +
					'http.extraheader\n\0',
			),
		).toBe(false);
	});
});

describe('checkoutPersistsCredential', () => {
	it('is false for a clean checkout and outside a repository', () => {
		expect(checkoutPersistsCredential(repo())).toBe(false);
		const plain = mkdtempSync(join(tmpdir(), 'dorfl-single-job-plain-'));
		dirs.push(plain);
		expect(checkoutPersistsCredential(plain)).toBe(false);
	});

	it('is true for an extraheader in .git/config', () => {
		expect(checkoutPersistsCredential(repo(withExtraheader))).toBe(true);
	});

	it('is true for a remote URL with userinfo', () => {
		const dir = repo((d) =>
			gitIn(d, [
				'remote',
				'add',
				'origin',
				`https://x-access-token:${SECRET}@github.com/o/r.git`,
			]),
		);
		expect(checkoutPersistsCredential(dir)).toBe(true);
	});

	it('follows an includeIf file (actions/checkout v6+ persists it there)', () => {
		const dir = repo((d) => {
			const file = join(d, 'credentials.config');
			writeFileSync(
				file,
				`[http "https://github.com/"]\n\textraheader = ${HEADER}\n`,
			);
			gitIn(d, ['config', '--local', `includeIf.gitdir:${d}/.git.path`, file]);
		});
		expect(checkoutPersistsCredential(dir)).toBe(true);
	});

	it('ignores a credential handed to git through the environment only', () => {
		vi.stubEnv('GIT_CONFIG_COUNT', '1');
		vi.stubEnv('GIT_CONFIG_KEY_0', 'http.https://github.com/.extraheader');
		vi.stubEnv('GIT_CONFIG_VALUE_0', HEADER);
		expect(checkoutPersistsCredential(repo())).toBe(false);
	});
});

describe('singleJobWarning', () => {
	it('warns in the unsafe shape, without printing the credential', () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		const text = singleJobWarning({
			verb: 'advance',
			phase: undefined,
			env: process.env,
			cwd: repo(withExtraheader),
		});
		expect(text).toBeDefined();
		expect(text).toMatch(/unsafe single-job CI workflow/);
		expect(text).toMatch(/dorfl install-ci/);
		expect(text).toMatch(/next minor version/);
		expect(text).not.toContain(SECRET);
		expect(text).not.toContain(HEADER);
	});

	it.each(['intake', 'advance', 'do', 'run', 'start', 'complete'])(
		'warns for the agent-spawning verb %s',
		(verb) => {
			vi.stubEnv('GITHUB_ACTIONS', 'true');
			expect(
				singleJobWarning({
					verb,
					phase: undefined,
					env: process.env,
					cwd: '/unused',
					persistsCredential: () => true,
				}),
			).toBeDefined();
		},
	);

	it.each(['lock', 'agent', 'apply'] as const)(
		'is silent with --phase %s',
		(phase) => {
			vi.stubEnv('GITHUB_ACTIONS', 'true');
			expect(
				singleJobWarning({
					verb: 'advance',
					phase,
					env: process.env,
					cwd: repo(withExtraheader),
				}),
			).toBeUndefined();
		},
	);

	it('is silent outside GitHub Actions', () => {
		vi.stubEnv('GITHUB_ACTIONS', '');
		expect(
			singleJobWarning({
				verb: 'advance',
				phase: undefined,
				env: process.env,
				cwd: repo(withExtraheader),
			}),
		).toBeUndefined();
	});

	it('is silent when no credential is persisted', () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		expect(
			singleJobWarning({
				verb: 'advance',
				phase: undefined,
				env: process.env,
				cwd: repo(),
			}),
		).toBeUndefined();
	});

	it('is silent for verify (runs repo code, launches no agent)', () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		expect(
			singleJobWarning({
				verb: 'verify',
				phase: undefined,
				env: process.env,
				cwd: repo(withExtraheader),
			}),
		).toBeUndefined();
	});

	it('is silent for a verb that spawns no agent', () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		expect(
			singleJobWarning({
				verb: 'status',
				phase: undefined,
				env: process.env,
				cwd: '/unused',
				persistsCredential: () => true,
			}),
		).toBeUndefined();
	});
});

describe('the CLI prints the warning before the action runs', () => {
	async function runVerb(
		argv: string[],
		cwd: string,
	): Promise<{stderr: string; ran: boolean}> {
		vi.spyOn(process, 'cwd').mockReturnValue(cwd);
		let stderr = '';
		vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			stderr += args.join(' ') + '\n';
		});
		const program = buildProgram();
		const sub = program.commands.find((c) => c.name() === argv[0])!;
		const action = vi.fn();
		sub.action(action);
		await program.parseAsync(['node', 'dorfl', ...argv]);
		return {stderr, ran: action.mock.calls.length === 1};
	}

	it('warns and still runs in the unsafe shape', async () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		const {stderr, ran} = await runVerb(
			['advance', 'some-task'],
			repo(withExtraheader),
		);
		expect(ran).toBe(true);
		expect(stderr).toMatch(/unsafe single-job CI workflow/);
		expect(stderr).not.toContain(SECRET);
	});

	it('is silent with --phase', async () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		const {stderr, ran} = await runVerb(
			['advance', 'some-task', '--phase', 'agent'],
			repo(withExtraheader),
		);
		expect(ran).toBe(true);
		expect(stderr).toBe('');
	});

	it('is silent for verify in the unsafe shape', async () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		const {stderr, ran} = await runVerb(['verify'], repo(withExtraheader));
		expect(ran).toBe(true);
		expect(stderr).toBe('');
	});
});

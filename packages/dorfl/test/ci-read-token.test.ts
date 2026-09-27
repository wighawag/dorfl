import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	gitChildEnv,
	readTokenHeaderKey,
	resolveReadToken,
	withReadTokenGitConfig,
} from '../src/ci-read-token.js';
import {git, run} from '../src/git.js';
import {agentLaunchEnv} from '../src/harness.js';
import {enterPhase} from '../src/phase.js';

/**
 * The agent job's READ token is passed PER COMMAND to dorfl's own git children
 * (task `ci-split-phase-mode-and-guards`): through `GIT_CONFIG_*` /
 * `http.<server>/.extraheader`, never `.git/config`, and never into the env an
 * agent is launched with.
 */

// Deliberately NOT a `ghs_`-shaped value, so the agent-env assertion below
// proves the `GIT_CONFIG_*` block itself is scrubbed (not just a token shape).
const TOKEN = 'read-only-token-value-0123456789';
const HEADER_KEY = readTokenHeaderKey('https://github.com');

let dir: string | undefined;
let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	if (dir !== undefined) {
		rmSync(dir, {recursive: true, force: true});
		dir = undefined;
	}
});

/** A base env with no inherited git env config (the test must not depend on the caller's). */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (!/^GIT_CONFIG|^GH_TOKEN$|^GITHUB_TOKEN$|^GITHUB_SERVER_URL$/.test(k)) {
			env[k] = v;
		}
	}
	return {...env, ...extra};
}

function repo(): string {
	dir = mkdtempSync(join(tmpdir(), 'dorfl-read-token-'));
	git(['init', '-q'], dir, {env: cleanEnv()});
	return dir;
}

const expectedHeader = `AUTHORIZATION: basic ${Buffer.from(
	`x-access-token:${TOKEN}`,
).toString('base64')}`;

describe('withReadTokenGitConfig', () => {
	it('adds the header through GIT_CONFIG_* without mutating the input, appending to an existing block', () => {
		const base = {
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.x',
			GIT_CONFIG_VALUE_0: 'y',
		};
		const out = withReadTokenGitConfig(base, TOKEN, 'https://github.com/');
		expect(base).toEqual({
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.x',
			GIT_CONFIG_VALUE_0: 'y',
		});
		expect(out.GIT_CONFIG_COUNT).toBe('2');
		expect(out.GIT_CONFIG_KEY_1).toBe(HEADER_KEY);
		expect(out.GIT_CONFIG_VALUE_1).toBe(expectedHeader);
		// Idempotent.
		expect(withReadTokenGitConfig(out, TOKEN, 'https://github.com')).toBe(out);
	});

	it('resolveReadToken prefers GH_TOKEN, then GITHUB_TOKEN', () => {
		expect(resolveReadToken({GH_TOKEN: 'a', GITHUB_TOKEN: 'b'})).toBe('a');
		expect(resolveReadToken({GITHUB_TOKEN: 'b'})).toBe('b');
		expect(resolveReadToken({GH_TOKEN: ' '})).toBeUndefined();
	});
});

describe('the read token in the agent phase', () => {
	it('reaches the child git process through GIT_CONFIG_*, and is absent from .git/config and the agent env', () => {
		const cwd = repo();
		const env = cleanEnv({GITHUB_TOKEN: TOKEN, GITHUB_ACTIONS: 'true'});
		restore = enterPhase('agent');

		// dorfl's own git child (the git.ts spawn chokepoint) sees the header.
		const seen = git(['config', '--get', HEADER_KEY], cwd, {env}).trim();
		expect(seen).toBe(expectedHeader);

		// It is NOT persisted: .git/config never holds it.
		const config = readFileSync(join(cwd, '.git', 'config'), 'utf8');
		expect(config).not.toMatch(/extraheader/i);
		expect(config).not.toContain(TOKEN);
		expect(config).not.toContain(expectedHeader);

		// The env an agent would be launched with carries neither the header nor the token.
		const agentEnv = agentLaunchEnv(gitChildEnv(env));
		expect(
			Object.keys(agentEnv).filter((k) => k.startsWith('GIT_CONFIG')),
		).toEqual([]);
		for (const value of Object.values(agentEnv)) {
			expect(value ?? '').not.toContain(TOKEN);
			expect(value ?? '').not.toContain(expectedHeader);
		}
	});

	it('is not added without a phase (laptop) or in the lock and apply phases', () => {
		const cwd = repo();
		const env = cleanEnv({GITHUB_TOKEN: TOKEN});
		for (const phase of [undefined, 'lock', 'apply'] as const) {
			const undo = enterPhase(phase);
			try {
				expect(gitChildEnv(env)).toBe(env);
				// `git config --get` exits 1 when the key is absent.
				const result = run('git', ['config', '--get', HEADER_KEY], cwd, {env});
				expect(result.status).toBe(1);
				expect(result.stdout).toBe('');
			} finally {
				undo();
			}
		}
	});
});

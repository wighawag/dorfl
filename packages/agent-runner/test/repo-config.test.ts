import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig} from '../src/config.js';
import {
	REPO_CONFIG_FILENAME,
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	repoConfigPath,
	loadRepoConfig,
	resolveRepoConfig,
} from '../src/repo-config.js';

/** Write a `.agent-runner.json` at the root of a throwaway repo dir. */
function writeRepoConfig(repoPath: string, value: unknown): void {
	writeFileSync(join(repoPath, REPO_CONFIG_FILENAME), JSON.stringify(value));
}

describe('repo-config constants', () => {
	it('names the per-repo file `.agent-runner.json`', () => {
		expect(REPO_CONFIG_FILENAME).toBe('.agent-runner.json');
	});

	it('treats integration, verify, defaultArbiter, allowAgents as repo-appropriate keys', () => {
		expect(REPO_ALLOWED_KEYS).toContain('integration');
		expect(REPO_ALLOWED_KEYS).toContain('verify');
		expect(REPO_ALLOWED_KEYS).toContain('defaultArbiter');
		expect(REPO_ALLOWED_KEYS).toContain('allowAgents');
	});

	it('treats runner/host-only keys as rejected in a per-repo file', () => {
		expect(REPO_REJECTED_KEYS).toContain('piBin');
		expect(REPO_REJECTED_KEYS).toContain('maxParallel');
		expect(REPO_REJECTED_KEYS).toContain('humanWorktreesDir');
		// `sessionsDir` is a HOST-ONLY machine path (where session logs are written),
		// rejected per-repo exactly like `piBin` (a committed file must not redirect it).
		expect(REPO_REJECTED_KEYS).toContain('sessionsDir');
	});

	it('keeps allowed and rejected key sets disjoint', () => {
		for (const key of REPO_ALLOWED_KEYS) {
			expect(REPO_REJECTED_KEYS).not.toContain(key);
		}
	});
});

describe('repoConfigPath', () => {
	it('joins the repo root with the per-repo filename', () => {
		expect(repoConfigPath('/some/repo')).toBe(
			join('/some/repo', '.agent-runner.json'),
		);
	});
});

describe('loadRepoConfig', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'agent-runner-repocfg-'));
	});

	afterEach(() => {
		rmSync(repo, {recursive: true, force: true});
	});

	it('returns an empty config and no rejected keys when the file is absent', () => {
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({});
		expect(loaded.rejected).toEqual([]);
		expect(loaded.path).toBe(repoConfigPath(repo));
	});

	it('reads only repo-appropriate keys from the file', () => {
		writeRepoConfig(repo, {integration: 'merge', defaultArbiter: 'arbiter'});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({
			integration: 'merge',
			defaultArbiter: 'arbiter',
		});
		expect(loaded.rejected).toEqual([]);
	});

	it('reads a verify gate (string or list)', () => {
		writeRepoConfig(repo, {verify: 'make check'});
		expect(loadRepoConfig(repo).config.verify).toBe('make check');
		writeRepoConfig(repo, {verify: ['a', 'b']});
		expect(loadRepoConfig(repo).config.verify).toEqual(['a', 'b']);
	});

	it('rejects runner/host-only keys and reports them (does not honour them)', () => {
		writeRepoConfig(repo, {
			integration: 'merge',
			piBin: '/x',
			maxParallel: 9,
		});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.config).not.toHaveProperty('piBin');
		expect(loaded.config).not.toHaveProperty('maxParallel');
		expect(loaded.rejected).toContain('piBin');
		expect(loaded.rejected).toContain('maxParallel');
	});

	it('rejects a committed sessionsDir (host-only) and reports it, like piBin', () => {
		writeRepoConfig(repo, {
			integration: 'merge',
			sessionsDir: '/tmp/evil-sessions',
		});
		const loaded = loadRepoConfig(repo);
		// The committed sessionsDir is NOT honoured (a repo file must not redirect
		// where the host writes session logs) — it is rejected + reported.
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.config).not.toHaveProperty('sessionsDir');
		expect(loaded.rejected).toContain('sessionsDir');
		expect(loaded.message).toMatch(/sessionsDir/);
	});

	it('exposes a clear message naming the rejected keys and the file', () => {
		writeRepoConfig(repo, {piBin: '/x', maxParallel: 9});
		const loaded = loadRepoConfig(repo);
		expect(loaded.message).toBeDefined();
		expect(loaded.message).toMatch(/piBin/);
		expect(loaded.message).toMatch(/maxParallel/);
		expect(loaded.message).toMatch(/\.agent-runner\.json/);
	});

	it('has no message when nothing was rejected', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		expect(loadRepoConfig(repo).message).toBeUndefined();
	});

	it('ignores unknown keys silently (not rejected, not honoured)', () => {
		writeRepoConfig(repo, {integration: 'merge', somethingElse: 1});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.rejected).toEqual([]);
	});

	it('throws a helpful error on invalid JSON', () => {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), '{ not json');
		expect(() => loadRepoConfig(repo)).toThrow(/\.agent-runner\.json/);
	});
});

describe('resolveRepoConfig — per-key layering', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'agent-runner-resolve-'));
	});

	afterEach(() => {
		rmSync(repo, {recursive: true, force: true});
	});

	it('a repo with no file resolves to the global config (unchanged behaviour)', () => {
		const global = mergeConfig({integration: 'merge', maxParallel: 7});
		const resolved = resolveRepoConfig({repoPath: repo, global});
		expect(resolved.config).toEqual(global);
		expect(resolved.rejected).toEqual([]);
	});

	it('a repo with no file and a bare global keeps the built-in defaults', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect(resolved.config).toEqual(DEFAULT_CONFIG);
	});

	it('per-repo file overrides the global for `integration`', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({repoPath: repo, global});
		expect(resolved.config.integration).toBe('merge');
	});

	it('per-repo file overrides the global for `verify` too', () => {
		writeRepoConfig(repo, {verify: 'make test'});
		const global = mergeConfig({verify: 'pnpm test'});
		const resolved = resolveRepoConfig({repoPath: repo, global});
		expect(resolved.config.verify).toBe('make test');
	});

	it('per-repo file overrides the global for `allowAgents` (flag > per-repo > global > default)', () => {
		// default false; global false; per-repo opts in ⇒ per-repo wins.
		writeRepoConfig(repo, {allowAgents: true});
		const global = mergeConfig({allowAgents: false});
		expect(resolveRepoConfig({repoPath: repo, global}).config.allowAgents).toBe(
			true,
		);
		// a flag beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				flags: {allowAgents: false},
			}).config.allowAgents,
		).toBe(false);
	});

	it('keeps runner/host-only keys from the GLOBAL (per-repo cannot touch them)', () => {
		writeRepoConfig(repo, {integration: 'merge', maxParallel: 9});
		const global = mergeConfig({integration: 'propose', maxParallel: 4});
		const resolved = resolveRepoConfig({repoPath: repo, global});
		expect(resolved.config.integration).toBe('merge'); // per-repo wins
		expect(resolved.config.maxParallel).toBe(4); // global-only, untouched
		expect(resolved.rejected).toContain('maxParallel');
	});

	it('flag overrides beat the per-repo file (flag > per-repo > global > default)', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			flags: {integration: 'propose'},
		});
		expect(resolved.config.integration).toBe('propose');
	});

	it('the full precedence chain holds for one key', () => {
		// default = propose; global = merge; per-repo = propose; flag = merge
		writeRepoConfig(repo, {integration: 'propose'});
		const global = mergeConfig({integration: 'merge'});
		// no flag ⇒ per-repo wins over global
		expect(resolveRepoConfig({repoPath: repo, global}).config.integration).toBe(
			'propose',
		);
		// flag ⇒ flag wins over everything
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				flags: {integration: 'merge'},
			}).config.integration,
		).toBe('merge');
	});

	it('falls back to global then default when neither file nor flag set a key', () => {
		// bare global ⇒ integration falls to the built-in default (propose)
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect(resolved.config.integration).toBe(DEFAULT_CONFIG.integration);
	});
});

describe('resolveRepoConfig — multi-repo independence', () => {
	let repoA: string;
	let repoB: string;

	beforeEach(() => {
		repoA = mkdtempSync(join(tmpdir(), 'agent-runner-repoA-'));
		repoB = mkdtempSync(join(tmpdir(), 'agent-runner-repoB-'));
	});

	afterEach(() => {
		rmSync(repoA, {recursive: true, force: true});
		rmSync(repoB, {recursive: true, force: true});
	});

	it('each repo resolves against its OWN file in one run (A merge, B propose)', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		writeRepoConfig(repoB, {integration: 'propose'});
		const global = mergeConfig({integration: 'propose'});

		const a = resolveRepoConfig({repoPath: repoA, global});
		const b = resolveRepoConfig({repoPath: repoB, global});

		expect(a.config.integration).toBe('merge');
		expect(b.config.integration).toBe('propose');
	});

	it('a repo without a file uses the global while a sibling overrides it', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		// repoB has no file
		const global = mergeConfig({integration: 'propose'});

		const a = resolveRepoConfig({repoPath: repoA, global});
		const b = resolveRepoConfig({repoPath: repoB, global});

		expect(a.config.integration).toBe('merge'); // own file
		expect(b.config.integration).toBe('propose'); // global
	});

	it('repos can carry different verify gates and arbiters in one run', () => {
		writeRepoConfig(repoA, {verify: 'make a', defaultArbiter: 'a-remote'});
		writeRepoConfig(repoB, {verify: ['x', 'y'], defaultArbiter: 'b-remote'});
		const global = mergeConfig({});

		const a = resolveRepoConfig({repoPath: repoA, global});
		const b = resolveRepoConfig({repoPath: repoB, global});

		expect(a.config.verify).toBe('make a');
		expect(a.config.defaultArbiter).toBe('a-remote');
		expect(b.config.verify).toEqual(['x', 'y']);
		expect(b.config.defaultArbiter).toBe('b-remote');
	});

	it('resolution is read-only and does not mutate the shared global config', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const snapshot = {...global};
		resolveRepoConfig({repoPath: repoA, global});
		expect(global).toEqual(snapshot);
	});

	it('works when the repo root happens to be a nested directory tree', () => {
		const nested = join(repoA, 'deep', 'nested');
		mkdirSync(nested, {recursive: true});
		writeRepoConfig(nested, {integration: 'merge'});
		const resolved = resolveRepoConfig({
			repoPath: nested,
			global: mergeConfig({integration: 'propose'}),
		});
		expect(resolved.config.integration).toBe('merge');
	});
});

describe('resolveRepoConfig — AGENT_RUNNER_* env layer', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'agent-runner-env-'));
	});

	afterEach(() => {
		rmSync(repo, {recursive: true, force: true});
	});

	it('env sits ABOVE per-repo + global but BELOW a flag (chain position)', () => {
		// global = propose; per-repo = propose; env = merge; flag = propose
		writeRepoConfig(repo, {integration: 'propose'});
		const global = mergeConfig({integration: 'propose'});
		const env = {AGENT_RUNNER_INTEGRATION: 'merge'};
		// env beats per-repo + global
		expect(
			resolveRepoConfig({repoPath: repo, global, env}).config.integration,
		).toBe('merge');
		// a flag still beats env
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env,
				flags: {integration: 'propose'},
			}).config.integration,
		).toBe('propose');
	});

	it('env overrides the GLOBAL when there is no per-repo file', () => {
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {AGENT_RUNNER_INTEGRATION: 'merge'},
		});
		expect(resolved.config.integration).toBe('merge');
	});

	it('env sets host-only keys the per-repo file rejects (per-machine source)', () => {
		// The per-repo file tries (and fails) to set host-only keys; env sets them.
		writeRepoConfig(repo, {piBin: '/ignored', maxParallel: 99});
		const global = mergeConfig({});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {
				AGENT_RUNNER_PI_BIN: '/opt/pi',
				AGENT_RUNNER_AGENT_CMD: 'agent',
				AGENT_RUNNER_MAX_PARALLEL: '8',
			},
		});
		// env wins for the host-only keys; the per-repo file's attempts are rejected.
		expect(resolved.config.piBin).toBe('/opt/pi');
		expect(resolved.config.agentCmd).toBe('agent');
		expect(resolved.config.maxParallel).toBe(8);
		// the per-repo file STILL reports the rejected host-only keys
		expect(resolved.rejected).toContain('piBin');
		expect(resolved.rejected).toContain('maxParallel');
	});

	it('no env ⇒ built-in floors/defaults are unchanged (regression)', () => {
		// A bare global + empty env must leave piBin unset (floor `pi` applies later)
		// and every default intact.
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {},
		});
		expect(resolved.config).toEqual(DEFAULT_CONFIG);
		expect(resolved.config.piBin).toBeUndefined();
	});

	it('the global .config file still works alongside env (env is additive)', () => {
		// global file set maxParallel; env sets a DIFFERENT key ⇒ both apply.
		const global = mergeConfig({maxParallel: 6, defaultArbiter: 'origin'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {AGENT_RUNNER_AGENT_CMD: 'agent'},
		});
		expect(resolved.config.maxParallel).toBe(6); // from the global file
		expect(resolved.config.defaultArbiter).toBe('origin'); // from the global file
		expect(resolved.config.agentCmd).toBe('agent'); // additive from env
	});

	it('rejects an invalid env value LOUDLY (naming the var)', () => {
		expect(() =>
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({}),
				env: {AGENT_RUNNER_MAX_PARALLEL: 'lots'},
			}),
		).toThrow(/AGENT_RUNNER_MAX_PARALLEL/);
	});
});

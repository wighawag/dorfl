import {describe, it, expect} from 'vitest';
import {writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig, loadConfig} from '../src/config.js';
import {
	REPO_ALLOWED_KEYS,
	REPO_CONFIG_FILENAME,
	resolveRepoConfig,
} from '../src/repo-config.js';
import {envOverrides, envVarName} from '../src/env-config.js';
import {
	doFlagOverrides,
	freshWorktreeGateFlagOverrides,
} from '../src/do-config.js';

/**
 * `freshWorktreeGate` config resolution (task
 * `gate-on-rebased-tip-fresh-worktree`): a POSITIVE boolean, default `true`,
 * resolved per-repo through the SAME `flag > env > per-repo > global > default`
 * chain, modelled EXACTLY on `taskerLoop`. Pure logic (no git).
 */

describe('freshWorktreeGate — default + carry-through (positive, default-ON)', () => {
	it('defaults to true (on)', () => {
		expect(DEFAULT_CONFIG.freshWorktreeGate).toBe(true);
		expect(mergeConfig({}).freshWorktreeGate).toBe(true);
	});

	it('carries through mergeConfig when set false', () => {
		expect(mergeConfig({freshWorktreeGate: false}).freshWorktreeGate).toBe(
			false,
		);
	});
});

describe('freshWorktreeGate — env coercion (typed, loud)', () => {
	it('coerces AGENT_RUNNER_FRESH_WORKTREE_GATE as a boolean', () => {
		expect(
			envOverrides({AGENT_RUNNER_FRESH_WORKTREE_GATE: 'false'})
				.freshWorktreeGate,
		).toBe(false);
		expect(
			envOverrides({AGENT_RUNNER_FRESH_WORKTREE_GATE: 'true'})
				.freshWorktreeGate,
		).toBe(true);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('freshWorktreeGate')).toBe(
			'AGENT_RUNNER_FRESH_WORKTREE_GATE',
		);
	});

	it('fails LOUDLY on a non-boolean value', () => {
		expect(() =>
			envOverrides({AGENT_RUNNER_FRESH_WORKTREE_GATE: 'maybe'}),
		).toThrow(/AGENT_RUNNER_FRESH_WORKTREE_GATE/);
	});
});

describe('freshWorktreeGate — the flag override (--fresh-worktree-gate / --no-)', () => {
	it('a present positive flag ⇒ true; a present negation ⇒ false; absent ⇒ undefined', () => {
		expect(
			freshWorktreeGateFlagOverrides({freshWorktreeGate: true})
				.freshWorktreeGate,
		).toBe(true);
		expect(
			freshWorktreeGateFlagOverrides({freshWorktreeGate: false})
				.freshWorktreeGate,
		).toBe(false);
		expect(
			freshWorktreeGateFlagOverrides({}).freshWorktreeGate,
		).toBeUndefined();
	});

	it('is folded into doFlagOverrides (so `do`/`complete` resolve it on the same chain)', () => {
		expect(doFlagOverrides({freshWorktreeGate: false}).freshWorktreeGate).toBe(
			false,
		);
		// Absent ⇒ no key (never clobbers a lower-precedence source with undefined).
		expect('freshWorktreeGate' in doFlagOverrides({})).toBe(false);
	});
});

describe('freshWorktreeGate — the full precedence chain (flag > env > per-repo > global > default)', () => {
	let repoDir: string;

	const writeRepoConfig = (obj: Record<string, unknown>) => {
		writeFileSync(
			join(repoDir, REPO_CONFIG_FILENAME),
			JSON.stringify(obj, null, 2) + '\n',
		);
	};

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('freshWorktreeGate');
		repoDir = mkdtempSync(join(tmpdir(), 'freshgate-repo-'));
		try {
			writeRepoConfig({freshWorktreeGate: false});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (false) beats the global/default (true).
			expect(resolved.config.freshWorktreeGate).toBe(false);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('flag > env > per-repo > global', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'freshgate-repo-'));
		try {
			writeRepoConfig({freshWorktreeGate: true});
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({freshWorktreeGate: true}),
				env: {AGENT_RUNNER_FRESH_WORKTREE_GATE: 'false'},
			});
			expect(envWins.config.freshWorktreeGate).toBe(false);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({freshWorktreeGate: true}),
				env: {AGENT_RUNNER_FRESH_WORKTREE_GATE: 'false'},
				flags: doFlagOverrides({freshWorktreeGate: true}),
			});
			expect(flagWins.config.freshWorktreeGate).toBe(true);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('absent everywhere ⇒ the ON default', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'freshgate-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.freshWorktreeGate).toBe(true);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});
});

describe('loadConfig — freshWorktreeGate present with the ON default', () => {
	it('an absent config file still yields freshWorktreeGate true', () => {
		const dir = mkdtempSync(join(tmpdir(), 'freshgate-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.freshWorktreeGate).toBe(true);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

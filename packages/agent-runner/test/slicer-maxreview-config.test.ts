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
import {doFlagOverrides} from '../src/do-config.js';

/**
 * The slicer IMPROVER loop's `slicerLoopMax` config resolution
 * (`slicer-review-edit-loop`): it resolves per-repo through the SAME chain as
 * `integration`/`reviewMaxRounds` — flag > env > per-repo > global > cheap
 * default. Pure logic (no git). Distinct from Gate-2's `reviewMaxRounds` (which
 * lives on the gate); `slicerLoopMax` lives on the LOOP (the `--slicer-loop*`
 * family, never sharing a name with the gate's `--review*`).
 */

describe('slicerLoopMax — default + carry-through', () => {
	it('defaults to a cheap 3', () => {
		expect(DEFAULT_CONFIG.slicerLoopMax).toBe(3);
		expect(mergeConfig({}).slicerLoopMax).toBe(3);
	});

	it('carries through mergeConfig when set', () => {
		expect(mergeConfig({slicerLoopMax: 7}).slicerLoopMax).toBe(7);
	});
});

describe('slicerLoopMax — env coercion (typed, loud)', () => {
	it('coerces AGENT_RUNNER_SLICER_LOOP_MAX as a number', () => {
		expect(
			envOverrides({AGENT_RUNNER_SLICER_LOOP_MAX: '5'}).slicerLoopMax,
		).toBe(5);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('slicerLoopMax')).toBe('AGENT_RUNNER_SLICER_LOOP_MAX');
	});

	it('fails LOUDLY on a non-numeric value', () => {
		expect(() => envOverrides({AGENT_RUNNER_SLICER_LOOP_MAX: 'abc'})).toThrow(
			/AGENT_RUNNER_SLICER_LOOP_MAX/,
		);
	});
});

describe('slicerLoopMax — the full precedence chain (flag > env > per-repo > global > default)', () => {
	let repoDir: string;
	function writeRepoConfig(obj: Record<string, unknown>): void {
		writeFileSync(join(repoDir, REPO_CONFIG_FILENAME), JSON.stringify(obj));
	}

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('slicerLoopMax');
		repoDir = mkdtempSync(join(tmpdir(), 'slicerloopmax-repo-'));
		try {
			writeRepoConfig({slicerLoopMax: 4});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (4) beats the global/default (3).
			expect(resolved.config.slicerLoopMax).toBe(4);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('flag > env > per-repo > global', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'slicerloopmax-repo-'));
		try {
			writeRepoConfig({slicerLoopMax: 4});
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({slicerLoopMax: 2}),
				env: {AGENT_RUNNER_SLICER_LOOP_MAX: '6'},
			});
			expect(envWins.config.slicerLoopMax).toBe(6);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({slicerLoopMax: 2}),
				env: {AGENT_RUNNER_SLICER_LOOP_MAX: '6'},
				flags: doFlagOverrides({slicerLoopMax: '9'}),
			});
			expect(flagWins.config.slicerLoopMax).toBe(9);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('a repo with no file + no env resolves to the global/default', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'slicerloopmax-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.slicerLoopMax).toBe(3);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});
});

describe('slicerLoopMax — the --slicer-loop-max flag override', () => {
	it('parses a numeric flag', () => {
		expect(doFlagOverrides({slicerLoopMax: '8'}).slicerLoopMax).toBe(8);
	});

	it('drops a non-numeric flag (lower layer / default decides)', () => {
		expect(
			doFlagOverrides({slicerLoopMax: 'abc'}).slicerLoopMax,
		).toBeUndefined();
		expect(doFlagOverrides({slicerLoopMax: ''}).slicerLoopMax).toBeUndefined();
	});
});

describe('loadConfig — slicerLoopMax present with the cheap default', () => {
	it('an absent config file still yields slicerLoopMax 3', () => {
		const dir = mkdtempSync(join(tmpdir(), 'slicerloopmax-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.slicerLoopMax).toBe(3);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

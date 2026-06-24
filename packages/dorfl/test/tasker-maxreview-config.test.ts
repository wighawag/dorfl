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
 * The tasker IMPROVER loop's `taskerLoopMax` config resolution
 * (`slicer-review-edit-loop`): it resolves per-repo through the SAME chain as
 * `integration`/`reviewMaxRounds` — flag > env > per-repo > global > cheap
 * default. Pure logic (no git). Distinct from Gate-2's `reviewMaxRounds` (which
 * lives on the gate); `taskerLoopMax` lives on the LOOP (the `--tasker-loop*`
 * flag family, never sharing a name with the gate's `--review*`).
 */

describe('taskerLoopMax — default + carry-through', () => {
	it('defaults to a cheap 3', () => {
		expect(DEFAULT_CONFIG.taskerLoopMax).toBe(3);
		expect(mergeConfig({}).taskerLoopMax).toBe(3);
	});

	it('carries through mergeConfig when set', () => {
		expect(mergeConfig({taskerLoopMax: 7}).taskerLoopMax).toBe(7);
	});
});

describe('taskerLoopMax — env coercion (typed, loud)', () => {
	it('coerces DORFL_TASKER_LOOP_MAX as a number', () => {
		expect(envOverrides({DORFL_TASKER_LOOP_MAX: '5'}).taskerLoopMax).toBe(5);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('taskerLoopMax')).toBe('DORFL_TASKER_LOOP_MAX');
	});

	it('fails LOUDLY on a non-numeric value', () => {
		expect(() => envOverrides({DORFL_TASKER_LOOP_MAX: 'abc'})).toThrow(
			/DORFL_TASKER_LOOP_MAX/,
		);
	});
});

describe('taskerLoopMax — the full precedence chain (flag > env > per-repo > global > default)', () => {
	let repoDir: string;
	function writeRepoConfig(obj: Record<string, unknown>): void {
		writeFileSync(join(repoDir, REPO_CONFIG_FILENAME), JSON.stringify(obj));
	}

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('taskerLoopMax');
		repoDir = mkdtempSync(join(tmpdir(), 'taskerloopmax-repo-'));
		try {
			writeRepoConfig({taskerLoopMax: 4});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (4) beats the global/default (3).
			expect(resolved.config.taskerLoopMax).toBe(4);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('flag > env > per-repo > global', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'taskerloopmax-repo-'));
		try {
			writeRepoConfig({taskerLoopMax: 4});
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({taskerLoopMax: 2}),
				env: {DORFL_TASKER_LOOP_MAX: '6'},
			});
			expect(envWins.config.taskerLoopMax).toBe(6);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({taskerLoopMax: 2}),
				env: {DORFL_TASKER_LOOP_MAX: '6'},
				flags: doFlagOverrides({taskerLoopMax: '9'}),
			});
			expect(flagWins.config.taskerLoopMax).toBe(9);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('a repo with no file + no env resolves to the global/default', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'taskerloopmax-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.taskerLoopMax).toBe(3);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});
});

describe('taskerLoopMax — the --tasker-loop-max flag override (flag field bridges onto the taskerLoopMax config key)', () => {
	it('parses a numeric flag', () => {
		expect(doFlagOverrides({taskerLoopMax: '8'}).taskerLoopMax).toBe(8);
	});

	it('drops a non-numeric flag (lower layer / default decides)', () => {
		expect(
			doFlagOverrides({taskerLoopMax: 'abc'}).taskerLoopMax,
		).toBeUndefined();
		expect(doFlagOverrides({taskerLoopMax: ''}).taskerLoopMax).toBeUndefined();
	});
});

describe('loadConfig — taskerLoopMax present with the cheap default', () => {
	it('an absent config file still yields taskerLoopMax 3', () => {
		const dir = mkdtempSync(join(tmpdir(), 'taskerloopmax-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.taskerLoopMax).toBe(3);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

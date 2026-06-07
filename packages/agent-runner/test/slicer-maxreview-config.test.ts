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
 * The slicer review→edit→converge loop's `maxReview` config resolution
 * (`slicer-review-edit-loop`): it resolves per-repo through the SAME chain as
 * `integration`/`reviewMaxRounds` — flag > env > per-repo > global > cheap
 * default. Pure logic (no git). Distinct from Gate-2's `reviewMaxRounds` (which
 * lives on the gate); `maxReview` lives on the LOOP.
 */

describe('maxReview — default + carry-through', () => {
	it('defaults to a cheap 3', () => {
		expect(DEFAULT_CONFIG.maxReview).toBe(3);
		expect(mergeConfig({}).maxReview).toBe(3);
	});

	it('carries through mergeConfig when set', () => {
		expect(mergeConfig({maxReview: 7}).maxReview).toBe(7);
	});
});

describe('maxReview — env coercion (typed, loud)', () => {
	it('coerces AGENT_RUNNER_MAX_REVIEW as a number', () => {
		expect(envOverrides({AGENT_RUNNER_MAX_REVIEW: '5'}).maxReview).toBe(5);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('maxReview')).toBe('AGENT_RUNNER_MAX_REVIEW');
	});

	it('fails LOUDLY on a non-numeric value', () => {
		expect(() => envOverrides({AGENT_RUNNER_MAX_REVIEW: 'abc'})).toThrow(
			/AGENT_RUNNER_MAX_REVIEW/,
		);
	});
});

describe('maxReview — the full precedence chain (flag > env > per-repo > global > default)', () => {
	let repoDir: string;
	function writeRepoConfig(obj: Record<string, unknown>): void {
		writeFileSync(join(repoDir, REPO_CONFIG_FILENAME), JSON.stringify(obj));
	}

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('maxReview');
		repoDir = mkdtempSync(join(tmpdir(), 'maxreview-repo-'));
		try {
			writeRepoConfig({maxReview: 4});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (4) beats the global/default (3).
			expect(resolved.config.maxReview).toBe(4);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('flag > env > per-repo > global', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'maxreview-repo-'));
		try {
			writeRepoConfig({maxReview: 4});
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({maxReview: 2}),
				env: {AGENT_RUNNER_MAX_REVIEW: '6'},
			});
			expect(envWins.config.maxReview).toBe(6);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({maxReview: 2}),
				env: {AGENT_RUNNER_MAX_REVIEW: '6'},
				flags: doFlagOverrides({maxReview: '9'}),
			});
			expect(flagWins.config.maxReview).toBe(9);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('a repo with no file + no env resolves to the global/default', () => {
		repoDir = mkdtempSync(join(tmpdir(), 'maxreview-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.maxReview).toBe(3);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});
});

describe('maxReview — the --max-review flag override', () => {
	it('parses a numeric flag', () => {
		expect(doFlagOverrides({maxReview: '8'}).maxReview).toBe(8);
	});

	it('drops a non-numeric flag (lower layer / default decides)', () => {
		expect(doFlagOverrides({maxReview: 'abc'}).maxReview).toBeUndefined();
		expect(doFlagOverrides({maxReview: ''}).maxReview).toBeUndefined();
	});
});

describe('loadConfig — maxReview present with the cheap default', () => {
	it('an absent config file still yields maxReview 3', () => {
		const dir = mkdtempSync(join(tmpdir(), 'maxreview-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.maxReview).toBe(3);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

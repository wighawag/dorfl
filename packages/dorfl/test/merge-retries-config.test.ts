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
import {doFlagOverrides, mergeRetriesFlagOverrides} from '../src/do-config.js';

/**
 * `mergeRetries` config resolution (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, Story 5 + Applied Answer q1
 * part (a) — the git-alone FLOOR of the cross-job land queue): the
 * cross-job merge-serialiser CAS-retry cap is settable via flag, env, per-repo
 * file, and global, with the documented gate-family precedence; default
 * preserved (1000 — the C2 large liveness ceiling). The CAS loop IS the
 * cross-job queue, so raising the cap lets a wide-matrix CI's contenders
 * converge before any spurious bounce to needs-attention; safety is unchanged
 * (a lost CAS still costs only a re-rebase + re-gate retry, never a `--force`,
 * never a both-land-broken). House style mirrors
 * `fresh-worktree-gate-config.test.ts` (the closest sibling resolved through
 * the SAME chain): pure logic, no git.
 */

describe('mergeRetries — default + carry-through (matches integration-core fallback)', () => {
	it('defaults to 1000 (byte-for-byte today, when no source sets it)', () => {
		// 1000 matches `integration-core.ts`'s built-in `DEFAULT_MERGE_RETRIES`
		// fallback — the C2 large liveness ceiling, NOT a small Race-1 budget.
		expect(DEFAULT_CONFIG.mergeRetries).toBe(1000);
		expect(mergeConfig({}).mergeRetries).toBe(1000);
	});

	it('carries through mergeConfig when explicitly set', () => {
		expect(mergeConfig({mergeRetries: 25}).mergeRetries).toBe(25);
		// `0` is meaningful (the un-retried path the engine's tests pin) and must
		// survive the merge — undefined vs 0 differ semantically.
		expect(mergeConfig({mergeRetries: 0}).mergeRetries).toBe(0);
	});
});

describe('mergeRetries — env coercion (typed, loud)', () => {
	it('coerces DORFL_MERGE_RETRIES as a number', () => {
		expect(envOverrides({DORFL_MERGE_RETRIES: '25'}).mergeRetries).toBe(25);
		expect(envOverrides({DORFL_MERGE_RETRIES: '0'}).mergeRetries).toBe(0);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('mergeRetries')).toBe('DORFL_MERGE_RETRIES');
	});

	it('fails LOUDLY on a non-numeric value', () => {
		expect(() => envOverrides({DORFL_MERGE_RETRIES: 'never'})).toThrow(
			/DORFL_MERGE_RETRIES/,
		);
	});
});

describe('mergeRetries — the flag override (--merge-retries <n>)', () => {
	it('parses a present numeric flag; an absent flag ⇒ undefined', () => {
		expect(mergeRetriesFlagOverrides({mergeRetries: '25'}).mergeRetries).toBe(
			25,
		);
		expect(mergeRetriesFlagOverrides({mergeRetries: '0'}).mergeRetries).toBe(0);
		expect(mergeRetriesFlagOverrides({}).mergeRetries).toBeUndefined();
	});

	it('drops a non-integer / negative value so a lower layer / default decides', () => {
		// Mirrors `--review-max-rounds`'s parse-or-drop discipline: a typo at the
		// flag level falls through (never clobbers env/per-repo/default with a
		// silently-invalid value); 0 is valid, negative is not.
		expect(
			'mergeRetries' in mergeRetriesFlagOverrides({mergeRetries: 'never'}),
		).toBe(false);
		expect(
			'mergeRetries' in mergeRetriesFlagOverrides({mergeRetries: '-1'}),
		).toBe(false);
		expect(
			'mergeRetries' in mergeRetriesFlagOverrides({mergeRetries: '3.5'}),
		).toBe(false);
		expect(
			'mergeRetries' in mergeRetriesFlagOverrides({mergeRetries: ''}),
		).toBe(false);
	});

	it('is folded into doFlagOverrides (so `do`/`complete` resolve it on the same chain)', () => {
		expect(doFlagOverrides({mergeRetries: '25'}).mergeRetries).toBe(25);
		// Absent ⇒ no key (never clobbers a lower-precedence source with undefined).
		expect('mergeRetries' in doFlagOverrides({})).toBe(false);
	});
});

describe('mergeRetries — the full precedence chain (flag > env > per-repo > global > default)', () => {
	const writeRepoConfig = (repoDir: string, obj: Record<string, unknown>) => {
		writeFileSync(
			join(repoDir, REPO_CONFIG_FILENAME),
			JSON.stringify(obj, null, 2) + '\n',
		);
	};

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('mergeRetries');
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-retries-repo-'));
		try {
			writeRepoConfig(repoDir, {mergeRetries: 25});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (25) beats the global/default (1000).
			expect(resolved.config.mergeRetries).toBe(25);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('flag > env > per-repo > global', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-retries-repo-'));
		try {
			// per-repo beats global (the rung above default).
			writeRepoConfig(repoDir, {mergeRetries: 25});
			const perRepoWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeRetries: 5}),
				env: {},
			});
			expect(perRepoWins.config.mergeRetries).toBe(25);
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeRetries: 5}),
				env: {DORFL_MERGE_RETRIES: '42'},
			});
			expect(envWins.config.mergeRetries).toBe(42);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeRetries: 5}),
				env: {DORFL_MERGE_RETRIES: '42'},
				flags: doFlagOverrides({mergeRetries: '99'}),
			});
			expect(flagWins.config.mergeRetries).toBe(99);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});

	it('absent everywhere ⇒ the modest default (1000) is preserved', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-retries-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.mergeRetries).toBe(1000);
		} finally {
			rmSync(repoDir, {recursive: true, force: true});
		}
	});
});

describe('loadConfig — mergeRetries present with the modest default', () => {
	it('an absent config file still yields mergeRetries 1000', () => {
		const dir = mkdtempSync(join(tmpdir(), 'merge-retries-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.mergeRetries).toBe(1000);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

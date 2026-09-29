import {describe, it, expect} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig, loadConfig} from '../src/config.js';
import {
	REPO_ALLOWED_KEYS,
	REPO_CONFIG_FILENAME,
	resolveRepoConfig,
} from '../src/repo-config.js';
import {envOverrides, envVarName} from '../src/env-config.js';
import * as doConfig from '../src/do-config.js';

/**
 * `mergeQuestions` gate-axis precedence (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, Story 17 + task
 * `merge-questions-gate-axis`): the `off | ask` gate over the MERGE-QUESTION
 * SURFACER (`auto` and the `--merge-questions` flag were removed by task
 * `wire-merge-questions-into-the-advance-tick`, decision 3: unattended landing
 * is merge mode's job). A SEPARATE axis from `observationTriage` with a HIGHER
 * default (`ask`, never `off`: a dropped merge-question means pushed work
 * never lands). Resolved env > per-repo > global > default. House
 * style mirrors `merge-retries-config.test.ts` + `observation-triage-gate.test.ts`
 * — pure logic, no git.
 */

describe('mergeQuestions — default + carry-through (separate axis, higher default)', () => {
	it("defaults to 'ask' (NEVER 'off' by default — a dropped merge-question never lands)", () => {
		expect(DEFAULT_CONFIG.mergeQuestions).toBe('ask');
		expect(mergeConfig({}).mergeQuestions).toBe('ask');
	});

	it('does NOT alter observationTriage default or shape (separate axis)', () => {
		// The fixed PRD invariant: mergeQuestions must not ride observationTriage.
		expect(DEFAULT_CONFIG.observationTriage).toBe('off');
		// Setting one must NOT bleed into the other.
		const cfg = mergeConfig({mergeQuestions: 'off'});
		expect(cfg.mergeQuestions).toBe('off');
		expect(cfg.observationTriage).toBe('off');
		const cfg2 = mergeConfig({observationTriage: 'ask'});
		expect(cfg2.observationTriage).toBe('ask');
		// Default for the OTHER axis is preserved.
		expect(cfg2.mergeQuestions).toBe('ask');
	});

	it('carries through mergeConfig when explicitly set', () => {
		expect(mergeConfig({mergeQuestions: 'off'}).mergeQuestions).toBe('off');
		expect(mergeConfig({mergeQuestions: 'ask'}).mergeQuestions).toBe('ask');
	});
});

describe('mergeQuestions — env coercion (typed, loud)', () => {
	it('coerces DORFL_MERGE_QUESTIONS as the off|ask enum', () => {
		expect(envOverrides({DORFL_MERGE_QUESTIONS: 'off'}).mergeQuestions).toBe(
			'off',
		);
		expect(envOverrides({DORFL_MERGE_QUESTIONS: 'ask'}).mergeQuestions).toBe(
			'ask',
		);
	});

	it('refuses the retired `auto` LOUDLY (no silent fall-back)', () => {
		expect(() => envOverrides({DORFL_MERGE_QUESTIONS: 'auto'})).toThrow(
			/DORFL_MERGE_QUESTIONS/,
		);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('mergeQuestions')).toBe('DORFL_MERGE_QUESTIONS');
	});

	it('fails LOUDLY on a value outside the off|ask enum', () => {
		expect(() => envOverrides({DORFL_MERGE_QUESTIONS: 'sometimes'})).toThrow(
			/DORFL_MERGE_QUESTIONS/,
		);
		// The error names the valid options (the same loud-failure contract the
		// observationTriage env enum enforces).
		expect(() => envOverrides({DORFL_MERGE_QUESTIONS: 'sometimes'})).toThrow(
			/Expected one of: off, ask\./,
		);
	});
});

describe('mergeQuestions: there is NO CLI flag (removed with `auto`)', () => {
	it('do-config exports no --merge-questions override, and doFlagOverrides never sets the key', () => {
		expect('mergeQuestionsFlagOverrides' in doConfig).toBe(false);
		expect(
			'mergeQuestions' in
				doConfig.doFlagOverrides({mergeQuestions: 'off'} as never),
		).toBe(false);
	});
});

describe('mergeQuestions: the full precedence chain (env > per-repo > global > default)', () => {
	const writeRepoConfig = (repoDir: string, obj: Record<string, unknown>) => {
		writeFileSync(
			join(repoDir, REPO_CONFIG_FILENAME),
			JSON.stringify(obj, null, 2) + '\n',
		);
	};

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('mergeQuestions');
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-questions-repo-'));
		try {
			writeRepoConfig(repoDir, {mergeQuestions: 'off'});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (off) beats the global/default (ask).
			expect(resolved.config.mergeQuestions).toBe('off');
		} finally {
			rmrf(repoDir);
		}
	});

	it('env > per-repo > global', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-questions-repo-'));
		try {
			// per-repo beats global (the rung above default).
			writeRepoConfig(repoDir, {mergeQuestions: 'ask'});
			const perRepoWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeQuestions: 'off'}),
				env: {},
			});
			expect(perRepoWins.config.mergeQuestions).toBe('ask');
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeQuestions: 'ask'}),
				env: {DORFL_MERGE_QUESTIONS: 'off'},
			});
			expect(envWins.config.mergeQuestions).toBe('off');
		} finally {
			rmrf(repoDir);
		}
	});

	it("absent everywhere ⇒ the conservative default ('ask') is preserved", () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-questions-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.mergeQuestions).toBe('ask');
		} finally {
			rmrf(repoDir);
		}
	});

	it('a per-repo mergeQuestions does NOT bleed into observationTriage (separate axes)', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-questions-repo-'));
		try {
			writeRepoConfig(repoDir, {mergeQuestions: 'off'});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.mergeQuestions).toBe('off');
			// observationTriage stays at its own default — the two axes are independent.
			expect(resolved.config.observationTriage).toBe('off');
		} finally {
			rmrf(repoDir);
		}
	});
});

describe("loadConfig — mergeQuestions present with the conservative default 'ask'", () => {
	it("an absent config file still yields mergeQuestions 'ask'", () => {
		const dir = mkdtempSync(join(tmpdir(), 'merge-questions-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.mergeQuestions).toBe('ask');
		} finally {
			rmrf(dir);
		}
	});
});

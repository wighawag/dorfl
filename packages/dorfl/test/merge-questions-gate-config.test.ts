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
import {
	doFlagOverrides,
	mergeQuestionsFlagOverrides,
} from '../src/do-config.js';

/**
 * `mergeQuestions` gate-axis precedence (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, Story 17 + task
 * `merge-questions-gate-axis`): the 3-state `off | ask | auto` gate over the
 * MERGE-QUESTION SURFACER. MIRRORS `observationTriage`'s SHAPE but is a
 * SEPARATE axis with a HIGHER default (`ask`, never `off` — a dropped merge-
 * question means pushed work never lands). Resolved through the SAME gate-
 * family precedence chain (flag > env > per-repo > global > default). House
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
		const cfg = mergeConfig({mergeQuestions: 'auto'});
		expect(cfg.mergeQuestions).toBe('auto');
		expect(cfg.observationTriage).toBe('off');
		const cfg2 = mergeConfig({observationTriage: 'ask'});
		expect(cfg2.observationTriage).toBe('ask');
		// Default for the OTHER axis is preserved.
		expect(cfg2.mergeQuestions).toBe('ask');
	});

	it('carries through mergeConfig when explicitly set', () => {
		expect(mergeConfig({mergeQuestions: 'off'}).mergeQuestions).toBe('off');
		expect(mergeConfig({mergeQuestions: 'ask'}).mergeQuestions).toBe('ask');
		expect(mergeConfig({mergeQuestions: 'auto'}).mergeQuestions).toBe('auto');
	});
});

describe('mergeQuestions — env coercion (typed, loud)', () => {
	it('coerces DORFL_MERGE_QUESTIONS as the off|ask|auto enum', () => {
		expect(envOverrides({DORFL_MERGE_QUESTIONS: 'off'}).mergeQuestions).toBe(
			'off',
		);
		expect(envOverrides({DORFL_MERGE_QUESTIONS: 'ask'}).mergeQuestions).toBe(
			'ask',
		);
		expect(envOverrides({DORFL_MERGE_QUESTIONS: 'auto'}).mergeQuestions).toBe(
			'auto',
		);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('mergeQuestions')).toBe('DORFL_MERGE_QUESTIONS');
	});

	it('fails LOUDLY on a value outside the off|ask|auto enum', () => {
		expect(() => envOverrides({DORFL_MERGE_QUESTIONS: 'sometimes'})).toThrow(
			/DORFL_MERGE_QUESTIONS/,
		);
		// The error names the valid options (the same loud-failure contract the
		// observationTriage env enum enforces).
		expect(() => envOverrides({DORFL_MERGE_QUESTIONS: 'sometimes'})).toThrow(
			/off, ask, auto/,
		);
	});
});

describe('mergeQuestions — the flag override (--merge-questions <off|ask|auto>)', () => {
	it('parses a present enum value; an absent flag ⇒ undefined', () => {
		expect(
			mergeQuestionsFlagOverrides({mergeQuestions: 'off'}).mergeQuestions,
		).toBe('off');
		expect(
			mergeQuestionsFlagOverrides({mergeQuestions: 'ask'}).mergeQuestions,
		).toBe('ask');
		expect(
			mergeQuestionsFlagOverrides({mergeQuestions: 'auto'}).mergeQuestions,
		).toBe('auto');
		expect(mergeQuestionsFlagOverrides({}).mergeQuestions).toBeUndefined();
	});

	it('FAILS LOUDLY on an out-of-enum value (matches --observation-triage)', () => {
		// A typo on a gate is a usage error, NEVER silently dropped — same
		// loud-failure contract `--observation-triage` enforces.
		expect(() =>
			mergeQuestionsFlagOverrides({mergeQuestions: 'sometimes'}),
		).toThrow(/--merge-questions/);
		expect(() =>
			mergeQuestionsFlagOverrides({mergeQuestions: 'sometimes'}),
		).toThrow(/off, ask, auto/);
	});

	it('is folded into doFlagOverrides (so `do`/`advance` resolve it on the same chain)', () => {
		expect(doFlagOverrides({mergeQuestions: 'auto'}).mergeQuestions).toBe(
			'auto',
		);
		// Absent ⇒ no key (never clobbers a lower-precedence source with undefined).
		expect('mergeQuestions' in doFlagOverrides({})).toBe(false);
	});
});

describe('mergeQuestions — the full precedence chain (flag > env > per-repo > global > default)', () => {
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
			writeRepoConfig(repoDir, {mergeQuestions: 'auto'});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (auto) beats the global/default (ask).
			expect(resolved.config.mergeQuestions).toBe('auto');
		} finally {
			rmrf(repoDir);
		}
	});

	it('flag > env > per-repo > global', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'merge-questions-repo-'));
		try {
			// per-repo beats global (the rung above default).
			writeRepoConfig(repoDir, {mergeQuestions: 'auto'});
			const perRepoWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeQuestions: 'off'}),
				env: {},
			});
			expect(perRepoWins.config.mergeQuestions).toBe('auto');
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeQuestions: 'off'}),
				env: {DORFL_MERGE_QUESTIONS: 'ask'},
			});
			expect(envWins.config.mergeQuestions).toBe('ask');
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({mergeQuestions: 'off'}),
				env: {DORFL_MERGE_QUESTIONS: 'ask'},
				flags: doFlagOverrides({mergeQuestions: 'auto'}),
			});
			expect(flagWins.config.mergeQuestions).toBe('auto');
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

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
	strictMergeApprovalFlagOverrides,
} from '../src/do-config.js';

/**
 * `strictMergeApproval` gate-axis precedence (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, sidecar OQ6 + Story 16 /
 * task `strict-merge-approval-gate`): a BOOLEAN axis controlling the OPT-IN
 * strictness layered on the OQ6 stale-approval default. Default OFF \u2014 the
 * cheap "honour the prior merge-answer when the rebased tip re-verifies
 * GREEN" path. ON re-surfaces the merge-question on a merge-base change
 * instead of auto-landing on a green re-verify (the host-agnostic analogue of
 * GitHub's "dismiss stale approvals when the base changes"). Resolved through
 * the SAME gate-family precedence chain (flag > env > per-repo > global >
 * default). House style mirrors `fresh-worktree-gate-config.test.ts` (a
 * boolean axis through the SAME chain) + `merge-questions-gate-config.test.ts`
 * (the SEPARATE, independent axis check) \u2014 pure logic, no git. Tests isolate
 * global locations via mkdtemp + injected `env`.
 */

describe('strictMergeApproval \u2014 default + carry-through (positive, default-OFF)', () => {
	it('defaults to false (the cheap green-re-verify-is-enough path; matches PRD sidecar OQ6)', () => {
		expect(DEFAULT_CONFIG.strictMergeApproval).toBe(false);
		expect(mergeConfig({}).strictMergeApproval).toBe(false);
	});

	it('carries through mergeConfig when set true', () => {
		expect(mergeConfig({strictMergeApproval: true}).strictMergeApproval).toBe(
			true,
		);
	});

	it('does NOT alter mergeQuestions or observationTriage default or shape (separate, independent axis)', () => {
		// The fixed sidecar invariant: strictMergeApproval must NOT bleed into
		// the question-surfacing gates \u2014 it is a peer, not a mode of theirs.
		expect(DEFAULT_CONFIG.mergeQuestions).toBe('ask');
		expect(DEFAULT_CONFIG.observationTriage).toBe('off');
		const cfg = mergeConfig({strictMergeApproval: true});
		expect(cfg.strictMergeApproval).toBe(true);
		expect(cfg.mergeQuestions).toBe('ask');
		expect(cfg.observationTriage).toBe('off');
		// And the reverse: setting `mergeQuestions` must not flip `strictMergeApproval`.
		const cfg2 = mergeConfig({mergeQuestions: 'auto'});
		expect(cfg2.strictMergeApproval).toBe(false);
	});
});

describe('strictMergeApproval \u2014 env coercion (typed, loud)', () => {
	it('coerces DORFL_STRICT_MERGE_APPROVAL as a boolean', () => {
		expect(
			envOverrides({DORFL_STRICT_MERGE_APPROVAL: 'true'}).strictMergeApproval,
		).toBe(true);
		expect(
			envOverrides({DORFL_STRICT_MERGE_APPROVAL: 'false'}).strictMergeApproval,
		).toBe(false);
	});

	it('names the env var by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('strictMergeApproval')).toBe(
			'DORFL_STRICT_MERGE_APPROVAL',
		);
	});

	it('fails LOUDLY on a non-boolean value', () => {
		expect(() =>
			envOverrides({DORFL_STRICT_MERGE_APPROVAL: 'sometimes'}),
		).toThrow(/DORFL_STRICT_MERGE_APPROVAL/);
	});
});

describe('strictMergeApproval \u2014 the flag override (--strict-merge-approval / --no-)', () => {
	it('a present positive flag \u21d2 true; a present negation \u21d2 false; absent \u21d2 undefined', () => {
		expect(
			strictMergeApprovalFlagOverrides({strictMergeApproval: true})
				.strictMergeApproval,
		).toBe(true);
		expect(
			strictMergeApprovalFlagOverrides({strictMergeApproval: false})
				.strictMergeApproval,
		).toBe(false);
		expect(
			strictMergeApprovalFlagOverrides({}).strictMergeApproval,
		).toBeUndefined();
	});

	it('is folded into doFlagOverrides (so `do`/`advance` resolve it on the same chain)', () => {
		expect(
			doFlagOverrides({strictMergeApproval: true}).strictMergeApproval,
		).toBe(true);
		// Absent \u21d2 no key (never clobbers a lower-precedence source with undefined).
		expect('strictMergeApproval' in doFlagOverrides({})).toBe(false);
	});
});

describe('strictMergeApproval \u2014 the full precedence chain (flag > env > per-repo > global > default)', () => {
	const writeRepoConfig = (repoDir: string, obj: Record<string, unknown>) => {
		writeFileSync(
			join(repoDir, REPO_CONFIG_FILENAME),
			JSON.stringify(obj, null, 2) + '\n',
		);
	};

	it('is repo-appropriate (honoured in a committed per-repo file)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('strictMergeApproval');
		const repoDir = mkdtempSync(join(tmpdir(), 'strict-merge-approval-repo-'));
		try {
			writeRepoConfig(repoDir, {strictMergeApproval: true});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			// per-repo (true) beats the global/default (false).
			expect(resolved.config.strictMergeApproval).toBe(true);
		} finally {
			rmrf(repoDir);
		}
	});

	it('flag > env > per-repo > global', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'strict-merge-approval-repo-'));
		try {
			// per-repo beats global (the rung above default).
			writeRepoConfig(repoDir, {strictMergeApproval: true});
			const perRepoWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({strictMergeApproval: false}),
				env: {},
			});
			expect(perRepoWins.config.strictMergeApproval).toBe(true);
			// env beats per-repo.
			const envWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({strictMergeApproval: false}),
				env: {DORFL_STRICT_MERGE_APPROVAL: 'false'},
			});
			expect(envWins.config.strictMergeApproval).toBe(false);
			// flag beats env + per-repo + global.
			const flagWins = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({strictMergeApproval: false}),
				env: {DORFL_STRICT_MERGE_APPROVAL: 'false'},
				flags: doFlagOverrides({strictMergeApproval: true}),
			});
			expect(flagWins.config.strictMergeApproval).toBe(true);
		} finally {
			rmrf(repoDir);
		}
	});

	it('absent everywhere \u21d2 the OFF default (matches PRD sidecar OQ6)', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'strict-merge-approval-repo-'));
		try {
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.strictMergeApproval).toBe(false);
		} finally {
			rmrf(repoDir);
		}
	});

	it('a per-repo strictMergeApproval does NOT bleed into mergeQuestions/observationTriage (separate axes)', () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'strict-merge-approval-repo-'));
		try {
			writeRepoConfig(repoDir, {strictMergeApproval: true});
			const resolved = resolveRepoConfig({
				repoPath: repoDir,
				global: mergeConfig({}),
				env: {},
			});
			expect(resolved.config.strictMergeApproval).toBe(true);
			// Sibling gate defaults preserved \u2014 the three axes are independent.
			expect(resolved.config.mergeQuestions).toBe('ask');
			expect(resolved.config.observationTriage).toBe('off');
		} finally {
			rmrf(repoDir);
		}
	});
});

describe('loadConfig \u2014 strictMergeApproval present with the OFF default', () => {
	it('an absent config file still yields strictMergeApproval false', () => {
		const dir = mkdtempSync(join(tmpdir(), 'strict-merge-approval-cfg-'));
		try {
			const cfg = loadConfig(join(dir, 'does-not-exist.json'));
			expect(cfg.strictMergeApproval).toBe(false);
		} finally {
			rmrf(dir);
		}
	});
});

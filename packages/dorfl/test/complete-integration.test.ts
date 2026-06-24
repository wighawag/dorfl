import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {integrationFromFlags} from '../src/complete.js';
import {mergeConfig, DEFAULT_CONFIG} from '../src/config.js';
import {resolveRepoConfig, REPO_CONFIG_FILENAME} from '../src/repo-config.js';

/**
 * The integration mode `complete` resolves AT COMPLETION TIME, highest first:
 *
 *   --merge/--propose flag > per-repo .dorfl.json > global > default
 *
 * The flag layer is mapped by {@link integrationFromFlags} (mutually exclusive);
 * the rest is the shared {@link resolveRepoConfig} chain the autonomous runner
 * uses too (config-only: per-repo > global > default), so both paths agree.
 */

describe('complete-time integration — flag mapping (--merge/--propose)', () => {
	it('--merge maps to merge', () => {
		expect(integrationFromFlags({merge: true})).toBe('merge');
	});

	it('--propose maps to propose', () => {
		expect(integrationFromFlags({propose: true})).toBe('propose');
	});

	it('neither flag ⇒ undefined (config/default then decides)', () => {
		expect(integrationFromFlags({})).toBeUndefined();
	});

	it('--merge and --propose together is a mutually-exclusive error', () => {
		expect(() => integrationFromFlags({merge: true, propose: true})).toThrow(
			/mutually exclusive/i,
		);
	});
});

describe('complete-time integration — precedence (flag > per-repo > global > default)', () => {
	let repo: string;
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-complete-int-'));
		repo = join(root, 'repo');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	function writeRepoConfig(obj: Record<string, unknown>): void {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), JSON.stringify(obj));
	}

	/** Mirror the CLI's complete-time resolution: flag → resolveRepoConfig. */
	function resolveCompleteIntegration(opts: {
		flag?: 'merge' | 'propose';
		perRepo?: 'merge' | 'propose';
		global?: 'merge' | 'propose';
	}): 'merge' | 'propose' {
		if (opts.perRepo) {
			writeRepoConfig({integration: opts.perRepo});
		}
		const flagMode = integrationFromFlags({
			merge: opts.flag === 'merge',
			propose: opts.flag === 'propose',
		});
		const global = mergeConfig(opts.global ? {integration: opts.global} : {});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			flags: flagMode ? {integration: flagMode} : {},
		});
		return resolved.config.integration;
	}

	it('level 1 — the flag wins over per-repo, global, and default', () => {
		expect(
			resolveCompleteIntegration({
				flag: 'merge',
				perRepo: 'propose',
				global: 'propose',
			}),
		).toBe('merge');
		expect(
			resolveCompleteIntegration({
				flag: 'propose',
				perRepo: 'merge',
				global: 'merge',
			}),
		).toBe('propose');
	});

	it('level 2 — per-repo wins over global (and default) when no flag', () => {
		expect(
			resolveCompleteIntegration({perRepo: 'merge', global: 'propose'}),
		).toBe('merge');
	});

	it('level 3 — global wins over default when no flag and no per-repo', () => {
		expect(resolveCompleteIntegration({global: 'merge'})).toBe('merge');
	});

	it('level 4 — falls back to the built-in default (propose) with nothing set', () => {
		expect(resolveCompleteIntegration({})).toBe(DEFAULT_CONFIG.integration);
		expect(resolveCompleteIntegration({})).toBe('propose');
	});
});

describe('complete-time integration — autonomous path is config-only (no flag)', () => {
	let repo: string;
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-auto-int-'));
		repo = join(root, 'repo');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	function writeRepoConfig(obj: Record<string, unknown>): void {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), JSON.stringify(obj));
	}

	/** The autonomous runner resolves with NO flags layer (run.ts). */
	function resolveAutonomousIntegration(global: 'merge' | 'propose'): {
		integration: 'merge' | 'propose';
	} {
		return {
			integration: resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({integration: global}),
			}).config.integration,
		};
	}

	it('per-repo override beats global (same per-repo > global > default order)', () => {
		writeRepoConfig({integration: 'merge'});
		expect(resolveAutonomousIntegration('propose').integration).toBe('merge');
	});

	it('falls back to global when there is no per-repo file', () => {
		expect(resolveAutonomousIntegration('merge').integration).toBe('merge');
	});

	it('falls back to the built-in default with neither per-repo nor explicit global', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect(resolved.config.integration).toBe(DEFAULT_CONFIG.integration);
	});
});

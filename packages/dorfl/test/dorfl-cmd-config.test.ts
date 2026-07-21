import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	DEFAULT_CONFIG,
	mergeConfig,
	validateDorflCmdConfig,
	type Config,
} from '../src/config.js';
import {
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	REPO_CONFIG_FILENAME,
	loadRepoConfig,
	resolveRepoConfig,
} from '../src/repo-config.js';
import {rmrf} from './helpers/gitRepo.js';

/**
 * The `dorfl-cmd-config-field` task (spec
 * `dorfl-self-version-pinning-and-bootstrap-forward` §1/§3; ADR
 * `dorfl-cmd-repo-settable-exception-to-host-only`): `dorflCmd` is an optional
 * per-repo command string naming the dorfl a repo runs with. This task adds ONLY
 * the field + parse + validate + expose; the FORWARD task owns exec/announce.
 * These tests cover (1) the optional field (unset is meaningful), (2) trim +
 * empty⇒unset + non-string⇒fail-loud normalisation, (3) its per-repo resolution
 * chain (flag > env > per-repo > global > default), and (4) that it is
 * repo-ALLOWED (the deliberate exception) while `agentCmd`/`piBin`/`sessionsDir`
 * stay host-only REJECTED (no regression).
 */

describe('config.dorflCmd — optional, no default (unset is meaningful)', () => {
	it('is undefined by default (the bootstrap runs itself)', () => {
		expect(DEFAULT_CONFIG.dorflCmd).toBeUndefined();
		expect(mergeConfig({}).dorflCmd).toBeUndefined();
	});

	it('is carried verbatim through mergeConfig when set', () => {
		expect(mergeConfig({dorflCmd: 'npx dorfl@0.7.0'}).dorflCmd).toBe(
			'npx dorfl@0.7.0',
		);
	});
});

describe('validateDorflCmdConfig — trim / empty⇒unset / non-string⇒fail-loud', () => {
	it('leaves an unset value unset (no error)', () => {
		const cfg = mergeConfig({});
		expect(() => validateDorflCmdConfig(cfg)).not.toThrow();
		expect(cfg.dorflCmd).toBeUndefined();
	});

	it('trims leading/trailing whitespace, carrying the command verbatim otherwise', () => {
		const cfg = mergeConfig({dorflCmd: '  node_modules/.bin/dorfl  '});
		validateDorflCmdConfig(cfg);
		expect(cfg.dorflCmd).toBe('node_modules/.bin/dorfl');
	});

	it('does NOT shell-split or normalise the interior (the forward task owns exec)', () => {
		const cfg = mergeConfig({dorflCmd: 'mise exec dorfl@0.7.0 --'});
		validateDorflCmdConfig(cfg);
		// interior spaces + args are preserved exactly.
		expect(cfg.dorflCmd).toBe('mise exec dorfl@0.7.0 --');
	});

	it('resolves an empty string to UNSET (never an error)', () => {
		const cfg = mergeConfig({dorflCmd: ''});
		expect(() => validateDorflCmdConfig(cfg)).not.toThrow();
		expect(cfg.dorflCmd).toBeUndefined();
	});

	it('resolves a whitespace-only string to UNSET (never an error)', () => {
		const cfg = mergeConfig({dorflCmd: '   \t  '});
		expect(() => validateDorflCmdConfig(cfg)).not.toThrow();
		expect(cfg.dorflCmd).toBeUndefined();
	});

	it('FAILS LOUD (naming the field) on a non-string value — never a crash', () => {
		for (const bad of [42, ['npx', 'dorfl'], {cmd: 'dorfl'}, true, null]) {
			const cfg = {...mergeConfig({}), dorflCmd: bad} as unknown as Config;
			expect(() => validateDorflCmdConfig(cfg)).toThrow(
				/dorflCmd must be a string/,
			);
		}
	});
});

describe('repo-config — dorflCmd is repo-ALLOWED (the deliberate exception)', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-cmd-'));
	});
	afterEach(() => {
		rmrf(repo);
	});

	function writeRepoConfig(value: unknown): void {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), JSON.stringify(value));
	}

	it('lists `dorflCmd` in REPO_ALLOWED_KEYS (where verify/prepare live)', () => {
		expect(REPO_ALLOWED_KEYS).toContain('dorflCmd');
		expect(REPO_REJECTED_KEYS).not.toContain('dorflCmd');
	});

	it('keeps the host-only machine-command keys REJECTED (no regression)', () => {
		// The reject list this exception does NOT touch: a per-repo file still may
		// not redirect where the HOST runs its harness / writes sessions.
		for (const key of ['agentCmd', 'piBin', 'sessionsDir']) {
			expect(REPO_REJECTED_KEYS).toContain(key);
			expect(REPO_ALLOWED_KEYS).not.toContain(key);
		}
	});

	it('honours a per-repo dorflCmd while agentCmd/piBin/sessionsDir are rejected + reported', () => {
		writeRepoConfig({
			dorflCmd: 'node_modules/.bin/dorfl',
			agentCmd: 'leaked-agent',
			piBin: '/leaked/pi',
			sessionsDir: '/leaked/sessions',
		});
		const loaded = loadRepoConfig(repo);
		// dorflCmd SURVIVES resolution.
		expect(loaded.config.dorflCmd).toBe('node_modules/.bin/dorfl');
		// the host-only machine-command keys do NOT.
		expect(loaded.config).not.toHaveProperty('agentCmd');
		expect(loaded.config).not.toHaveProperty('piBin');
		expect(loaded.config).not.toHaveProperty('sessionsDir');
		expect(loaded.rejected).toContain('agentCmd');
		expect(loaded.rejected).toContain('piBin');
		expect(loaded.rejected).toContain('sessionsDir');
		// dorflCmd is NOT in the rejected set.
		expect(loaded.rejected).not.toContain('dorflCmd');
	});

	it('trims a per-repo dorflCmd and resolves an empty one to unset via resolution', () => {
		writeRepoConfig({dorflCmd: '  ./bin/dorfl  '});
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.dorflCmd,
		).toBe('./bin/dorfl');

		writeRepoConfig({dorflCmd: '   '});
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.dorflCmd,
		).toBeUndefined();
	});

	it('a non-string per-repo dorflCmd FAILS LOUD at resolution (naming the field)', () => {
		writeRepoConfig({dorflCmd: 123});
		expect(() =>
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}}),
		).toThrow(/dorflCmd must be a string/);
	});

	it('resolves dorflCmd: flag > env > per-repo > global > default (unset)', () => {
		// default: unset
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.dorflCmd,
		).toBeUndefined();

		// global only
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({dorflCmd: 'npx dorfl@global'}),
				env: {},
			}).config.dorflCmd,
		).toBe('npx dorfl@global');

		// per-repo beats global
		writeRepoConfig({dorflCmd: 'npx dorfl@repo'});
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({dorflCmd: 'npx dorfl@global'}),
				env: {},
			}).config.dorflCmd,
		).toBe('npx dorfl@repo');

		// env (DORFL_DORFL_CMD) beats per-repo + global
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({dorflCmd: 'npx dorfl@global'}),
				env: {DORFL_DORFL_CMD: 'npx dorfl@env'},
			}).config.dorflCmd,
		).toBe('npx dorfl@env');

		// flag beats everything
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({dorflCmd: 'npx dorfl@global'}),
				env: {DORFL_DORFL_CMD: 'npx dorfl@env'},
				flags: {dorflCmd: 'npx dorfl@flag'},
			}).config.dorflCmd,
		).toBe('npx dorfl@flag');
	});

	it('isolates every fixture under a scratch dir (no shared location written)', () => {
		// The fixture path is a fresh mkdtemp under the OS tmpdir, distinct per run.
		expect(repo.startsWith(tmpdir())).toBe(true);
	});
});

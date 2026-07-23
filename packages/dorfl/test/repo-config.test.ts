import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig} from '../src/config.js';
import {
	REPO_CONFIG_FILENAME,
	REPO_CONFIG_FILENAME_LEGACY,
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	repoConfigPath,
	loadRepoConfig,
	resolveRepoConfig,
} from '../src/repo-config.js';

/** Write a `dorfl.json` (the preferred name) at the root of a throwaway repo dir. */
function writeRepoConfig(repoPath: string, value: unknown): void {
	writeFileSync(join(repoPath, REPO_CONFIG_FILENAME), JSON.stringify(value));
}

describe('per-repo config filename: `dorfl.json` preferred, `.dorfl.json` legacy', () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-repo-filename-'));
	});
	afterEach(() => rmrf(repo));

	it('reads the preferred `dorfl.json`', () => {
		writeFileSync(
			join(repo, 'dorfl.json'),
			JSON.stringify({integration: 'merge'}),
		);
		expect(repoConfigPath(repo)).toBe(join(repo, 'dorfl.json'));
		expect(loadRepoConfig(repo).config.integration).toBe('merge');
	});

	it('falls back to the legacy `.dorfl.json` when only that exists', () => {
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({integration: 'merge'}),
		);
		expect(repoConfigPath(repo)).toBe(join(repo, '.dorfl.json'));
		expect(loadRepoConfig(repo).config.integration).toBe('merge');
	});

	it('prefers `dorfl.json` when BOTH exist (no merge)', () => {
		writeFileSync(
			join(repo, 'dorfl.json'),
			JSON.stringify({integration: 'merge'}),
		);
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({integration: 'propose'}),
		);
		expect(repoConfigPath(repo)).toBe(join(repo, 'dorfl.json'));
		expect(loadRepoConfig(repo).config.integration).toBe('merge');
	});

	it('resolves to the preferred path (for a future write) when NEITHER exists', () => {
		expect(repoConfigPath(repo)).toBe(join(repo, 'dorfl.json'));
		expect(loadRepoConfig(repo).config).toEqual({});
	});
});

describe('repo-config constants', () => {
	it('names the per-repo file `dorfl.json` (preferred) with `.dorfl.json` legacy fallback', () => {
		expect(REPO_CONFIG_FILENAME).toBe('dorfl.json');
		expect(REPO_CONFIG_FILENAME_LEGACY).toBe('.dorfl.json');
	});

	it('treats integration, verify, defaultArbiter, autoBuild as repo-appropriate keys', () => {
		expect(REPO_ALLOWED_KEYS).toContain('integration');
		expect(REPO_ALLOWED_KEYS).toContain('verify');
		expect(REPO_ALLOWED_KEYS).toContain('defaultArbiter');
		expect(REPO_ALLOWED_KEYS).toContain('autoBuild');
		// `autoTask` is the tasking-autonomy mirror of `autoBuild` — a genuine
		// repo property, resolved per-repo through the same chain.
		expect(REPO_ALLOWED_KEYS).toContain('autoTask');
		// `observationTriage` (the 3-state `off|ask|auto` gate over the observation
		// INBOX) is the observation-side question-surfacing gate (ADR `ci-config-
		// policy-and-gate-family`), resolved per-repo through the same chain. It
		// REPLACES the old `autoTriage` boolean (no alias).
		expect(REPO_ALLOWED_KEYS).toContain('observationTriage');
		// `surfaceBlockers` (the boolean gate over DECLARED blocked work) is the
		// orthogonal peer of `observationTriage` — a genuine repo property resolved
		// per-repo through the same chain (ADR `ci-config-policy-and-gate-family`).
		expect(REPO_ALLOWED_KEYS).toContain('surfaceBlockers');
		// `selectionOrder` (the configurable cross-pool order; subsumes the removed
		// `prdsFirst`) is a per-repo property resolved through the same chain.
		expect(REPO_ALLOWED_KEYS).toContain('selectionOrder');
		// `prepare` (the env-prep / install step) is a per-repo property like `verify`,
		// resolved through the SAME chain. Install belongs here, never baked into verify.
		expect(REPO_ALLOWED_KEYS).toContain('prepare');
		// `noPR` (the PR-INTENT axis) is a per-repo property like `integration`/`review`.
		// The removed `provider` OVERRIDE is NOT allowed (it is gone entirely).
		expect(REPO_ALLOWED_KEYS).toContain('noPR');
		expect(REPO_ALLOWED_KEYS).not.toContain('provider');
		// `taskingIntegration` (the per-TRANSITION TASKING override) is a genuine repo
		// property like `integration`: whether THIS repo tasks a PRD straight onto main
		// while still building each task as a PR is agreed by all collaborators + travels
		// with the repo. (`per-transition-integration-mode-slicing-vs-build`.)
		expect(REPO_ALLOWED_KEYS).toContain('taskingIntegration');
		// `intakeIntegration` (the per-TRANSITION INTAKE-DOCUMENT override, twin of
		// `taskingIntegration`) is a genuine repo property like `integration`: whether
		// THIS repo's intake front door emits a task/spec DOCUMENT straight onto main
		// or as a PR is agreed by all collaborators + travels with the repo (spec
		// `intake-integration-knob-and-specs-land-in-proposed-rename`).
		expect(REPO_ALLOWED_KEYS).toContain('intakeIntegration');
		// `promptGuidance` (the NUDGE namespace — prompt-text knobs, NOT a gate) is a
		// genuine repo property: "is this repo nudged toward test-first?" travels with
		// the repo and is agreed by all collaborators. Resolved per-repo through the
		// same chain as `autoBuild`. CATEGORICALLY SEPARATE from the gate family.
		expect(REPO_ALLOWED_KEYS).toContain('promptGuidance');
	});

	it('treats runner/host-only keys as rejected in a per-repo file', () => {
		expect(REPO_REJECTED_KEYS).toContain('piBin');
		expect(REPO_REJECTED_KEYS).toContain('maxParallel');
		expect(REPO_REJECTED_KEYS).toContain('humanWorktreesDir');
		// `sessionsDir` is a HOST-ONLY machine path (where session logs are written),
		// rejected per-repo exactly like `piBin` (a committed file must not redirect it).
		expect(REPO_REJECTED_KEYS).toContain('sessionsDir');
		// `identity` carries SECRETS (a token, an SSH key path) and is a per-machine
		// concept (a bot's credentials), so a committed repo file must NOT supply it.
		expect(REPO_REJECTED_KEYS).toContain('identity');
	});

	it('keeps allowed and rejected key sets disjoint', () => {
		for (const key of REPO_ALLOWED_KEYS) {
			expect(REPO_REJECTED_KEYS).not.toContain(key);
		}
	});
});

describe('per-repo noPR + the deprecated `provider` key', () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-repo-nopr-'));
	});
	afterEach(() => {
		rmrf(repo);
	});

	it('honours a per-repo `noPR` boolean', () => {
		writeRepoConfig(repo, {noPR: true});
		expect(loadRepoConfig(repo).config.noPR).toBe(true);
	});

	it('IGNORES a stale per-repo `provider` key with a deprecation warning (never errors)', () => {
		writeRepoConfig(repo, {provider: 'github', integration: 'merge'});
		const warnings: string[] = [];
		const origErr = console.error;
		console.error = (m?: unknown) => warnings.push(String(m ?? ''));
		let loaded;
		try {
			loaded = loadRepoConfig(repo); // must NOT throw
		} finally {
			console.error = origErr;
		}
		// The rest of the per-repo config still loads; the stale key is not carried
		// (and is NOT mistaken for a rejected host-only key).
		expect(loaded.config.integration).toBe('merge');
		expect('provider' in loaded.config).toBe(false);
		expect(loaded.rejected).not.toContain('provider');
		expect(warnings.some((w) => /deprecated key 'provider'/.test(w))).toBe(
			true,
		);
	});

	it('a stale per-repo `provider: none` warning points at `noPR`', () => {
		writeRepoConfig(repo, {provider: 'none'});
		const warnings: string[] = [];
		const origErr = console.error;
		console.error = (m?: unknown) => warnings.push(String(m ?? ''));
		try {
			loadRepoConfig(repo);
		} finally {
			console.error = origErr;
		}
		expect(warnings.some((w) => /noPR/.test(w))).toBe(true);
	});
});

describe('repoConfigPath', () => {
	it('resolves to the preferred `dorfl.json` when neither file exists', () => {
		// `/some/repo` does not exist, so neither candidate is present → the
		// resolver returns the PREFERRED path (where a write/create would land).
		expect(repoConfigPath('/some/repo')).toBe(join('/some/repo', 'dorfl.json'));
	});
});

describe('loadRepoConfig', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-repocfg-'));
	});

	afterEach(() => {
		rmrf(repo);
	});

	it('returns an empty config and no rejected keys when the file is absent', () => {
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({});
		expect(loaded.rejected).toEqual([]);
		expect(loaded.path).toBe(repoConfigPath(repo));
	});

	it('reads only repo-appropriate keys from the file', () => {
		writeRepoConfig(repo, {integration: 'merge', defaultArbiter: 'arbiter'});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({
			integration: 'merge',
			defaultArbiter: 'arbiter',
		});
		expect(loaded.rejected).toEqual([]);
	});

	it('reads a verify gate (string or list)', () => {
		writeRepoConfig(repo, {verify: 'make check'});
		expect(loadRepoConfig(repo).config.verify).toBe('make check');
		writeRepoConfig(repo, {verify: ['a', 'b']});
		expect(loadRepoConfig(repo).config.verify).toEqual(['a', 'b']);
	});

	it('reads a prepare step (string or list), like verify', () => {
		writeRepoConfig(repo, {prepare: 'pnpm install'});
		expect(loadRepoConfig(repo).config.prepare).toBe('pnpm install');
		writeRepoConfig(repo, {
			prepare: ['pnpm install', 'git submodule update --init'],
		});
		expect(loadRepoConfig(repo).config.prepare).toEqual([
			'pnpm install',
			'git submodule update --init',
		]);
	});

	it('rejects runner/host-only keys and reports them (does not honour them)', () => {
		writeRepoConfig(repo, {
			integration: 'merge',
			piBin: '/x',
			maxParallel: 9,
			// A committed repo file must NOT supply the secret-bearing identity.
			identity: {auth: {ssh: 'ambient', https: 'ambient'}},
		} as never);
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.config).not.toHaveProperty('piBin');
		expect(loaded.config).not.toHaveProperty('maxParallel');
		expect(loaded.config).not.toHaveProperty('identity');
		expect(loaded.rejected).toContain('identity');
		expect(loaded.rejected).toContain('piBin');
		expect(loaded.rejected).toContain('maxParallel');
	});

	it('rejects a committed sessionsDir (host-only) and reports it, like piBin', () => {
		writeRepoConfig(repo, {
			integration: 'merge',
			sessionsDir: '/tmp/evil-sessions',
		});
		const loaded = loadRepoConfig(repo);
		// The committed sessionsDir is NOT honoured (a repo file must not redirect
		// where the host writes session logs) — it is rejected + reported.
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.config).not.toHaveProperty('sessionsDir');
		expect(loaded.rejected).toContain('sessionsDir');
		expect(loaded.message).toMatch(/sessionsDir/);
	});

	it('exposes a clear message naming the rejected keys and the file', () => {
		writeRepoConfig(repo, {piBin: '/x', maxParallel: 9});
		const loaded = loadRepoConfig(repo);
		expect(loaded.message).toBeDefined();
		expect(loaded.message).toMatch(/piBin/);
		expect(loaded.message).toMatch(/maxParallel/);
		expect(loaded.message).toMatch(/\.?dorfl\.json/);
	});

	it('has no message when nothing was rejected', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		expect(loadRepoConfig(repo).message).toBeUndefined();
	});

	it('ignores unknown keys silently (not rejected, not honoured)', () => {
		writeRepoConfig(repo, {integration: 'merge', somethingElse: 1});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config).toEqual({integration: 'merge'});
		expect(loaded.rejected).toEqual([]);
	});

	it('throws a helpful error on invalid JSON', () => {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), '{ not json');
		expect(() => loadRepoConfig(repo)).toThrow(/\.?dorfl\.json/);
	});
});

describe('resolveRepoConfig — per-key layering', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-resolve-'));
	});

	afterEach(() => {
		rmrf(repo);
	});

	it('a repo with no file resolves to the global config (unchanged behaviour)', () => {
		const global = mergeConfig({integration: 'merge', maxParallel: 7});
		const resolved = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(resolved.config).toEqual(global);
		expect(resolved.rejected).toEqual([]);
	});

	it('a repo with no file and a bare global keeps the built-in defaults', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {},
		});
		expect(resolved.config).toEqual(DEFAULT_CONFIG);
	});

	it('CI seam: a config-less repo with NO DORFL_* gate env resolves to the strict built-in gate defaults', () => {
		// Task `install-ci-emits-no-gate-env-let-config-decide`: the emitted
		// advance workflow carries no gate env, so a config-less repo running in CI
		// hits the resolver with `env: {}` and falls through to DEFAULT_CONFIG.
		// This pins that the four gate keys resolve to their strict-default values
		// (autoBuild/autoTask: false, observationTriage: 'off', surfaceBlockers:
		// false) — i.e. CI claims nothing until the user opts in via config or env.
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {},
		});
		expect(resolved.config.autoBuild).toBe(false);
		expect(resolved.config.autoTask).toBe(false);
		expect(resolved.config.observationTriage).toBe('off');
		expect(resolved.config.surfaceBlockers).toBe(false);
	});

	it('CI seam: per-repo `.dorfl.json` governs ALL FOUR gates when the workflow emits no DORFL_* env', () => {
		// The bug this task closes: the install-ci workflow used to hardcode the
		// four DORFL_* gate env vars, which forced the env layer to win
		// over the repo's committed `.dorfl.json` (precedence is flag > env
		// > per-repo > global > default). Now that the workflow emits NO gate env,
		// per-repo config takes effect for all four — verify that here at the
		// resolution seam by passing `env: {}` (the post-change workflow state).
		writeRepoConfig(repo, {
			autoBuild: true,
			autoTask: true,
			observationTriage: 'ask',
			surfaceBlockers: true,
		});
		const global = mergeConfig({
			autoBuild: false,
			autoTask: false,
			observationTriage: 'off',
			surfaceBlockers: false,
		});
		const resolved = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(resolved.config.autoBuild).toBe(true);
		expect(resolved.config.autoTask).toBe(true);
		expect(resolved.config.observationTriage).toBe('ask');
		expect(resolved.config.surfaceBlockers).toBe(true);
	});

	it('per-repo file overrides the global for `integration`', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(resolved.config.integration).toBe('merge');
	});

	it('per-repo file overrides the global for `verify` too', () => {
		writeRepoConfig(repo, {verify: 'make test'});
		const global = mergeConfig({verify: 'pnpm test'});
		const resolved = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(resolved.config.verify).toBe('make test');
	});

	// `taskingIntegration` (the per-TRANSITION TASKING override,
	// `per-transition-integration-mode-slicing-vs-build`) resolves through the SAME
	// chain as `integration` and is read by the tasking-transition caller as
	// `taskingIntegration ?? integration` (the FALLBACK is asserted at the do.ts
	// option-threading seam; here we pin the config-resolution half).
	it('a per-repo `taskingIntegration` overrides the global for the tasking transition; `integration` is independent', () => {
		writeRepoConfig(repo, {
			integration: 'propose',
			taskingIntegration: 'merge',
		});
		const global = mergeConfig({integration: 'propose'});
		const {config} = resolveRepoConfig({repoPath: repo, global, env: {}});
		// The maintainer's target: build proposes, tasking merges.
		expect(config.integration).toBe('propose');
		expect(config.taskingIntegration).toBe('merge');
	});

	it("UNSET `taskingIntegration` resolves to undefined (the caller falls back to `integration` ⇒ byte-for-byte today's behaviour)", () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const {config} = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(config.integration).toBe('merge');
		// No default in DEFAULT_CONFIG — unset means "fall back to integration", which
		// the tasking-transition caller does with `taskingIntegration ?? integration`.
		expect(config.taskingIntegration).toBeUndefined();
	});

	it("resolves `taskingIntegration` flag > env > per-repo > global (the new key rides `integration`'s chain)", () => {
		// per-repo opts the tasking override to merge over an unset global.
		writeRepoConfig(repo, {taskingIntegration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.taskingIntegration,
		).toBe('merge');
		// env (DORFL_TASKING_INTEGRATION) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_TASKING_INTEGRATION: 'propose'},
			}).config.taskingIntegration,
		).toBe('propose');
		// a flag beats env.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_TASKING_INTEGRATION: 'propose'},
				flags: {taskingIntegration: 'merge'},
			}).config.taskingIntegration,
		).toBe('merge');
	});

	// `intakeIntegration` (the per-TRANSITION INTAKE-DOCUMENT override, twin of
	// `taskingIntegration`; spec `intake-integration-knob-and-specs-land-in-proposed-rename`)
	// resolves through the SAME chain as `integration` and the intake caller reads
	// it as `intakeIntegration ?? integration` (the FALLBACK is applied at the CLI
	// seam `cli.ts`; here we pin the config-resolution half).
	it('a per-repo `intakeIntegration` overrides the global for the intake document; `integration` is independent', () => {
		writeRepoConfig(repo, {
			integration: 'merge',
			intakeIntegration: 'propose',
		});
		const global = mergeConfig({integration: 'merge'});
		const config = resolveRepoConfig({repoPath: repo, global, env: {}}).config;
		expect(config.integration).toBe('merge');
		expect(config.intakeIntegration).toBe('propose');
	});

	it("UNSET `intakeIntegration` resolves to undefined (the caller falls back to `integration` ⇒ byte-for-byte today's behaviour)", () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const config = resolveRepoConfig({repoPath: repo, global, env: {}}).config;
		expect(config.integration).toBe('merge');
		// No default in DEFAULT_CONFIG — unset means "fall back to integration", which
		// the intake caller does with `intakeIntegration ?? integration`.
		expect(config.intakeIntegration).toBeUndefined();
	});

	it("resolves `intakeIntegration` flag > env > per-repo > global (the new key rides `integration`'s chain)", () => {
		// per-repo opts the intake override to merge over an unset global.
		writeRepoConfig(repo, {intakeIntegration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.intakeIntegration,
		).toBe('merge');
		// env (DORFL_INTAKE_INTEGRATION) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_INTAKE_INTEGRATION: 'propose'},
			}).config.intakeIntegration,
		).toBe('propose');
		// a flag beats env.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_INTAKE_INTEGRATION: 'propose'},
				flags: {intakeIntegration: 'merge'},
			}).config.intakeIntegration,
		).toBe('merge');
	});

	// `tasksLandIn` (the per-repo TASK-PLACEMENT default, task
	// `runner-deterministic-slice-placement-policy-and-precedence`) is resolved
	// EXACTLY like `taskingIntegration`: a config-resolved per-repo default fed
	// into the shared placement resolver (`src/placement.ts`) as the
	// CONFIGURED-DEFAULT rung. The runner-deterministic precedence (explicit >
	// untrusted-origin > configured > built-in) is end-to-end-tested in
	// `placement-precedence.test.ts`; here we pin the config-resolution half.
	it('`tasksLandIn` is a per-repo allowed key', () => {
		expect(REPO_ALLOWED_KEYS).toContain('tasksLandIn');
	});

	it('resolves `tasksLandIn` flag > env > per-repo > global > built-in (`backlog`)', () => {
		// Built-in floor: unset everywhere ⇒ `backlog` (the conservative
		// landing that preserves the tracer task's behaviour). The staging value
		// was renamed `'pre-backlog'` → `'backlog'`.
		const bare = mergeConfig({});
		expect(
			resolveRepoConfig({repoPath: repo, global: bare, env: {}}).config
				.tasksLandIn,
		).toBe('backlog');
		// global override: the user's global config sets the POOL value `ready`
		// (renamed `'backlog'` → `'todo'` → `'ready'`, ADR
		// `rename-task-pool-folder-todo-to-ready`; staging is `'backlog'`).
		const global = mergeConfig({tasksLandIn: 'ready'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.tasksLandIn,
		).toBe('ready');
		// per-repo file overrides the global.
		writeRepoConfig(repo, {tasksLandIn: 'backlog'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.tasksLandIn,
		).toBe('backlog');
		// env (DORFL_TASKS_LAND_IN) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_TASKS_LAND_IN: 'ready'},
			}).config.tasksLandIn,
		).toBe('ready');
		// a flag beats env.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_TASKS_LAND_IN: 'ready'},
				flags: {tasksLandIn: 'backlog'},
			}).config.tasksLandIn,
		).toBe('backlog');
	});

	// HARD CUTOVER (spec `prd-to-spec-vocabulary-cutover-and-migration-command`,
	// contract step): `specsLandIn` is the SOLE spec-placement key; the legacy
	// `prdsLandIn` alias is GONE (clean break — no accepted alias, no fallback).
	it('`specsLandIn` is the canonical per-repo allowed key; the legacy `prdsLandIn` is NOT allowed', () => {
		expect(REPO_ALLOWED_KEYS).toContain('specsLandIn');
		expect(REPO_ALLOWED_KEYS).not.toContain('prdsLandIn');
	});

	it('the dead `prdsLandIn` key does NOT resolve (it is an unknown key, not carried into config)', () => {
		const global = mergeConfig({});
		writeRepoConfig(repo, {prdsLandIn: 'ready'});
		const origErr = console.error;
		console.error = () => {};
		let loaded;
		try {
			loaded = resolveRepoConfig({repoPath: repo, global, env: {}});
		} finally {
			console.error = origErr;
		}
		// The dead key is not carried through onto the resolved config.
		expect('prdsLandIn' in loaded.config).toBe(false);
	});

	it('resolves a per-repo `specsLandIn` through the standard chain (flag > env > per-repo > global)', () => {
		const global = mergeConfig({});
		// per-repo file sets the canonical key.
		writeRepoConfig(repo, {specsLandIn: 'ready'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.specsLandIn,
		).toBe('ready');
		// env (DORFL_SPECS_LAND_IN) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_SPECS_LAND_IN: 'proposed'},
			}).config.specsLandIn,
		).toBe('proposed');
		// a flag beats env.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_SPECS_LAND_IN: 'proposed'},
				flags: {specsLandIn: 'ready'},
			}).config.specsLandIn,
		).toBe('ready');
	});

	// The UNTRUSTED-side placement TWINS (spec
	// `untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution`
	// US #5/#6/#7/#8, ADR `untrusted-origin-carries-via-stamp-not-forced-staging`)
	// are resolved EXACTLY like their trusted twins, DEFAULT to STAGING, and are
	// per-repo allowed. No call site consumes them yet (resolver + intake/tasker
	// wiring are later tasks); here we pin the config-resolution half.
	it('`untrustedTasksLandIn` / `untrustedSpecsLandIn` are per-repo allowed keys', () => {
		expect(REPO_ALLOWED_KEYS).toContain('untrustedTasksLandIn');
		expect(REPO_ALLOWED_KEYS).toContain('untrustedSpecsLandIn');
	});

	it('unset ⇒ both untrusted twins resolve to STAGING (`backlog` / `proposed`) — zero behaviour change for a repo configuring nothing', () => {
		const bare = mergeConfig({});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: bare,
			env: {},
		}).config;
		expect(resolved.untrustedTasksLandIn).toBe('backlog');
		expect(resolved.untrustedSpecsLandIn).toBe('proposed');
	});

	it('resolves `untrustedTasksLandIn` flag > env > per-repo > global > built-in (`backlog`)', () => {
		const global = mergeConfig({untrustedTasksLandIn: 'ready'});
		// global override wins over the built-in floor.
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.untrustedTasksLandIn,
		).toBe('ready');
		// per-repo file overrides the global.
		writeRepoConfig(repo, {untrustedTasksLandIn: 'backlog'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.untrustedTasksLandIn,
		).toBe('backlog');
		// env beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_UNTRUSTED_TASKS_LAND_IN: 'ready'},
			}).config.untrustedTasksLandIn,
		).toBe('ready');
		// a flag beats env.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_UNTRUSTED_TASKS_LAND_IN: 'ready'},
				flags: {untrustedTasksLandIn: 'backlog'},
			}).config.untrustedTasksLandIn,
		).toBe('backlog');
	});

	it('resolves `untrustedSpecsLandIn` flag > env > per-repo > global > built-in (`proposed`)', () => {
		const global = mergeConfig({untrustedSpecsLandIn: 'ready'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.untrustedSpecsLandIn,
		).toBe('ready');
		writeRepoConfig(repo, {untrustedSpecsLandIn: 'proposed'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.untrustedSpecsLandIn,
		).toBe('proposed');
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_UNTRUSTED_SPECS_LAND_IN: 'ready'},
			}).config.untrustedSpecsLandIn,
		).toBe('ready');
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_UNTRUSTED_SPECS_LAND_IN: 'ready'},
				flags: {untrustedSpecsLandIn: 'proposed'},
			}).config.untrustedSpecsLandIn,
		).toBe('proposed');
	});

	it('per-repo file overrides the global for `autoBuild` (flag > per-repo > global > default)', () => {
		// default false; global false; per-repo opts in ⇒ per-repo wins.
		writeRepoConfig(repo, {autoBuild: true});
		const global = mergeConfig({autoBuild: false});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.autoBuild,
		).toBe(true);
		// a flag beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {},
				flags: {autoBuild: false},
			}).config.autoBuild,
		).toBe(false);
	});

	it('treats a per-repo `allowAgents` key as an unknown key: ignored, `autoBuild` untouched (no crash)', () => {
		// `allowAgents` is no longer a recognised alias; it falls through to the
		// normal unknown-key path (silently ignored), so it never appears in the
		// loaded config and never maps onto `autoBuild`.
		writeRepoConfig(repo, {allowAgents: true, autoBuild: false});
		const loaded = loadRepoConfig(repo);
		expect(loaded.config.autoBuild).toBe(false);
		expect('allowAgents' in loaded.config).toBe(false);
		// And it resolves through the chain on the canonical key alone.
		const global = mergeConfig({autoBuild: true});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.autoBuild,
		).toBe(false);
	});

	it('resolves `autoTask` flag > env > per-repo > global > default false (like autoBuild)', () => {
		// default false; bare global ⇒ stays the built-in default false.
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.autoTask,
		).toBe(false);
		// per-repo opts in over a false global.
		writeRepoConfig(repo, {autoTask: true});
		const global = mergeConfig({autoTask: false});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.autoTask,
		).toBe(true);
		// env (DORFL_AUTO_TASK) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_AUTO_TASK: 'false'},
			}).config.autoTask,
		).toBe(false);
		// a flag beats env, per-repo, and global.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_AUTO_TASK: 'false'},
				flags: {autoTask: true},
			}).config.autoTask,
		).toBe(true);
	});

	it('resolves `promptGuidance.testFirst` flag > env > per-repo > global > default false (like autoBuild)', () => {
		// The NUDGE namespace rides the SAME precedence chain as the gate family
		// (the prd's acceptance criterion). default false; bare global ⇒ default.
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.promptGuidance.testFirst,
		).toBe(false);
		// per-repo opts in over a false global.
		writeRepoConfig(repo, {promptGuidance: {testFirst: true}});
		const global = mergeConfig({promptGuidance: {testFirst: false}});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.promptGuidance
				.testFirst,
		).toBe(true);
		// env (DORFL_PROMPT_GUIDANCE_TEST_FIRST) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_PROMPT_GUIDANCE_TEST_FIRST: 'false'},
			}).config.promptGuidance.testFirst,
		).toBe(false);
		// a flag beats env, per-repo, and global.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_PROMPT_GUIDANCE_TEST_FIRST: 'false'},
				flags: {promptGuidance: {testFirst: true}},
			}).config.promptGuidance.testFirst,
		).toBe(true);
	});

	it('resolves `observationTriage` flag > env > per-repo > global > default off (the enum gate)', () => {
		// default off; bare global ⇒ stays the built-in default off.
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.observationTriage,
		).toBe('off');
		// per-repo opts in over an off global.
		writeRepoConfig(repo, {observationTriage: 'auto'});
		const global = mergeConfig({observationTriage: 'off'});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.observationTriage,
		).toBe('auto');
		// env (DORFL_OBSERVATION_TRIAGE) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_OBSERVATION_TRIAGE: 'ask'},
			}).config.observationTriage,
		).toBe('ask');
		// a flag beats env, per-repo, and global.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_OBSERVATION_TRIAGE: 'ask'},
				flags: {observationTriage: 'auto'},
			}).config.observationTriage,
		).toBe('auto');
	});

	it('resolves `surfaceBlockers` flag > env > per-repo > global > default false (the boolean blocked-work gate)', () => {
		// default false; bare global ⇒ stays the built-in default false.
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({}), env: {}})
				.config.surfaceBlockers,
		).toBe(false);
		// per-repo opts in over a false global.
		writeRepoConfig(repo, {surfaceBlockers: true});
		const global = mergeConfig({surfaceBlockers: false});
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config
				.surfaceBlockers,
		).toBe(true);
		// env (DORFL_SURFACE_BLOCKERS) beats the per-repo file.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_SURFACE_BLOCKERS: 'false'},
			}).config.surfaceBlockers,
		).toBe(false);
		// a flag beats env, per-repo, and global.
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {DORFL_SURFACE_BLOCKERS: 'false'},
				flags: {surfaceBlockers: true},
			}).config.surfaceBlockers,
		).toBe(true);
	});

	it('keeps runner/host-only keys from the GLOBAL (per-repo cannot touch them)', () => {
		writeRepoConfig(repo, {integration: 'merge', maxParallel: 9});
		const global = mergeConfig({integration: 'propose', maxParallel: 4});
		const resolved = resolveRepoConfig({repoPath: repo, global, env: {}});
		expect(resolved.config.integration).toBe('merge'); // per-repo wins
		expect(resolved.config.maxParallel).toBe(4); // global-only, untouched
		expect(resolved.rejected).toContain('maxParallel');
	});

	it('flag overrides beat the per-repo file (flag > per-repo > global > default)', () => {
		writeRepoConfig(repo, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {},
			flags: {integration: 'propose'},
		});
		expect(resolved.config.integration).toBe('propose');
	});

	it('the full precedence chain holds for one key', () => {
		// default = propose; global = merge; per-repo = propose; flag = merge
		writeRepoConfig(repo, {integration: 'propose'});
		const global = mergeConfig({integration: 'merge'});
		// no flag ⇒ per-repo wins over global
		expect(
			resolveRepoConfig({repoPath: repo, global, env: {}}).config.integration,
		).toBe('propose');
		// flag ⇒ flag wins over everything
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env: {},
				flags: {integration: 'merge'},
			}).config.integration,
		).toBe('merge');
	});

	it('falls back to global then default when neither file nor flag set a key', () => {
		// bare global ⇒ integration falls to the built-in default (propose)
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {},
		});
		expect(resolved.config.integration).toBe(DEFAULT_CONFIG.integration);
	});
});

describe('resolveRepoConfig — multi-repo independence', () => {
	let repoA: string;
	let repoB: string;

	beforeEach(() => {
		repoA = mkdtempSync(join(tmpdir(), 'dorfl-repoA-'));
		repoB = mkdtempSync(join(tmpdir(), 'dorfl-repoB-'));
	});

	afterEach(() => {
		rmrf(repoA);
		rmrf(repoB);
	});

	it('each repo resolves against its OWN file in one run (A merge, B propose)', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		writeRepoConfig(repoB, {integration: 'propose'});
		const global = mergeConfig({integration: 'propose'});

		const a = resolveRepoConfig({repoPath: repoA, global, env: {}});
		const b = resolveRepoConfig({repoPath: repoB, global, env: {}});

		expect(a.config.integration).toBe('merge');
		expect(b.config.integration).toBe('propose');
	});

	it('a repo without a file uses the global while a sibling overrides it', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		// repoB has no file
		const global = mergeConfig({integration: 'propose'});

		const a = resolveRepoConfig({repoPath: repoA, global, env: {}});
		const b = resolveRepoConfig({repoPath: repoB, global, env: {}});

		expect(a.config.integration).toBe('merge'); // own file
		expect(b.config.integration).toBe('propose'); // global
	});

	it('repos can carry different verify gates and arbiters in one run', () => {
		writeRepoConfig(repoA, {verify: 'make a', defaultArbiter: 'a-remote'});
		writeRepoConfig(repoB, {verify: ['x', 'y'], defaultArbiter: 'b-remote'});
		const global = mergeConfig({});

		const a = resolveRepoConfig({repoPath: repoA, global, env: {}});
		const b = resolveRepoConfig({repoPath: repoB, global, env: {}});

		expect(a.config.verify).toBe('make a');
		expect(a.config.defaultArbiter).toBe('a-remote');
		expect(b.config.verify).toEqual(['x', 'y']);
		expect(b.config.defaultArbiter).toBe('b-remote');
	});

	it('resolution is read-only and does not mutate the shared global config', () => {
		writeRepoConfig(repoA, {integration: 'merge'});
		const global = mergeConfig({integration: 'propose'});
		const snapshot = {...global};
		resolveRepoConfig({repoPath: repoA, global, env: {}});
		expect(global).toEqual(snapshot);
	});

	it('works when the repo root happens to be a nested directory tree', () => {
		const nested = join(repoA, 'deep', 'nested');
		mkdirSync(nested, {recursive: true});
		writeRepoConfig(nested, {integration: 'merge'});
		const resolved = resolveRepoConfig({
			repoPath: nested,
			global: mergeConfig({integration: 'propose'}),
			env: {},
		});
		expect(resolved.config.integration).toBe('merge');
	});
});

describe('resolveRepoConfig — DORFL_* env layer', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-env-'));
	});

	afterEach(() => {
		rmrf(repo);
	});

	it('env sits ABOVE per-repo + global but BELOW a flag (chain position)', () => {
		// global = propose; per-repo = propose; env = merge; flag = propose
		writeRepoConfig(repo, {integration: 'propose'});
		const global = mergeConfig({integration: 'propose'});
		const env = {DORFL_INTEGRATION: 'merge'};
		// env beats per-repo + global
		expect(
			resolveRepoConfig({repoPath: repo, global, env}).config.integration,
		).toBe('merge');
		// a flag still beats env
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global,
				env,
				flags: {integration: 'propose'},
			}).config.integration,
		).toBe('propose');
	});

	it('env overrides the GLOBAL when there is no per-repo file', () => {
		const global = mergeConfig({integration: 'propose'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {DORFL_INTEGRATION: 'merge'},
		});
		expect(resolved.config.integration).toBe('merge');
	});

	it('env sets host-only keys the per-repo file rejects (per-machine source)', () => {
		// The per-repo file tries (and fails) to set host-only keys; env sets them.
		writeRepoConfig(repo, {piBin: '/ignored', maxParallel: 99});
		const global = mergeConfig({});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {
				DORFL_PI_BIN: '/opt/pi',
				DORFL_AGENT_CMD: 'agent',
				DORFL_MAX_PARALLEL: '8',
			},
		});
		// env wins for the host-only keys; the per-repo file's attempts are rejected.
		expect(resolved.config.piBin).toBe('/opt/pi');
		expect(resolved.config.agentCmd).toBe('agent');
		expect(resolved.config.maxParallel).toBe(8);
		// the per-repo file STILL reports the rejected host-only keys
		expect(resolved.rejected).toContain('piBin');
		expect(resolved.rejected).toContain('maxParallel');
	});

	it('no env ⇒ built-in floors/defaults are unchanged (regression)', () => {
		// A bare global + empty env must leave piBin unset (floor `pi` applies later)
		// and every default intact.
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {},
		});
		expect(resolved.config).toEqual(DEFAULT_CONFIG);
		expect(resolved.config.piBin).toBeUndefined();
	});

	it('the global .config file still works alongside env (env is additive)', () => {
		// global file set maxParallel; env sets a DIFFERENT key ⇒ both apply.
		const global = mergeConfig({maxParallel: 6, defaultArbiter: 'origin'});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global,
			env: {DORFL_AGENT_CMD: 'agent'},
		});
		expect(resolved.config.maxParallel).toBe(6); // from the global file
		expect(resolved.config.defaultArbiter).toBe('origin'); // from the global file
		expect(resolved.config.agentCmd).toBe('agent'); // additive from env
	});

	it('rejects an invalid env value LOUDLY (naming the var)', () => {
		expect(() =>
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({}),
				env: {DORFL_MAX_PARALLEL: 'lots'},
			}),
		).toThrow(/DORFL_MAX_PARALLEL/);
	});
});

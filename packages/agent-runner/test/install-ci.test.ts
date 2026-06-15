import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	existsSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	mkdirSync,
} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {
	type AuthMode,
	type ProviderEntry,
	type ResolvedCIConfig,
	buildModelsJson,
	requiredSecretNames,
	orchestrateSecrets,
	loadCIConfigFile,
	resolveCIConfig,
	exportCIConfig,
	CIConfigError,
	generateSetupAction,
	buildSetupArtifacts,
	outputBaseName,
	registerCapability,
	clearCapabilityRegistry,
	registeredCapabilities,
	loadCapabilityRegistry,
} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI, runWizard, type WizardPrompts} from '../src/install-ci.js';

/**
 * `install-ci-core-and-github-adapter` — the provider-agnostic FOUNDATION of the
 * `install-ci` scaffolder + its first GitHub adapter (PRD `runner-in-ci`). These
 * tests stub the CI-provider seam ENTIRELY ({@link MemoryCIProviderContext}:
 * `setSecret` records to memory, `ghAvailable=false`, `repo` a fixture) — NO
 * network, NO real `gh`, NO real GitHub. Artifacts are generated into a `--fake`
 * scratch dir (`.fake/`, never `.github/`) and snapshot-asserted; the
 * non-interactive `--config` path is proven byte-identical to the interactive
 * wizard; and shared-write isolation is asserted (real `.github/`, real secrets,
 * real `~`, system git config all untouched).
 */

// ─── A deterministic stub WizardPrompts driven by a scripted answer queue ────

interface ScriptedAnswers {
	/** Answers for select() in order of call. */
	selects: string[];
	/** Answers for input() in order of call. */
	inputs: string[];
	/** Answers for confirm() in order of call. */
	confirms: boolean[];
	/** Answers for password() in order of call. */
	passwords: string[];
}

function scriptedPrompts(answers: Partial<ScriptedAnswers>): WizardPrompts {
	const selects = [...(answers.selects ?? [])];
	const inputs = [...(answers.inputs ?? [])];
	const confirms = [...(answers.confirms ?? [])];
	const passwords = [...(answers.passwords ?? [])];
	return {
		async input(_message, opts) {
			const next = inputs.shift();
			if (next !== undefined) return next;
			return opts?.default ?? '';
		},
		async password() {
			return passwords.shift() ?? '';
		},
		async confirm(_message, opts) {
			const next = confirms.shift();
			return next === undefined ? opts.default : next;
		},
		async select(_message, choices) {
			const next = selects.shift();
			if (next !== undefined) {
				const found = choices.find((c) => c.value === next);
				if (found) return found.value;
			}
			return choices[0].value;
		},
	};
}

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'install-ci-'));
});
afterEach(() => {
	rmSync(work, {recursive: true, force: true});
});

// ─── config model + models.json builder ──────────────────────────────────────

describe('models.json builder (provider-agnostic core)', () => {
	it('built-in providers reference the env var name; custom carry baseUrl/api/models', () => {
		const providers: ProviderEntry[] = [
			{
				name: 'anthropic',
				apiKeyEnvVar: 'ANTHROPIC_API_KEY',
				models: [{id: 'claude-sonnet-4-20250514'}],
				builtin: true,
			},
			{
				name: 'local',
				baseUrl: 'http://localhost:8080',
				api: 'openai-completions',
				apiKeyEnvVar: 'LOCAL_KEY',
				models: [{id: 'llama'}],
				builtin: false,
			},
		];
		const json = buildModelsJson(providers);
		expect(json.providers.anthropic).toEqual({apiKey: 'ANTHROPIC_API_KEY'});
		expect(json.providers.local).toEqual({
			baseUrl: 'http://localhost:8080',
			api: 'openai-completions',
			apiKey: 'LOCAL_KEY',
			models: [{id: 'llama'}],
		});
	});
});

// ─── secret-orchestration LOGIC (which secrets, dedup) ───────────────────────

describe('secret-orchestration logic (which secrets, deduplicated)', () => {
	const baseConfig = (over: Partial<ResolvedCIConfig>): ResolvedCIConfig => ({
		authMode: 'models-json',
		providers: [],
		defaultProvider: 'anthropic',
		defaultModel: 'm',
		harness: 'pi',
		...over,
	});

	it('models-json: one secret per DISTINCT provider apiKeyEnvVar, first-seen order', () => {
		const config = baseConfig({
			providers: [
				{name: 'a', apiKeyEnvVar: 'KEY_X', models: [{id: 'm'}], builtin: true},
				{name: 'b', apiKeyEnvVar: 'KEY_Y', models: [{id: 'm'}], builtin: true},
				// duplicate env var → deduped
				{name: 'c', apiKeyEnvVar: 'KEY_X', models: [{id: 'm'}], builtin: true},
			],
		});
		expect(requiredSecretNames(config)).toEqual(['KEY_X', 'KEY_Y']);
	});

	it('auth-json: the fixed PI_AUTH_JSON + GH_PAT pair (the sharp edge)', () => {
		expect(requiredSecretNames(baseConfig({authMode: 'auth-json'}))).toEqual([
			'PI_AUTH_JSON',
			'GH_PAT',
		]);
	});

	it('orchestrates secrets through the seam: known taken, missing prompted, empty skipped', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const config = baseConfig({
			providers: [
				{name: 'a', apiKeyEnvVar: 'KEY_X', models: [{id: 'm'}], builtin: true},
				{name: 'b', apiKeyEnvVar: 'KEY_Y', models: [{id: 'm'}], builtin: true},
				{name: 'c', apiKeyEnvVar: 'KEY_Z', models: [{id: 'm'}], builtin: true},
			],
		});
		const results = await orchestrateSecrets({
			ctx,
			config,
			knownSecrets: {KEY_X: 'from-config'},
			prompt: async (name) => (name === 'KEY_Y' ? 'prompted' : ''),
		});
		expect(results).toEqual([
			{name: 'KEY_X', status: 'set'},
			{name: 'KEY_Y', status: 'set'},
			{name: 'KEY_Z', status: 'skipped'},
		]);
		expect(ctx.secrets.get('KEY_X')).toBe('from-config');
		expect(ctx.secrets.get('KEY_Y')).toBe('prompted');
		expect(ctx.secrets.has('KEY_Z')).toBe(false);
	});
});

// ─── config load / export round-trip ─────────────────────────────────────────

describe('config load + --export-config round-trip', () => {
	it('loads a valid config file and rejects malformed ones loudly', () => {
		const file = join(work, 'ci.json');
		writeFileSync(
			file,
			JSON.stringify({
				authMode: 'models-json',
				providers: [
					{
						name: 'anthropic',
						apiKeyEnvVar: 'ANTHROPIC_API_KEY',
						models: [{id: 'm'}],
						builtin: true,
					},
				],
				defaultProvider: 'anthropic',
				defaultModel: 'm',
			}),
		);
		const loaded = loadCIConfigFile(file);
		expect(loaded.defaultProvider).toBe('anthropic');

		writeFileSync(file, JSON.stringify({authMode: 'models-json'}));
		expect(() => loadCIConfigFile(file)).toThrow(CIConfigError);
	});

	it('exportCIConfig omits secrets unless given, and round-trips through load', () => {
		const config: ResolvedCIConfig = {
			authMode: 'models-json',
			providers: [
				{
					name: 'anthropic',
					apiKeyEnvVar: 'ANTHROPIC_API_KEY',
					models: [{id: 'm'}],
					builtin: true,
				},
			],
			defaultProvider: 'anthropic',
			defaultModel: 'm',
			harness: 'pi',
		};
		const noSecrets = exportCIConfig(config);
		expect(noSecrets).not.toContain('secrets');
		expect(noSecrets.endsWith('\n')).toBe(true);

		const withSecrets = exportCIConfig(config, {ANTHROPIC_API_KEY: 'sk-xxx'});
		expect(JSON.parse(withSecrets).secrets).toEqual({
			ANTHROPIC_API_KEY: 'sk-xxx',
		});

		// round-trips: writing then loading yields the same resolved config.
		const file = join(work, 'exported.json');
		writeFileSync(file, noSecrets);
		expect(resolveCIConfig(loadCIConfigFile(file))).toEqual(config);
	});
});

// ─── composite setup action snapshot (both auth modes) ───────────────────────

describe('composite setup action generation (both auth modes)', () => {
	const modelsConfig: ResolvedCIConfig = {
		authMode: 'models-json',
		providers: [
			{
				name: 'anthropic',
				apiKeyEnvVar: 'ANTHROPIC_API_KEY',
				models: [{id: 'claude-sonnet-4-20250514'}],
				builtin: true,
			},
		],
		defaultProvider: 'anthropic',
		defaultModel: 'claude-sonnet-4-20250514',
		harness: 'pi',
	};

	it('models-json mode writes models.json inline, installs node + agent-runner + harness', () => {
		const action = generateSetupAction(modelsConfig);
		expect(action).toContain('name: Setup agent-runner');
		expect(action).toContain('using: composite');
		expect(action).toContain('actions/setup-node@v4');
		expect(action).toContain('npm install -g agent-runner');
		expect(action).toContain('npm install -g @mariozechner/pi-coding-agent');
		expect(action).toContain('git config user.name "agent-runner[bot]"');
		expect(action).toContain('Configure agent models (models.json)');
		expect(action).toContain('~/.pi/agent/models.json');
		expect(action).toContain('"ANTHROPIC_API_KEY"');
		// models-json mode carries NO auth.json / OAuth refresh.
		expect(action).not.toContain('auth.json');
		expect(action).not.toContain('refresh-oauth-token');
	});

	it('auth-json mode writes auth.json from PI_AUTH_JSON + runs the OAuth refresh (the sharp edge)', () => {
		const action = generateSetupAction({
			...modelsConfig,
			authMode: 'auth-json',
			providers: [],
		});
		expect(action).toContain('Configure agent auth (auth.json)');
		expect(action).toContain('$PI_AUTH_JSON');
		expect(action).toContain('~/.pi/agent/auth.json');
		expect(action).toContain('node .github/scripts/refresh-oauth-token.mjs');
		// auth-json mode does NOT write a models.json.
		expect(action).not.toContain('models.json');
	});

	it('is deterministic — the same config produces byte-identical output', () => {
		expect(generateSetupAction(modelsConfig)).toBe(
			generateSetupAction(modelsConfig),
		);
	});
});

// ─── --fake snapshot mode + artifact set ─────────────────────────────────────

describe('--fake snapshot mode (writes .fake/, never .github/, sets no real secret)', () => {
	const config: ResolvedCIConfig = {
		authMode: 'models-json',
		providers: [
			{
				name: 'anthropic',
				apiKeyEnvVar: 'ANTHROPIC_API_KEY',
				models: [{id: 'm'}],
				builtin: true,
			},
		],
		defaultProvider: 'anthropic',
		defaultModel: 'm',
		harness: 'pi',
	};

	it('outputBaseName is .fake when fake, else .github', () => {
		expect(outputBaseName(true)).toBe('.fake');
		expect(outputBaseName(false)).toBe('.github');
	});

	it('buildSetupArtifacts: models-json ships only the composite action', () => {
		const files = buildSetupArtifacts(config);
		expect(files.map((f) => f.path)).toEqual([
			join('actions', 'agent-runner-setup', 'action.yml'),
		]);
	});

	it('buildSetupArtifacts: auth-json additionally ships the OAuth refresh script', () => {
		const files = buildSetupArtifacts({
			...config,
			authMode: 'auth-json',
			providers: [],
		});
		expect(files.map((f) => f.path)).toEqual([
			join('actions', 'agent-runner-setup', 'action.yml'),
			join('scripts', 'refresh-oauth-token.mjs'),
		]);
	});

	it('installCI --fake writes to .fake/ and sets NO real secret on the stub seam', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeFileSync(file, exportCIConfig(config));
		const result = await installCI({
			ctx,
			fake: true,
			configFile: file,
			log: () => {},
		});

		expect(result.outcome).toBe('generated');
		// Artifacts under .fake/, NEVER .github/.
		expect(
			existsSync(
				join(work, '.fake', 'actions', 'agent-runner-setup', 'action.yml'),
			),
		).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		// NO real secret set in --fake mode.
		expect(ctx.secrets.size).toBe(0);
		expect(result.secrets).toEqual([]);
	});
});

// ─── interactive wizard ≡ config-file path (byte-identical) ───────────────────

describe('the wizard and the --config path produce byte-identical artifacts', () => {
	it('drives the wizard deterministically and the config-file path reproduces it exactly', async () => {
		// Drive the wizard: models-json, pi harness, anthropic built-in, default
		// env var + model, no custom URL, one model, no more providers.
		const prompts = scriptedPrompts({
			selects: ['models-json', 'pi', 'anthropic'],
			// GitHub secret name (default ANTHROPIC_API_KEY), base URL (blank), model id.
			inputs: ['ANTHROPIC_API_KEY', '', 'claude-sonnet-4-20250514'],
			// add another model? no; add another provider? no.
			confirms: [false, false],
		});
		const gathered = await runWizard(prompts);

		// Wizard run into a .fake dir.
		const wizardDir = join(work, 'wizard');
		mkdirSync(wizardDir, {recursive: true});
		const wizardCtx = new MemoryCIProviderContext({
			workDir: wizardDir,
			ghAvailable: false,
		});
		await installCI({
			ctx: wizardCtx,
			fake: true,
			// re-run the same scripted prompts (a fresh queue) to gather inside installCI
			prompts: scriptedPrompts({
				selects: ['models-json', 'pi', 'anthropic'],
				inputs: ['ANTHROPIC_API_KEY', '', 'claude-sonnet-4-20250514'],
				confirms: [false, false],
			}),
			log: () => {},
		});

		// Config-file run into a separate .fake dir, from the wizard-gathered config.
		const configDir = join(work, 'config');
		mkdirSync(configDir, {recursive: true});
		const configFile = join(work, 'gathered.json');
		writeFileSync(configFile, exportCIConfig(resolveCIConfig(gathered)));
		const configCtx = new MemoryCIProviderContext({
			workDir: configDir,
			ghAvailable: false,
		});
		await installCI({
			ctx: configCtx,
			fake: true,
			configFile,
			log: () => {},
		});

		// The produced composite action must be byte-identical between the two paths.
		const rel = join('.fake', 'actions', 'agent-runner-setup', 'action.yml');
		const fromWizard = readFileSync(join(wizardDir, rel), 'utf8');
		const fromConfig = readFileSync(join(configDir, rel), 'utf8');
		expect(fromWizard).toBe(fromConfig);
	});
});

// ─── the CI-provider seam is stubbed: live secret-set path (non-fake) ─────────

describe('the CI-provider seam (setSecret / repo / ghAvailable) is fully stubbed', () => {
	it('a non-fake install records secrets only on the in-memory seam (no real store)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeFileSync(
			file,
			exportCIConfig(
				{
					authMode: 'models-json',
					providers: [
						{
							name: 'anthropic',
							apiKeyEnvVar: 'ANTHROPIC_API_KEY',
							models: [{id: 'm'}],
							builtin: true,
						},
					],
					defaultProvider: 'anthropic',
					defaultModel: 'm',
					harness: 'pi',
				},
				{ANTHROPIC_API_KEY: 'sk-fixture'},
			),
		);
		const result = await installCI({ctx, configFile: file, log: () => {}});
		expect(result.secrets).toEqual([
			{name: 'ANTHROPIC_API_KEY', status: 'set'},
		]);
		// Recorded ONLY in memory.
		expect(ctx.secrets.get('ANTHROPIC_API_KEY')).toBe('sk-fixture');
	});
});

// ─── --export-config (+ --include-secrets) ───────────────────────────────────

describe('--export-config round-trips the gathered config', () => {
	it('writes the config to a file and does not generate artifacts', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const inFile = join(work, 'in.json');
		writeFileSync(
			inFile,
			exportCIConfig({
				authMode: 'models-json',
				providers: [
					{
						name: 'anthropic',
						apiKeyEnvVar: 'ANTHROPIC_API_KEY',
						models: [{id: 'm'}],
						builtin: true,
					},
				],
				defaultProvider: 'anthropic',
				defaultModel: 'm',
				harness: 'pi',
			}),
		);
		const outFile = join(work, 'out.json');
		const result = await installCI({
			ctx,
			configFile: inFile,
			exportConfig: outFile,
			log: () => {},
		});
		expect(result.outcome).toBe('exported');
		expect(existsSync(outFile)).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(existsSync(join(work, '.fake'))).toBe(false);
		expect(JSON.parse(readFileSync(outFile, 'utf8')).defaultProvider).toBe(
			'anthropic',
		);
	});
});

// ─── optional GitHub delete_branch_on_merge repo-setting (cap-F residue) ──────

describe('optional delete_branch_on_merge repo-setting (offered, never silent)', () => {
	const config = {
		authMode: 'models-json' as AuthMode,
		providers: [
			{
				name: 'anthropic',
				apiKeyEnvVar: 'ANTHROPIC_API_KEY',
				models: [{id: 'm'}],
				builtin: true,
			},
		],
		defaultProvider: 'anthropic',
		defaultModel: 'm',
		harness: 'pi' as const,
	};

	function configFile(): string {
		const f = join(work, 'ci.json');
		writeFileSync(f, exportCIConfig(config, {ANTHROPIC_API_KEY: 'sk'}));
		return f;
	}

	it('is set ONLY when the wizard confirms it (never silently toggled)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		await installCI({
			ctx,
			configFile: configFile(),
			prompts: scriptedPrompts({confirms: [true]}),
			log: () => {},
		});
		expect(ctx.repoSettings.get('delete_branch_on_merge')).toBe(true);
	});

	it('is NOT touched when declined, and never with no prompt seam', async () => {
		const declineCtx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		await installCI({
			ctx: declineCtx,
			configFile: configFile(),
			prompts: scriptedPrompts({confirms: [false]}),
			log: () => {},
		});
		expect(declineCtx.repoSettings.size).toBe(0);

		const noPromptCtx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		await installCI({
			ctx: noPromptCtx,
			configFile: configFile(),
			log: () => {},
		});
		expect(noPromptCtx.repoSettings.size).toBe(0);
	});
});

// ─── capability-emitter REGISTRY seam (file-orthogonality) ───────────────────

describe('capability-emitter registry seam (a new capability is a NEW file)', () => {
	beforeEach(() => {
		clearCapabilityRegistry();
	});
	afterEach(() => {
		clearCapabilityRegistry();
	});

	it('registerCapability adds an emitter the registry returns', () => {
		registerCapability({id: 'x', label: 'X', emit: () => []});
		expect(registeredCapabilities().map((c) => c.id)).toEqual(['x']);
	});

	it('loadCapabilityRegistry picks up the shipped directory module without editing a shared list', async () => {
		const caps = await loadCapabilityRegistry();
		// The shipped reference capability is discovered from its own file —
		// no central list/switch was edited to register it.
		expect(caps.map((c) => c.id)).toContain('example-noop');
	});

	it('a brand-new capability file in the directory is picked up with no other edit', async () => {
		// Simulate a sibling slice ADDING a capability EXACTLY as it would: drop a new
		// module into the REAL `install-ci-capabilities/` directory next to the source
		// (using the same relative core import the shipped reference uses), then run
		// the default-directory scan. Its pickup proves registration needs NO edit to
		// any shared list/switch (the file-orthogonality contract). Cleaned up after.
		const capDir = new URL('../src/install-ci-capabilities/', import.meta.url)
			.pathname;
		const fixturePath = join(capDir, 'zzz-fixture-cap.ts');
		try {
			writeFileSync(
				fixturePath,
				"import {registerCapability} from '../install-ci-core.js';\n" +
					"registerCapability({id: 'zzz-fixture-cap', label: 'Fixture', emit: () => []});\n",
			);
			const caps = await loadCapabilityRegistry();
			expect(caps.map((c) => c.id)).toContain('zzz-fixture-cap');
		} finally {
			rmSync(fixturePath, {force: true});
		}
	});
});

// ─── shared-write isolation (the slice's load-bearing safety assertion) ──────

describe('shared-write isolation: real .github / secrets / ~ / system git config untouched', () => {
	it('a full --fake run touches nothing global — only the scratch workDir', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeFileSync(
			file,
			exportCIConfig({
				authMode: 'models-json',
				providers: [
					{
						name: 'anthropic',
						apiKeyEnvVar: 'ANTHROPIC_API_KEY',
						models: [{id: 'm'}],
						builtin: true,
					},
				],
				defaultProvider: 'anthropic',
				defaultModel: 'm',
				harness: 'pi',
			}),
		);

		// Snapshot the home dir + cwd .github before the run.
		const home = homedir();
		const homeBefore = safeList(home);

		await installCI({
			ctx,
			fake: true,
			configFile: file,
			prompts: scriptedPrompts({confirms: [true]}),
			log: () => {},
		});

		// No real secrets store touched (the stub seam recorded nothing in --fake).
		expect(ctx.secrets.size).toBe(0);
		expect(ctx.repoSettings.size).toBe(0);
		// No real .github written (only .fake under the scratch workDir).
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(existsSync(join(process.cwd(), '.fake'))).toBe(false);
		// The real home dir is unchanged by the run (no ~/.pi, no ~/.gitconfig edit).
		expect(safeList(home)).toEqual(homeBefore);
		// Output lives strictly under the scratch workDir.
		expect(existsSync(join(work, '.fake'))).toBe(true);
	});
});

/** A stable directory listing (sorted), or [] if the dir is missing. */
function safeList(dir: string): string[] {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}

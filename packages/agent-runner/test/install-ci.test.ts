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
	optionalSecretNames,
	PR_IDENTITY_SECRET_NAME,
	providerSecretsWithBlock,
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
		// The required provider keys, THEN the optional PR-identity token (never
		// prompted here — no `optionalPrompt` — so it skips cleanly).
		expect(results).toEqual([
			{name: 'KEY_X', status: 'set'},
			{name: 'KEY_Y', status: 'set'},
			{name: 'KEY_Z', status: 'skipped'},
			{name: 'AGENT_RUNNER_GH_TOKEN', status: 'skipped'},
		]);
		expect(ctx.secrets.get('KEY_X')).toBe('from-config');
		expect(ctx.secrets.get('KEY_Y')).toBe('prompted');
		expect(ctx.secrets.has('KEY_Z')).toBe(false);
		expect(ctx.secrets.has('AGENT_RUNNER_GH_TOKEN')).toBe(false);
	});

	it('offers the OPTIONAL PR-identity token (AGENT_RUNNER_GH_TOKEN): set via optionalPrompt, taken from knownSecrets, or skipped when blank', async () => {
		// (a) set via optionalPrompt
		const ctxA = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const config = baseConfig({
			providers: [
				{name: 'a', apiKeyEnvVar: 'KEY_X', models: [{id: 'm'}], builtin: true},
			],
		});
		const setResults = await orchestrateSecrets({
			ctx: ctxA,
			config,
			prompt: async () => 'k',
			optionalPrompt: async () => 'pat-123',
		});
		expect(setResults).toEqual([
			{name: 'KEY_X', status: 'set'},
			{name: 'AGENT_RUNNER_GH_TOKEN', status: 'set'},
		]);
		expect(ctxA.secrets.get('AGENT_RUNNER_GH_TOKEN')).toBe('pat-123');

		// (b) taken from knownSecrets even without an optionalPrompt
		const ctxB = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const knownResults = await orchestrateSecrets({
			ctx: ctxB,
			config,
			knownSecrets: {KEY_X: 'k', AGENT_RUNNER_GH_TOKEN: 'from-config'},
		});
		expect(knownResults).toContainEqual({
			name: 'AGENT_RUNNER_GH_TOKEN',
			status: 'set',
		});
		expect(ctxB.secrets.get('AGENT_RUNNER_GH_TOKEN')).toBe('from-config');

		// (c) blank optionalPrompt ⇒ skipped (the zero-config fallback)
		const ctxC = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const skipResults = await orchestrateSecrets({
			ctx: ctxC,
			config,
			prompt: async () => 'k',
			optionalPrompt: async () => '',
		});
		expect(skipResults).toContainEqual({
			name: 'AGENT_RUNNER_GH_TOKEN',
			status: 'skipped',
		});
		expect(ctxC.secrets.has('AGENT_RUNNER_GH_TOKEN')).toBe(false);
	});

	it('optionalSecretNames is the PR-identity token in both auth modes; requiredSecretNames is unchanged', async () => {
		expect(PR_IDENTITY_SECRET_NAME).toBe('AGENT_RUNNER_GH_TOKEN');
		expect(optionalSecretNames(baseConfig({}))).toEqual([
			'AGENT_RUNNER_GH_TOKEN',
		]);
		expect(optionalSecretNames(baseConfig({authMode: 'auth-json'}))).toEqual([
			'AGENT_RUNNER_GH_TOKEN',
		]);
	});

	it('providerSecretsWithBlock: a with: fragment in models-json mode, empty in auth-json / no-providers', () => {
		const block = providerSecretsWithBlock(
			baseConfig({
				providers: [
					{
						name: 'a',
						apiKeyEnvVar: 'ANTHROPIC_API_KEY',
						models: [{id: 'm'}],
						builtin: true,
					},
				],
			}),
		);
		expect(block).toContain('with:');
		expect(block).toContain(
			'ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
		);
		// auth-json mode has no provider keys here.
		expect(providerSecretsWithBlock(baseConfig({authMode: 'auth-json'}))).toBe(
			'',
		);
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
			installSource: 'registry',
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
		installSource: 'registry',
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

	it('models-json mode declares a provider-key INPUT and forwards it to $GITHUB_ENV (so pi can auth)', () => {
		const action = generateSetupAction(modelsConfig);
		// A top-level optional input named after the secret.
		expect(action).toContain('inputs:');
		expect(action).toMatch(/ANTHROPIC_API_KEY:\n\s+description:/);
		expect(action).toContain('required: false');
		// The export step maps the input into env, then appends non-empty to GITHUB_ENV.
		expect(action).toContain('Export provider API key(s) to the environment');
		expect(action).toContain(
			'ANTHROPIC_API_KEY: ${{ inputs.ANTHROPIC_API_KEY }}',
		);
		expect(action).toContain('>> "$GITHUB_ENV"');
	});

	it('auth-json mode declares NO provider input and NO export step (it uses auth.json)', () => {
		const action = generateSetupAction({
			...modelsConfig,
			authMode: 'auth-json',
			providers: [],
		});
		expect(action).not.toContain('inputs:');
		expect(action).not.toContain(
			'Export provider API key(s) to the environment',
		);
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

	// ─── workspace install mode (build from source, for the self-hosting repo) ──

	it('registry mode (default) installs the published CLI via npm and uses NO pnpm steps', () => {
		const action = generateSetupAction(modelsConfig);
		expect(action).toContain('npm install -g agent-runner');
		expect(action).toContain('npm install -g @mariozechner/pi-coding-agent');
		expect(action).not.toContain('pnpm');
		expect(action).not.toContain('build agent-runner');
	});

	it('workspace mode builds the CLI from source + links it, harness via pnpm, NO npm install -g agent-runner', () => {
		const action = generateSetupAction({
			...modelsConfig,
			installSource: 'workspace',
		});
		// The build-from-source steps.
		expect(action).toContain('uses: pnpm/action-setup@v4');
		expect(action).toContain('pnpm setup');
		expect(action).toContain(
			'echo "$HOME/.local/share/pnpm" >> "$GITHUB_PATH"',
		);
		expect(action).toContain('pnpm install');
		expect(action).toContain('pnpm -r build');
		expect(action).toContain('cd packages/agent-runner && pnpm link --global');
		// Harness installed via pnpm so it lands on the pnpm global bin on PATH.
		expect(action).toContain('pnpm add -g @mariozechner/pi-coding-agent');
		// The registry install is GONE in workspace mode.
		expect(action).not.toContain('npm install -g agent-runner');
		expect(action).not.toContain(
			'npm install -g @mariozechner/pi-coding-agent',
		);
	});

	it('auth/identity/setup-node steps are identical in registry and workspace modes', () => {
		const registry = generateSetupAction(modelsConfig);
		const workspace = generateSetupAction({
			...modelsConfig,
			installSource: 'workspace',
		});
		for (const shared of [
			'actions/setup-node@v4',
			"node-version: '22'",
			'git config user.name "agent-runner[bot]"',
			'git config user.email "agent-runner[bot]@users.noreply.github.com"',
			'Configure agent models (models.json)',
			'~/.pi/agent/models.json',
		]) {
			expect(registry).toContain(shared);
			expect(workspace).toContain(shared);
		}
		// auth-json mode's shared steps are likewise mode-independent.
		const authRegistry = generateSetupAction({
			...modelsConfig,
			authMode: 'auth-json',
			providers: [],
		});
		const authWorkspace = generateSetupAction({
			...modelsConfig,
			authMode: 'auth-json',
			providers: [],
			installSource: 'workspace',
		});
		for (const shared of [
			'Configure agent auth (auth.json)',
			'$PI_AUTH_JSON',
			'node .github/scripts/refresh-oauth-token.mjs',
		]) {
			expect(authRegistry).toContain(shared);
			expect(authWorkspace).toContain(shared);
		}
	});

	it('resolveCIConfig defaults a missing installSource to registry', () => {
		const resolved = resolveCIConfig({
			authMode: 'models-json',
			providers: modelsConfig.providers,
			defaultProvider: 'anthropic',
			defaultModel: 'm',
		});
		expect(resolved.installSource).toBe('registry');
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

	it('install-ci emits a completion message explaining CI autonomy is OFF by default + HOW to enable it (config OR workflow env)', async () => {
		// Slice `install-ci-emits-no-gate-env-let-config-decide`: the emitted
		// advance workflow carries NO AGENT_RUNNER_* gate env, so a config-less
		// repo resolves to the built-in strict defaults (autoBuild/autoTask: false,
		// observationTriage: 'off', surfaceBlockers: false) and CI claims nothing.
		// That posture would be surprising without a heads-up; `install-ci` calls
		// the existing `log()` sink after writing artifacts to explain it AND name
		// the two enable paths (config key in .agent-runner.json OR the CI-only
		// AGENT_RUNNER_* env override).
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeFileSync(file, exportCIConfig(config));
		const lines: string[] = [];
		await installCI({
			ctx,
			fake: true,
			configFile: file,
			log: (line) => lines.push(line),
		});
		const joined = lines.join('\n');
		// Tells the user CI autonomy is off by default.
		expect(/CI autonomy is OFF by default/i.test(joined)).toBe(true);
		// Names the precedence chain so the now-quiet behaviour is anchored.
		expect(
			/flag\s*>\s*env\s*>\s*per-repo\s*>\s*global\s*>\s*default/.test(joined),
		).toBe(true);
		// Names both enable paths: the per-repo config keys AND the CI-only env.
		expect(/\.agent-runner\.json/.test(joined)).toBe(true);
		expect(/"autoBuild":\s*true/.test(joined)).toBe(true);
		expect(/"autoTask":\s*true/.test(joined)).toBe(true);
		expect(/AGENT_RUNNER_AUTO_BUILD:\s*'true'/.test(joined)).toBe(true);
		expect(/AGENT_RUNNER_AUTO_TASK:\s*'true'/.test(joined)).toBe(true);
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
		// The optional PR-identity token is offered but, with no value in the
		// config file and no prompts (non-interactive path), cleanly skipped.
		expect(result.secrets).toEqual([
			{name: 'ANTHROPIC_API_KEY', status: 'set'},
			{name: 'AGENT_RUNNER_GH_TOKEN', status: 'skipped'},
		]);
		// Recorded ONLY in memory.
		expect(ctx.secrets.get('ANTHROPIC_API_KEY')).toBe('sk-fixture');
		expect(ctx.secrets.has('AGENT_RUNNER_GH_TOKEN')).toBe(false);
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

// ─── install-ci emits ONE advance workflow (no redundant build-slice-tick) ──

describe('install-ci emits exactly ONE advance-verb workflow (advance-lifecycle, the superset)', () => {
	// Why: `advance` is a single SUPERSET verb and CI always calls it (never
	// `do`). The retired `build-slice-tick` emitter was a strictly weaker
	// duplicate of `advance-lifecycle` — same verb, gates, hourly cron — so its
	// removal (capability module + template deleted at source) leaves
	// advance-lifecycle as the sole advance emitter. This pins that, so a future
	// re-add of a parallel advance workflow would fail the suite.
	//
	// NOTE: capability modules self-register at IMPORT time (cached per-worker),
	// and the registry-seam describe above this one clears the registry in its
	// afterEach — so a later loadCapabilityRegistry() call hits the import cache
	// and finds the registry empty. We sidestep that here by re-creating the
	// shipped emitters DIRECTLY from the template-module exports (the same
	// constants + generators each capability shim wires up), which validates the
	// emitter pipeline as the wizard sees it.

	const config: ResolvedCIConfig = {
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

	async function shippedEmitters() {
		const adv = await import('../src/advance-lifecycle-template.js');
		const intake = await import('../src/intake-trigger-template.js');
		const closeJob = await import('../src/close-job-template.js');
		return [
			{
				id: adv.ADVANCE_LIFECYCLE_CAPABILITY_ID,
				label: adv.ADVANCE_LIFECYCLE_CAPABILITY_LABEL,
				emit: (c: ResolvedCIConfig) => [
					{
						path: adv.ADVANCE_LIFECYCLE_WORKFLOW_PATH,
						content: adv.generateAdvanceLifecycleWorkflow(c),
					},
				],
			},
			{
				id: intake.INTAKE_TRIGGER_CAPABILITY_ID,
				label: intake.INTAKE_TRIGGER_CAPABILITY_LABEL,
				emit: (c: ResolvedCIConfig) => [
					{
						path: intake.INTAKE_TRIGGER_WORKFLOW_PATH,
						content: intake.generateIntakeWorkflow(c),
					},
				],
			},
			{
				id: closeJob.CLOSE_JOB_CAPABILITY_ID,
				label: closeJob.CLOSE_JOB_CAPABILITY_LABEL,
				emit: (c: ResolvedCIConfig) => [
					{
						path: closeJob.CLOSE_JOB_WORKFLOW_PATH,
						content: closeJob.generateCloseJobWorkflow(c),
					},
				],
			},
		];
	}

	it('the shipped capability id set contains advance-lifecycle, intake, close-job — and NO build-slice-tick', async () => {
		const caps = await shippedEmitters();
		const ids = caps.map((c) => c.id);
		expect(ids).toContain('advance-lifecycle');
		expect(ids).toContain('intake');
		expect(ids).toContain('close-job');
		expect(ids).not.toContain('build-slice-tick');
		// And the deleted template module no longer exists on disk — a future
		// `loadCapabilityRegistry()` cannot re-find a build-slice-tick emitter.
		const capDir = new URL('../src/install-ci-capabilities/', import.meta.url)
			.pathname;
		expect(existsSync(join(capDir, 'build-slice-tick.ts'))).toBe(false);
		expect(
			existsSync(
				new URL('../src/build-slice-tick-template.ts', import.meta.url)
					.pathname,
			),
		).toBe(false);
	});

	it('the emitted file set contains exactly ONE workflow that invokes `agent-runner advance`, and NO build-slice-tick.yml', async () => {
		const shipped = await shippedEmitters();
		const files = buildSetupArtifacts(config, shipped);

		// No path mentions build-slice-tick anywhere.
		for (const f of files) {
			expect(f.path).not.toMatch(/build-slice-tick/);
		}

		// Workflow files = those under workflows/. Exactly one carries the
		// `agent-runner advance` verb (the lifecycle superset); intake +
		// close-job are workflows too, but they do NOT invoke `advance`.
		const workflowFiles = files.filter((f) =>
			f.path.startsWith(join('workflows', '')),
		);
		const advanceWorkflows = workflowFiles.filter((f) =>
			/\bagent-runner advance\b/.test(f.content),
		);
		expect(advanceWorkflows).toHaveLength(1);
		expect(advanceWorkflows[0]!.path).toBe(
			join('workflows', 'advance-lifecycle.yml'),
		);
	});

	it('the retained advance workflow keeps its superset shape: question-push trigger + reap job + NO active gate env (per-repo config wins)', async () => {
		const shipped = await shippedEmitters();
		const lifecycle = shipped.find((c) => c.id === 'advance-lifecycle')!;
		expect(lifecycle).toBeDefined();
		const [file] = lifecycle.emit(config);
		const yml = file!.content;

		// The on-answer-committed push trigger (the defining lifecycle trigger).
		expect(yml).toMatch(/\bpush:\s*[\s\S]*?paths:[\s\S]*?work\/questions\//);
		// The reap-merged-branches job (capability F rides this tick).
		expect(yml).toMatch(/reap-merged-branches:/);
		expect(yml).toMatch(/agent-runner gc --remote-branches\b/);
		// Slice `install-ci-emits-no-gate-env-let-config-decide`: NONE of the four
		// AGENT_RUNNER_* gate-family keys appears as an ACTIVE env assignment. The
		// shipped workflow defers all gate policy to per-repo config / built-in
		// defaults. Strip comment lines before the negative check so the
		// explanatory header comment (which names the keys to document the
		// posture) is not a false positive.
		const operative = yml
			.split('\n')
			.filter((line) => !/^\s*#/.test(line))
			.join('\n');
		expect(/AGENT_RUNNER_AUTO_BUILD\s*:/.test(operative)).toBe(false);
		expect(/AGENT_RUNNER_AUTO_TASK\s*:/.test(operative)).toBe(false);
		expect(/AGENT_RUNNER_OBSERVATION_TRIAGE\s*:/.test(operative)).toBe(false);
		expect(/AGENT_RUNNER_SURFACE_BLOCKERS\s*:/.test(operative)).toBe(false);
	});

	it('intake + close-job still emit one workflow each (they are not advance duplicates)', async () => {
		const shipped = await shippedEmitters();
		const intake = shipped.find((c) => c.id === 'intake')!;
		const closeJob = shipped.find((c) => c.id === 'close-job')!;
		expect(intake.emit(config).length).toBeGreaterThan(0);
		expect(closeJob.emit(config).length).toBeGreaterThan(0);
		// And neither of them carries the `advance` verb — they are not advance
		// workflows (the assertion above pins that there is ONLY ONE advance
		// workflow, advance-lifecycle).
		for (const f of intake.emit(config)) {
			expect(/\bagent-runner advance\b/.test(f.content)).toBe(false);
		}
		for (const f of closeJob.emit(config)) {
			expect(/\bagent-runner advance\b/.test(f.content)).toBe(false);
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

// ─── workspace install-source auto-detection + flag override ──────────────

describe('installCI auto-detects the workspace install source in the monorepo', () => {
	/** A minimal models-json config file written into `dir`; returns its path. */
	function writeConfigFile(dir: string): string {
		const file = join(dir, 'ci.json');
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
				installSource: 'registry',
			}),
		);
		return file;
	}

	/** Write a `<dir>/package.json` with the given `name` (omit `name` if null). */
	function writePkg(dir: string, name: string | null): void {
		writeFileSync(
			join(dir, 'package.json'),
			name === null ? JSON.stringify({}) : JSON.stringify({name}),
		);
	}

	async function run(
		workDir: string,
		opts: {installSource?: 'registry' | 'workspace'} = {},
	): Promise<ResolvedCIConfig> {
		// The config file lives in the SAME dir as the package.json (workDir), so we
		// strip installSource from it for the auto-detect cases that need NO explicit
		// value. writeConfigFile bakes `registry`; the explicit-override tests pass
		// opts.installSource instead. For the pure auto-detect tests we re-write the
		// config WITHOUT installSource so neither flag nor file pins it.
		const ctx = new MemoryCIProviderContext({workDir, ghAvailable: false});
		const file = join(workDir, 'ci.json');
		const result = await installCI({
			ctx,
			configFile: file,
			installSource: opts.installSource,
			log: () => {},
		});
		return result.config;
	}

	/** A config file with NO installSource (so detection/flag decides). */
	function writeConfigFileNoSource(dir: string): void {
		writeFileSync(
			join(dir, 'ci.json'),
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
				harness: 'pi',
			}),
		);
	}

	it('package.json named agent-runner-monorepo ⇒ workspace (no explicit value)', async () => {
		writePkg(work, 'agent-runner-monorepo');
		writeConfigFileNoSource(work);
		const config = await run(work);
		expect(config.installSource).toBe('workspace');
	});

	it('package.json named anything else ⇒ stays registry', async () => {
		writePkg(work, 'some-consumer-repo');
		writeConfigFileNoSource(work);
		const config = await run(work);
		expect(config.installSource).toBe('registry');
	});

	it('missing package.json ⇒ stays registry', async () => {
		writeConfigFileNoSource(work);
		const config = await run(work);
		expect(config.installSource).toBe('registry');
	});

	it('unparseable package.json ⇒ stays registry (error swallowed)', async () => {
		writeFileSync(join(work, 'package.json'), '{ not valid json');
		writeConfigFileNoSource(work);
		const config = await run(work);
		expect(config.installSource).toBe('registry');
	});

	it('explicit --install-source registry WINS inside the monorepo', async () => {
		writePkg(work, 'agent-runner-monorepo');
		writeConfigFileNoSource(work);
		const config = await run(work, {installSource: 'registry'});
		expect(config.installSource).toBe('registry');
	});

	it('explicit --install-source workspace WINS outside the monorepo', async () => {
		writePkg(work, 'some-consumer-repo');
		writeConfigFileNoSource(work);
		const config = await run(work, {installSource: 'workspace'});
		expect(config.installSource).toBe('workspace');
	});

	it('a config file installSource value WINS over auto-detection', async () => {
		// pkg says monorepo (would auto-detect workspace) but the file pins registry.
		writePkg(work, 'agent-runner-monorepo');
		writeConfigFile(work); // bakes installSource: 'registry'
		const config = await run(work);
		expect(config.installSource).toBe('registry');
	});

	it('AUTO-DETECTED workspace is NOT baked into --export-config (export ⇒ registry)', async () => {
		writePkg(work, 'agent-runner-monorepo');
		writeConfigFileNoSource(work);
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const outFile = join(work, 'exported.json');
		await installCI({
			ctx,
			configFile: join(work, 'ci.json'),
			exportConfig: outFile,
			log: () => {},
		});
		// The export reflects only the EXPLICIT value (none ⇒ registry default),
		// NOT the monorepo auto-detection (which runs after the export early-return).
		const exported = JSON.parse(readFileSync(outFile, 'utf8'));
		expect(exported.installSource).toBe('registry');
		expect(resolveCIConfig(loadCIConfigFile(outFile)).installSource).toBe(
			'registry',
		);
	});

	it('an EXPLICIT installSource round-trips through --export-config ⇒ --config', async () => {
		// Export with an explicit --install-source workspace from a NON-monorepo dir.
		writePkg(work, 'some-consumer-repo');
		writeConfigFileNoSource(work);
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			ghAvailable: false,
		});
		const outFile = join(work, 'exported.json');
		await installCI({
			ctx,
			configFile: join(work, 'ci.json'),
			installSource: 'workspace',
			exportConfig: outFile,
			log: () => {},
		});
		expect(JSON.parse(readFileSync(outFile, 'utf8')).installSource).toBe(
			'workspace',
		);
		// Re-load the exported file: the resolved mode is preserved.
		expect(resolveCIConfig(loadCIConfigFile(outFile)).installSource).toBe(
			'workspace',
		);
	});
});

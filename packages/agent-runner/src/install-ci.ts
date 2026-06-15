/**
 * The `install-ci` orchestrator (PRD `runner-in-ci`, slice
 * `install-ci-core-and-github-adapter`): ties the provider-agnostic core
 * (`install-ci-core.ts`) to a CI-provider adapter (the first being GitHub,
 * `install-ci-github.ts`) through the {@link CIProviderContext} seam. It drives
 * three paths from ONE config shape so they cannot diverge:
 *
 *   - the interactive WIZARD (prompts via the injectable {@link WizardPrompts}
 *     seam — production wires readline; tests inject a deterministic stub);
 *   - the non-interactive `--config <file>` path (loads the same shape, no prompts);
 *   - `--export-config` (+ `--include-secrets`) which round-trips the gathered
 *     config back to JSON.
 *
 * The artifacts (composite setup action + auth) are assembled by the core and
 * written under `.fake/` in `--fake` snapshot mode (NEVER `.github/`, NO real
 * secret), so the SAME inputs produce byte-identical output whether gathered
 * interactively or from a config file (the equivalence the slice pins).
 */

import {writeFileSync} from 'node:fs';
import {
	type AuthMode,
	type ProviderEntry,
	type CIConfigFile,
	type ResolvedCIConfig,
	type CIProviderContext,
	type CapabilityEmitter,
	type SecretSetResult,
	DEFAULT_HARNESS,
	loadCIConfigFile,
	resolveCIConfig,
	exportCIConfig,
	orchestrateSecrets,
	buildSetupArtifacts,
	writeArtifacts,
} from './install-ci-core.js';
import type {HarnessAdapter} from './config.js';

/**
 * The interactive prompt SEAM the wizard drives. Production wires readline; tests
 * inject a deterministic stub so the wizard runs with NO TTY, NO network, and the
 * gathered config exactly equals a config-file input (proving the equivalence).
 */
export interface WizardPrompts {
	/** A free-text answer (with an optional default). */
	input(message: string, opts?: {default?: string}): Promise<string>;
	/** A masked secret answer (never echoed). */
	password(message: string): Promise<string>;
	/** A yes/no answer (with a default). */
	confirm(message: string, opts: {default: boolean}): Promise<boolean>;
	/** Pick one of `choices` (each `{name, value}`). */
	select<T extends string>(
		message: string,
		choices: {name: string; value: T}[],
	): Promise<T>;
}

/** Options for {@link installCI}. */
export interface InstallCIOptions {
	/** The CI-provider seam (GitHub adapter in production; a stub in tests). */
	ctx: CIProviderContext;
	/** Snapshot mode: write to `.fake/` (never `.github/`), set NO real secret. */
	fake?: boolean;
	/** Non-interactive: load the config from this JSON file (skips the wizard). */
	configFile?: string;
	/** Write the gathered config as JSON to this path instead of generating. */
	exportConfig?: string;
	/** With `--export-config`: also gather + include the secret values. */
	includeSecrets?: boolean;
	/** The interactive prompt seam (required unless `configFile` is given). */
	prompts?: WizardPrompts;
	/** The capability emitters to emit workflows for (none in this core slice). */
	capabilities?: CapabilityEmitter[];
	/** Sink for human-facing progress lines (default: console.log). */
	log?: (line: string) => void;
}

/** The result of an {@link installCI} run. */
export interface InstallCIResult {
	/** What the run did. */
	outcome: 'exported' | 'generated';
	/** The resolved config that was used. */
	config: ResolvedCIConfig;
	/** Repo-relative paths written (the artifacts), empty on `exported`. */
	written: string[];
	/** The secret-orchestration outcomes (empty on `--fake` / `exported`). */
	secrets: SecretSetResult[];
}

/**
 * Run `install-ci`. Resolves the config (config-file path or the wizard), then
 * either exports it (`--export-config`) or generates the artifacts. In `--fake`
 * mode it writes to `.fake/` and sets NO real secret; otherwise it orchestrates
 * the required secrets through the provider seam. Returns a structured result.
 */
export async function installCI(
	options: InstallCIOptions,
): Promise<InstallCIResult> {
	const log = options.log ?? ((line: string) => console.log(line));
	const fake = options.fake ?? false;

	// 1. Resolve the config: the config-file path (no prompts) or the wizard.
	let file: CIConfigFile;
	let knownSecrets: Record<string, string> | undefined;
	if (options.configFile) {
		file = loadCIConfigFile(options.configFile);
		knownSecrets = file.secrets;
	} else {
		if (!options.prompts) {
			throw new Error(
				'install-ci: an interactive run needs a prompt seam (or pass --config)',
			);
		}
		file = await runWizard(options.prompts);
	}
	const config = resolveCIConfig(file);

	// 2. --export-config: round-trip the gathered config back to JSON and exit.
	if (options.exportConfig) {
		let secrets: Record<string, string> | undefined;
		if (options.includeSecrets) {
			secrets = await gatherSecretsForExport(file, options.prompts);
		}
		writeFileSync(
			options.exportConfig,
			exportCIConfig(config, secrets),
			'utf8',
		);
		log(`Config written to ${options.exportConfig}`);
		return {outcome: 'exported', config, written: [], secrets: []};
	}

	// 3. Orchestrate secrets — SKIPPED in --fake mode (no real secret touched).
	let secrets: SecretSetResult[] = [];
	if (fake) {
		log('--fake: skipping secret setup (no real secret is set)');
	} else {
		secrets = await orchestrateSecrets({
			ctx: options.ctx,
			config,
			knownSecrets,
			prompt: options.prompts
				? (name) =>
						options.prompts!.password(`Enter the value for secret ${name}:`)
				: undefined,
		});
		for (const r of secrets) {
			if (r.status === 'set') log(`  secret ${r.name}: set`);
			else if (r.status === 'skipped')
				log(`  secret ${r.name}: skipped (empty)`);
			else log(`  secret ${r.name}: FAILED (${r.error})`);
		}
	}

	// 4. Optionally offer the GitHub delete_branch_on_merge repo-setting (the
	//    capability-F residue): ONLY when offered + confirmed, NEVER silent.
	if (
		!fake &&
		options.prompts &&
		options.ctx.setRepoSetting &&
		options.ctx.repo
	) {
		const wanted = await options.prompts.confirm(
			"Enable GitHub's 'Automatically delete head branches' (delete_branch_on_merge)?",
			{default: false},
		);
		if (wanted) {
			try {
				await options.ctx.setRepoSetting('delete_branch_on_merge', true);
				log('  repo setting delete_branch_on_merge: enabled');
			} catch (err) {
				log(
					`  repo setting delete_branch_on_merge: FAILED (${
						err instanceof Error ? err.message : String(err)
					})`,
				);
			}
		}
	}

	// 5. Assemble + write the artifacts (composite setup action + auth).
	const files = buildSetupArtifacts(config, options.capabilities ?? []);
	const written = writeArtifacts({workDir: options.ctx.workDir, fake, files});
	for (const path of written) {
		log(`  wrote ${path}`);
	}
	return {outcome: 'generated', config, written, secrets};
}

/**
 * Gather the secret values for `--include-secrets` (the export path): take known
 * values from the loaded file, else prompt. Returns the deduped name→value map.
 */
async function gatherSecretsForExport(
	file: CIConfigFile,
	prompts: WizardPrompts | undefined,
): Promise<Record<string, string>> {
	const config = resolveCIConfig(file);
	const secrets: Record<string, string> = {...(file.secrets ?? {})};
	if (!prompts) {
		return secrets;
	}
	const {requiredSecretNames} = await import('./install-ci-core.js');
	for (const name of requiredSecretNames(config)) {
		if (secrets[name] !== undefined) continue;
		const value = await prompts.password(`Enter the value for secret ${name}:`);
		if (value) secrets[name] = value;
	}
	return secrets;
}

// ─── The interactive wizard ──────────────────────────────────────────────────

/**
 * The interactive wizard: gather the auth mode, providers/models (models-json) or
 * the default provider/model (auth-json), and the harness, into a
 * {@link CIConfigFile}. Drives the {@link WizardPrompts} seam, so it runs
 * deterministically in tests and the gathered shape exactly equals a config-file
 * input — the equivalence the snapshot test pins. Mirrors whitesmith's prompt
 * flow (provider type → key env var → models → defaults).
 */
export async function runWizard(prompts: WizardPrompts): Promise<CIConfigFile> {
	const authMode = await prompts.select<AuthMode>('Auth mode:', [
		{
			name: 'models.json (default — one GitHub secret per provider key)',
			value: 'models-json',
		},
		{
			name: 'auth.json (single PI_AUTH_JSON + GH_PAT + OAuth refresh — the sharp edge)',
			value: 'auth-json',
		},
	]);

	const harness = await prompts.select<HarnessAdapter>('Agent harness:', [
		{name: 'pi (the pi coding agent)', value: 'pi'},
		{name: 'null (shell out to a configured agentCmd)', value: 'null'},
	]);

	if (authMode === 'auth-json') {
		// auth.json mode: no per-provider keys, but the harness still needs a
		// default provider/model for its invocations.
		const defaultProvider = await prompts.input('Default AI provider:', {
			default: 'anthropic',
		});
		const defaultModel = await prompts.input('Default AI model:', {
			default: 'claude-sonnet-4-20250514',
		});
		return {
			authMode,
			providers: [],
			defaultProvider,
			defaultModel,
			harness,
		};
	}

	const providers = await promptProviders(prompts);
	const {defaultProvider, defaultModel} = await promptDefaults(
		prompts,
		providers,
	);
	return {authMode, providers, defaultProvider, defaultModel, harness};
}

/** Prompt for one or more providers (the models-json path). */
async function promptProviders(
	prompts: WizardPrompts,
): Promise<ProviderEntry[]> {
	const providers: ProviderEntry[] = [];
	let addMore = true;
	while (addMore) {
		const type = await prompts.select(
			providers.length === 0 ? 'Add a provider:' : 'Add another provider:',
			[
				{name: 'Anthropic (built-in, needs API key)', value: 'anthropic'},
				{name: 'OpenAI (built-in, needs API key)', value: 'openai'},
				{name: 'Custom provider', value: 'custom'},
			],
		);
		providers.push(
			type === 'custom'
				? await promptCustomProvider(prompts)
				: await promptBuiltinProvider(prompts, type as 'anthropic' | 'openai'),
		);
		addMore = await prompts.confirm('Add another provider?', {default: false});
	}
	return providers;
}

/** Prompt for a built-in provider (`anthropic` / `openai`). */
async function promptBuiltinProvider(
	prompts: WizardPrompts,
	type: 'anthropic' | 'openai',
): Promise<ProviderEntry> {
	const defaultEnvVar =
		type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
	const defaultModel =
		type === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
	const apiKeyEnvVar = await prompts.input(
		'GitHub secret name for the API key:',
		{
			default: defaultEnvVar,
		},
	);
	const baseUrl = await prompts.input('Custom base URL (blank for default):');
	const models = await promptModels(prompts, defaultModel);
	return {
		name: type,
		baseUrl: baseUrl || undefined,
		apiKeyEnvVar,
		models,
		builtin: true,
	};
}

/** Prompt for a custom provider. */
async function promptCustomProvider(
	prompts: WizardPrompts,
): Promise<ProviderEntry> {
	const name = await prompts.input('Provider name:');
	const baseUrl = await prompts.input('Base URL:');
	const api = await prompts.select('API type:', [
		{name: 'Anthropic Messages API', value: 'anthropic-messages'},
		{name: 'OpenAI Completions API', value: 'openai-completions'},
	]);
	const apiKeyEnvVar = await prompts.input(
		'GitHub secret name for the API key:',
	);
	let compat: Record<string, boolean> | undefined;
	if (api === 'openai-completions') {
		const supportsDeveloperRole = await prompts.confirm(
			'Does this provider support the developer role?',
			{default: true},
		);
		const supportsReasoningEffort = await prompts.confirm(
			'Does this provider support reasoning effort?',
			{default: true},
		);
		if (!supportsDeveloperRole || !supportsReasoningEffort) {
			compat = {supportsDeveloperRole, supportsReasoningEffort};
		}
	}
	const models = await promptModels(prompts);
	return {name, baseUrl, api, apiKeyEnvVar, models, builtin: false, compat};
}

/** Prompt for one or more model ids. */
async function promptModels(
	prompts: WizardPrompts,
	firstDefault?: string,
): Promise<{id: string}[]> {
	const models: {id: string}[] = [];
	let addModel = true;
	while (addModel) {
		const id = await prompts.input(
			models.length === 0 ? 'Model ID:' : 'Another model ID:',
			models.length === 0 && firstDefault ? {default: firstDefault} : undefined,
		);
		models.push({id});
		addModel = await prompts.confirm('Add another model?', {default: false});
	}
	return models;
}

/** Prompt for the default provider + model (skips the prompt when only one). */
async function promptDefaults(
	prompts: WizardPrompts,
	providers: ProviderEntry[],
): Promise<{defaultProvider: string; defaultModel: string}> {
	const defaultProvider =
		providers.length === 1
			? providers[0].name
			: await prompts.select(
					'Default provider:',
					providers.map((p) => ({name: p.name, value: p.name})),
				);
	const selected = providers.find((p) => p.name === defaultProvider)!;
	const defaultModel =
		selected.models.length === 1
			? selected.models[0].id
			: await prompts.select(
					'Default model:',
					selected.models.map((m) => ({name: m.id, value: m.id})),
				);
	return {defaultProvider, defaultModel};
}

/** Re-export the default harness for callers building a config programmatically. */
export {DEFAULT_HARNESS};

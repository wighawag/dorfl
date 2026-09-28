import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	type InstallSource,
	type ProviderEntry,
	type ResolvedCIConfig,
	buildModelsJson,
	generateSetupAction,
	modelsJsonEnvRef,
} from '../src/install-ci-core.js';

/**
 * `generated-models-json-references-the-key-env-var`: the `models.json` that
 * `install-ci` writes must reference each provider key as an env var the PINNED
 * pi harness actually resolves. Writing the bare env-var NAME made pi send the
 * literal string `ANTHROPIC_API_KEY` as the token (`401 Unauthorized` on every
 * CI launch, intake runs on issue #426).
 */

/**
 * A faithful port of the pinned harness's config-value resolution
 * (`@earendil-works/pi-coding-agent@0.80.6`, `dist/core/resolve-config-value.js`,
 * `parseConfigValueReference` + `parseConfigValueTemplate` + `resolveTemplate`):
 *   - a value starting with `!` is a SHELL COMMAND (not modelled: we never emit one);
 *   - otherwise it is a TEMPLATE where `$NAME` / `${NAME}` is an env-var
 *     reference, `$$` / `$!` escape to a literal `$` / `!`, and ANYTHING ELSE IS
 *     A LITERAL;
 *   - a template whose referenced env var is unset/empty resolves to `undefined`.
 * If the harness pin moves, re-read that file and update this port.
 */
function resolvePiConfigValue(
	config: string,
	env: Record<string, string | undefined>,
): string | undefined {
	if (config.startsWith('!')) {
		throw new Error('shell-command config values are not modelled');
	}
	const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
	const NAME_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
	let out = '';
	let i = 0;
	while (i < config.length) {
		const d = config.indexOf('$', i);
		if (d < 0) {
			out += config.slice(i);
			break;
		}
		out += config.slice(i, d);
		const next = config[d + 1];
		if (next === '$' || next === '!') {
			out += next;
			i = d + 2;
			continue;
		}
		if (next === '{') {
			const end = config.indexOf('}', d + 2);
			if (end < 0) {
				out += '$';
				i = d + 1;
				continue;
			}
			const name = config.slice(d + 2, end);
			if (NAME_RE.test(name)) {
				const v = env[name] || undefined;
				if (v === undefined) return undefined;
				out += v;
			} else {
				out += config.slice(d, end + 1);
			}
			i = end + 1;
			continue;
		}
		const m = config.slice(d + 1).match(NAME_PREFIX_RE);
		if (m) {
			const v = env[m[0]] || undefined;
			if (v === undefined) return undefined;
			out += v;
			i = d + 1 + m[0].length;
			continue;
		}
		out += '$';
		i = d + 1;
	}
	return out;
}

/** Every provider shape the generators write. */
const PROVIDERS: ProviderEntry[] = [
	{
		name: 'anthropic',
		apiKeyEnvVar: 'ANTHROPIC_API_KEY',
		models: [{id: 'claude-sonnet-4-20250514'}],
		builtin: true,
	},
	{
		name: 'openai',
		baseUrl: 'https://proxy.example.com/v1',
		apiKeyEnvVar: 'OPENAI_API_KEY',
		models: [{id: 'gpt-4o'}],
		builtin: true,
	},
	{
		name: 'local',
		baseUrl: 'http://localhost:8080',
		api: 'openai-completions',
		apiKeyEnvVar: 'LOCAL_KEY',
		models: [{id: 'llama'}],
		compat: {supportsDeveloperRole: false},
		builtin: false,
	},
];

function config(installSource: InstallSource): ResolvedCIConfig {
	return {
		authMode: 'models-json',
		providers: PROVIDERS,
		defaultProvider: 'anthropic',
		defaultModel: 'claude-sonnet-4-20250514',
		harness: 'pi',
		installSource,
		maxParallel: 2,
	};
}

/**
 * Extract the `models.json` the composite action writes from its quoted heredoc
 * (`<< 'MODELS_EOF'`, so bash does NOT expand the `$` references: pi reads them).
 */
function renderedModelsJson(action: string): {
	providers: Record<string, {apiKey: string}>;
} {
	const open = "cat > ~/.pi/agent/models.json << 'MODELS_EOF'\n";
	const start = action.indexOf(open);
	expect(start).toBeGreaterThanOrEqual(0);
	const body = action.slice(start + open.length);
	const end = body.indexOf('\n        MODELS_EOF');
	expect(end).toBeGreaterThanOrEqual(0);
	return JSON.parse(body.slice(0, end));
}

describe('models.json references each provider key as $ENV_VAR', () => {
	it('modelsJsonEnvRef emits the $NAME form', () => {
		expect(modelsJsonEnvRef('ANTHROPIC_API_KEY')).toBe('$ANTHROPIC_API_KEY');
	});

	it('buildModelsJson: every provider shape (builtin, builtin+baseUrl, custom) carries $<ENV_VAR>', () => {
		const json = buildModelsJson(PROVIDERS) as {
			providers: Record<string, {apiKey: string}>;
		};
		for (const p of PROVIDERS) {
			expect(json.providers[p.name].apiKey).toBe(`$${p.apiKeyEnvVar}`);
		}
	});

	for (const installSource of ['registry', 'workspace'] as const) {
		it(`the ${installSource}-mode composite action writes $<ENV_VAR> for every provider, in a non-expanding heredoc`, () => {
			const action = generateSetupAction(config(installSource));
			const json = renderedModelsJson(action);
			expect(Object.keys(json.providers)).toEqual(PROVIDERS.map((p) => p.name));
			for (const p of PROVIDERS) {
				expect(json.providers[p.name].apiKey).toBe(`$${p.apiKeyEnvVar}`);
			}
		});
	}

	it('resolved the way pi 0.80.6 does, the generated apiKey yields the env VALUE, not the name', () => {
		const env = {
			ANTHROPIC_API_KEY: 'sk-ant-secret',
			OPENAI_API_KEY: 'sk-openai-secret',
			LOCAL_KEY: 'local-secret',
		};
		const json = renderedModelsJson(generateSetupAction(config('registry')));
		expect(resolvePiConfigValue(json.providers.anthropic.apiKey, env)).toBe(
			'sk-ant-secret',
		);
		expect(resolvePiConfigValue(json.providers.openai.apiKey, env)).toBe(
			'sk-openai-secret',
		);
		expect(resolvePiConfigValue(json.providers.local.apiKey, env)).toBe(
			'local-secret',
		);
		// The regression: a bare name is a LITERAL to pi, so it was sent as the token.
		expect(resolvePiConfigValue('ANTHROPIC_API_KEY', env)).toBe(
			'ANTHROPIC_API_KEY',
		);
		// An unset key resolves to nothing (pi reports it missing) rather than the name.
		expect(
			resolvePiConfigValue(json.providers.anthropic.apiKey, {}),
		).toBeUndefined();
	});

	it("this repository's committed dorfl-setup action references its provider key(s) as $ENV_VAR", () => {
		const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
		const action = readFileSync(
			join(repoRoot, '.github/actions/dorfl-setup/action.yml'),
			'utf8',
		);
		const json = renderedModelsJson(action);
		const keys = Object.values(json.providers).map((p) => p.apiKey);
		expect(keys.length).toBeGreaterThan(0);
		for (const k of keys) expect(k).toMatch(/^\$[A-Za-z_][A-Za-z0-9_]*$/);
	});
});

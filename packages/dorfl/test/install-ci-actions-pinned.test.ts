import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {
	buildSetupArtifacts,
	loadCapabilityRegistry,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';

/**
 * SUPPLY-CHAIN guard for everything `dorfl install-ci` generates: every
 * third-party action must be referenced by a full 40-character commit SHA
 * (GitHub's "Security hardening for GitHub Actions" guidance). A tag such as
 * `@v5` can be moved by whoever controls the action's repository, and these
 * jobs hold `contents: write` and a provider API key.
 *
 * The check PARSES the YAML (no regex over the text) and walks every mapping:
 * any key named `uses` whose value is a string is checked. Local references
 * (`./...`) are exempt: they resolve inside the consumer's own checkout. The
 * trailing `# vX.Y.Z` comment is dropped by the parser, so the value checked is
 * exactly `owner/repo[/path]@<ref>`.
 */

/** A `uses:` value that is not pinned to a full commit SHA. */
interface Violation {
	file: string;
	path: string;
	uses: string;
}

/** `owner/repo[/path]@<40 lowercase hex>`, the only accepted remote form. */
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

/** Walk a parsed YAML document, collecting every remote `uses:` not SHA-pinned. */
function findUnpinnedUses(file: string, doc: unknown): Violation[] {
	const out: Violation[] = [];
	const walk = (node: unknown, path: string): void => {
		if (Array.isArray(node)) {
			node.forEach((child, i) => walk(child, `${path}[${i}]`));
			return;
		}
		if (node !== null && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				const childPath = path === '' ? key : `${path}.${key}`;
				if (key === 'uses' && typeof value === 'string') {
					if (!value.startsWith('./') && !PINNED.test(value)) {
						out.push({file, path: childPath, uses: value});
					}
				}
				walk(value, childPath);
			}
		}
	};
	walk(doc, '');
	return out;
}

const PROVIDERS: ResolvedCIConfig['providers'] = [
	{
		name: 'anthropic',
		apiKeyEnvVar: 'ANTHROPIC_API_KEY',
		models: [{id: 'claude-sonnet-4-20250514'}],
		builtin: true,
	},
	{
		name: 'openai',
		apiKeyEnvVar: 'OPENAI_API_KEY',
		models: [{id: 'gpt-4o'}],
		builtin: true,
	},
];

const BASE: ResolvedCIConfig = {
	authMode: 'models-json',
	providers: PROVIDERS,
	defaultProvider: 'anthropic',
	defaultModel: 'claude-sonnet-4-20250514',
	harness: 'pi',
	installSource: 'registry',
	maxParallel: 2,
};

/**
 * Every config shape that changes what the generators emit (the same matrix the
 * script-injection guard covers): both auth modes, both install sources (the
 * workspace mode adds `pnpm/action-setup`), every repo visibility, a non-default
 * matrix cap, and a project-setup hook fragment that carries no `uses:` of its
 * own (the hook is consumer-authored; dorfl only guarantees its own defaults).
 */
const CONFIGS: {name: string; config: ResolvedCIConfig; hook?: string}[] = [
	{name: 'models-json/registry', config: BASE},
	{
		name: 'models-json/workspace',
		config: {...BASE, installSource: 'workspace'},
	},
	{
		name: 'auth-json/registry',
		config: {...BASE, authMode: 'auth-json', providers: []},
	},
	{
		name: 'auth-json/workspace',
		config: {
			...BASE,
			authMode: 'auth-json',
			providers: [],
			installSource: 'workspace',
		},
	},
	{name: 'public', config: {...BASE, repoVisibility: 'public'}},
	{name: 'private', config: {...BASE, repoVisibility: 'private'}},
	{name: 'internal', config: {...BASE, repoVisibility: 'internal'}},
	{name: 'maxParallel 5', config: {...BASE, maxParallel: 5}},
	{
		name: 'with project-setup hook',
		config: BASE,
		hook:
			'    - name: Install project deps\n' +
			'      shell: bash\n' +
			'      run: pnpm install --frozen-lockfile --ignore-scripts\n',
	},
];

async function generateEverything(): Promise<
	{file: string; content: string}[]
> {
	const caps = await loadCapabilityRegistry();
	const out: {file: string; content: string}[] = [];
	for (const {name, config, hook} of CONFIGS) {
		for (const f of buildSetupArtifacts(config, caps, {
			projectSetupSteps: hook,
		})) {
			if (/\.ya?ml$/.test(f.path)) {
				out.push({file: `${name}: ${f.path}`, content: f.content});
			}
		}
	}
	return out;
}

describe('install-ci: every generated `uses:` is pinned to a full commit SHA', () => {
	it('the checker itself flags tags, short SHAs and uppercase, and exempts local actions', () => {
		const doc = parse(
			[
				'runs:',
				'  steps:',
				'    - uses: actions/checkout@v5',
				'    - uses: actions/checkout@3d3c42e', // short SHA
				'    - uses: actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1',
				'    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
				'    - uses: github/codeql-action/init@3d3c42e5aac5ba805825da76410c181273ba90b1',
				'    - uses: ./.github/actions/dorfl-setup',
			].join('\n'),
		);
		expect(findUnpinnedUses('t', doc).map((v) => v.uses)).toEqual([
			'actions/checkout@v5',
			'actions/checkout@3d3c42e',
			'actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1',
		]);
	});

	it('covers every generated workflow + the composite setup action, and finds remote actions in them', async () => {
		const files = await generateEverything();
		const paths = new Set(files.map((f) => f.file.replace(/^[^:]*: /, '')));
		// Guard against the walk silently checking nothing.
		for (const expected of [
			join('actions', 'dorfl-setup', 'action.yml'),
			'workflows/advance-lifecycle.yml',
			'workflows/intake.yml',
			'workflows/close-job.yml',
			'workflows/verify.yml',
		]) {
			expect(paths.has(expected)).toBe(true);
		}
		// And the walk does see the remote actions (so an empty result below is
		// a real pass, not an empty haystack).
		const all = files.flatMap(({content}) =>
			JSON.stringify(parse(content)).match(/"uses":"[^".][^"]*"/g),
		);
		const remotes = new Set(
			all.map((u) => (u ?? '').replace(/^"uses":"/, '').split('@')[0]),
		);
		expect([...remotes].sort()).toEqual([
			'actions/checkout',
			'actions/setup-node',
			'pnpm/action-setup',
		]);
	});

	it('no generated `uses:` references a tag, branch or short SHA', async () => {
		const violations: Violation[] = [];
		for (const {file, content} of await generateEverything()) {
			violations.push(...findUnpinnedUses(file, parse(content)));
		}
		expect(violations).toEqual([]);
	});

	it('the seed template docs/ci/advance-loop.yml.template follows the same rule', () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const seed = readFileSync(
			join(here, '..', '..', '..', 'docs', 'ci', 'advance-loop.yml.template'),
			'utf8',
		);
		expect(findUnpinnedUses('advance-loop.yml.template', parse(seed))).toEqual(
			[],
		);
	});
});

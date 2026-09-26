import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmrf} from './helpers/gitRepo.js';
import {
	exportCIConfig,
	loadCapabilityRegistry,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';

/**
 * Regeneration must never downgrade or unpin a reference the consumer repository
 * already pinned. Dependabot (or a human) moves a `uses:` line to a newer SHA and
 * rewrites its `# vX.Y.Z` comment; re-running `dorfl install-ci` must keep that
 * line byte for byte instead of putting dorfl's default back.
 */

const CONFIG: ResolvedCIConfig = {
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
	maxParallel: 2,
};

/** A SHA no dorfl default uses, standing in for a Dependabot bump. */
const BUMPED_SHA = 'a'.repeat(8) + '0123456789abcdef0123456789abcdef';

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'install-ci-pins-'));
});
afterEach(() => {
	rmrf(work);
});

async function generate(config: ResolvedCIConfig = CONFIG): Promise<void> {
	const file = join(work, 'ci.json');
	writeFileSync(file, exportCIConfig(config, {ANTHROPIC_API_KEY: 'sk'}));
	await installCI({
		ctx: new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		}),
		configFile: file,
		capabilities: await loadCapabilityRegistry(),
		log: () => {},
	});
}

function read(rel: string): string {
	return readFileSync(join(work, '.github', rel), 'utf8');
}

/** Replace the first line matching `re` with `line`; fail loudly if none does. */
function rewriteLine(rel: string, re: RegExp, line: string): string {
	const lines = read(rel).split('\n');
	const i = lines.findIndex((l) => re.test(l));
	expect(i, `no line matching ${re} in ${rel}`).toBeGreaterThanOrEqual(0);
	lines[i] = line;
	const text = lines.join('\n');
	writeFileSync(join(work, '.github', rel), text);
	return text;
}

describe('install-ci regeneration preserves the consumer’s SHA pins', () => {
	it('a Dependabot-style bump of a workflow `uses:` line survives byte for byte', async () => {
		await generate();
		const bumpedLine = `      - uses: actions/checkout@${BUMPED_SHA} # v7.9.9`;
		const edited = rewriteLine(
			'workflows/verify.yml',
			/^\s+- uses: actions\/checkout@/,
			bumpedLine,
		);

		await generate();

		const after = read('workflows/verify.yml');
		expect(after.split('\n')).toContain(bumpedLine);
		// Nothing else moved: the whole file is exactly what the consumer had.
		expect(after).toBe(edited);
	});

	it('a bump in the composite action survives, and applies to every step using that action', async () => {
		await generate({
			...CONFIG,
			projectSetup: {
				github:
					'- name: Setup Node for pnpm\n' +
					`  uses: actions/setup-node@${'b'.repeat(40)} # v7.0.0\n` +
					"  with:\n    node-version: '22'\n",
			},
		} as ResolvedCIConfig);
		const rel = join('actions', 'dorfl-setup', 'action.yml');
		const bumped = `      uses: actions/setup-node@${BUMPED_SHA} # v7.1.0`;
		// Dependabot rewrites every occurrence of the action in the file.
		const text = read(rel).replace(
			/^ {6}uses: actions\/setup-node@.*$/gm,
			bumped,
		);
		writeFileSync(join(work, '.github', rel), text);

		await generate({
			...CONFIG,
			projectSetup: {
				github:
					'- name: Setup Node for pnpm\n' +
					`  uses: actions/setup-node@${'b'.repeat(40)} # v7.0.0\n` +
					"  with:\n    node-version: '22'\n",
			},
		} as ResolvedCIConfig);

		expect(read(rel)).toBe(text);
	});

	it('a bumped line in one job is kept even though the file has several steps using the action', async () => {
		await generate();
		const rel = 'workflows/advance-lifecycle.yml';
		const bumpedLine = `      - uses: actions/checkout@${BUMPED_SHA} # v7.9.9`;
		rewriteLine(rel, /^\s+- uses: actions\/checkout@/, bumpedLine);

		await generate();

		expect(read(rel).split('\n')).toContain(bumpedLine);
	});

	it('never replaces an existing SHA with a tag (a project-setup snippet that uses a tag)', async () => {
		const withTag = {
			...CONFIG,
			projectSetup: {
				github: '- name: Enable pnpm\n  uses: pnpm/action-setup@v6\n',
			},
		} as ResolvedCIConfig;
		await generate(withTag);
		const rel = join('actions', 'dorfl-setup', 'action.yml');
		const pinned = `      uses: pnpm/action-setup@${BUMPED_SHA} # v6.1.0`;
		const edited = rewriteLine(rel, /^\s+uses: pnpm\/action-setup@v6$/, pinned);

		await generate(withTag);

		expect(read(rel)).toBe(edited);
	});

	it('replaces an existing tag with dorfl’s SHA (a tag is not a pin)', async () => {
		await generate();
		const rel = 'workflows/close-job.yml';
		rewriteLine(
			rel,
			/^\s+- uses: actions\/checkout@/,
			'      - uses: actions/checkout@v4',
		);

		await generate();

		const line = read(rel)
			.split('\n')
			.find((l) => /^\s+- uses: actions\/checkout@/.test(l));
		expect(line).toMatch(/^ {6}- uses: actions\/checkout@[0-9a-f]{40} # v\d/);
	});
});

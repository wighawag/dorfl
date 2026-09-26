import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {rmrf} from './helpers/gitRepo.js';
import {
	loadCapabilityRegistry,
	parseRepoVisibility,
	shouldDropCheckoutCredentials,
	type RepoVisibility,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';
import {
	CLOSE_JOB_CAPABILITY_ID,
	generateCloseJobWorkflow,
} from '../src/close-job-template.js';
import {
	VERIFY_CAPABILITY_ID,
	generateVerifyWorkflow,
} from '../src/verify-workflow-template.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';

/**
 * `persist-credentials: false` on the read-only jobs (verify, close-job) is
 * emitted ONLY when install-ci KNOWS the repo is public. Those jobs hold
 * `contents: read`, so the persisted token can only read, and on a public repo
 * reads need no token: dropping it cannot break a fetch. On a private/internal
 * repo, or when visibility is unknown, a `git fetch` in the project's gate or
 * project-setup hook may need the token, so the checkout stays as it was.
 */

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
	installSource: 'registry',
	maxParallel: 2,
};

type Step = {uses?: string; with?: Record<string, unknown>};

/** The `with:` of every `actions/checkout` step in a workflow. */
function checkoutWiths(text: string): Record<string, unknown>[] {
	const doc = parse(text) as {jobs: Record<string, {steps: Step[]}>};
	return Object.values(doc.jobs).flatMap((job) =>
		job.steps
			.filter((s) => s.uses?.startsWith('actions/checkout@'))
			.map((s) => s.with ?? {}),
	);
}

describe('parseRepoVisibility / shouldDropCheckoutCredentials', () => {
	it('parses the provider answer case-insensitively; anything else is unknown', () => {
		expect(parseRepoVisibility('PUBLIC\n')).toBe('public');
		expect(parseRepoVisibility('private')).toBe('private');
		expect(parseRepoVisibility('INTERNAL')).toBe('internal');
		expect(parseRepoVisibility('')).toBeUndefined();
		expect(parseRepoVisibility('secret')).toBeUndefined();
	});

	it('drops the checkout credentials ONLY for a known-public repo', () => {
		expect(shouldDropCheckoutCredentials({repoVisibility: 'public'})).toBe(
			true,
		);
		for (const v of ['private', 'internal', undefined] as const) {
			expect(shouldDropCheckoutCredentials({repoVisibility: v})).toBe(false);
		}
	});
});

describe.each([
	['verify', generateVerifyWorkflow],
	['close-job', generateCloseJobWorkflow],
] as const)('%s workflow checkout', (_name, generate) => {
	it('public ⇒ persist-credentials: false (and fetch-depth: 0 kept)', () => {
		const withs = checkoutWiths(
			generate({...config, repoVisibility: 'public'}),
		);
		expect(withs).toHaveLength(1);
		expect(withs[0]).toEqual({'fetch-depth': 0, 'persist-credentials': false});
	});

	it.each([['private'], ['internal'], [undefined]] as const)(
		'%s ⇒ the checkout is unchanged (token persisted, fetch-depth: 0)',
		(visibility) => {
			const text = generate({
				...config,
				repoVisibility: visibility as RepoVisibility | undefined,
			});
			expect(checkoutWiths(text)).toEqual([{'fetch-depth': 0}]);
			// Byte-identical to the no-visibility output: unknown stays conservative.
			expect(text).toBe(generate(config));
		},
	);
});

describe('installCI detects visibility through the provider seam', () => {
	let work: string;
	beforeEach(() => {
		work = mkdtempSync(join(tmpdir(), 'install-ci-visibility-'));
	});
	afterEach(() => {
		rmrf(work);
	});

	async function run(
		visibility: RepoVisibility | undefined,
	): Promise<{verify: string; closeJob: string}> {
		const caps = (await loadCapabilityRegistry()).filter(
			(c) => c.id === VERIFY_CAPABILITY_ID || c.id === CLOSE_JOB_CAPABILITY_ID,
		);
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			visibility,
		});
		const configFile = join(work, 'ci.json');
		writeFileSync(
			configFile,
			JSON.stringify({
				authMode: config.authMode,
				providers: config.providers,
				defaultProvider: config.defaultProvider,
				defaultModel: config.defaultModel,
			}),
		);
		await installCI({
			ctx,
			configFile,
			fake: true,
			capabilities: caps,
			log: () => {},
		});
		return {
			verify: readFileSync(join(work, '.fake/workflows/verify.yml'), 'utf8'),
			closeJob: readFileSync(
				join(work, '.fake/workflows/close-job.yml'),
				'utf8',
			),
		};
	}

	it('public repo ⇒ both read-only jobs drop the persisted token', async () => {
		const {verify, closeJob} = await run('public');
		expect(checkoutWiths(verify)[0]).toHaveProperty(
			'persist-credentials',
			false,
		);
		expect(checkoutWiths(closeJob)[0]).toHaveProperty(
			'persist-credentials',
			false,
		);
	});

	it('private or unknown repo ⇒ checkout unchanged', async () => {
		for (const v of ['private', undefined] as const) {
			const {verify, closeJob} = await run(v);
			expect(checkoutWiths(verify)).toEqual([{'fetch-depth': 0}]);
			expect(checkoutWiths(closeJob)).toEqual([{'fetch-depth': 0}]);
		}
	});
});

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportCIConfig, type ResolvedCIConfig} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';

/**
 * `document-that-bot-opened-prs-need-approval`: install-ci's closing summary
 * says that PRs opened with GITHUB_TOKEN get their verify run held in
 * `action_required` until approved, when no DORFL_GH_TOKEN was configured, and
 * that intake PRs always need the approval. Through the in-memory CI context:
 * NO real GitHub API call, NO network, NO real `gh`.
 */

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'install-ci-pr-approval-'));
});
afterEach(() => {
	rmrf(work);
});

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

function configFile(secrets: Record<string, string>): string {
	const f = join(work, 'ci.json');
	writeFileSync(f, exportCIConfig(config, secrets));
	return f;
}

async function run(
	secrets: Record<string, string>,
	fake = false,
): Promise<{output: string; ctx: MemoryCIProviderContext}> {
	const lines: string[] = [];
	const ctx = new MemoryCIProviderContext({workDir: work, repo: 'o/r'});
	await installCI({
		ctx,
		fake,
		configFile: configFile(secrets),
		log: (line) => lines.push(line),
	});
	return {output: lines.join('\n'), ctx};
}

describe('install-ci closing summary: bot-opened PRs need an approval', () => {
	it('mentions the approval and recommends DORFL_GH_TOKEN when it was not set', async () => {
		const {output, ctx} = await run({ANTHROPIC_API_KEY: 'sk'});
		expect(ctx.secrets.has('DORFL_GH_TOKEN')).toBe(false);
		expect(output).toMatch(/no DORFL_GH_TOKEN was set in this run/);
		expect(output).toMatch(/action_required/);
		expect(output).toMatch(
			/advance PRs \(build, tasking\): set DORFL_GH_TOKEN/,
		);
		expect(output).toMatch(/intake PRs always need it/);
		expect(output).toMatch(/Approve workflows to run/);
	});

	it('mentions it under --fake too, where no secret is set', async () => {
		const {output} = await run(
			{ANTHROPIC_API_KEY: 'sk', DORFL_GH_TOKEN: 'ghp'},
			true,
		);
		expect(output).toMatch(/no DORFL_GH_TOKEN was set in this run/);
	});

	it('keeps only the intake note when DORFL_GH_TOKEN was set', async () => {
		const {output, ctx} = await run({
			ANTHROPIC_API_KEY: 'sk',
			DORFL_GH_TOKEN: 'ghp',
		});
		expect(ctx.secrets.get('DORFL_GH_TOKEN')).toBe('ghp');
		expect(output).not.toMatch(/no DORFL_GH_TOKEN was set/);
		expect(output).toMatch(/DORFL_GH_TOKEN is set, so advance PRs trigger/);
		expect(output).toMatch(/intake PRs always need it/);
	});
});

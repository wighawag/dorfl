import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportCIConfig, type ResolvedCIConfig} from '../src/install-ci-core.js';
import {
	MemoryCIProviderContext,
	parseActionsWorkflowPermissions,
} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';
import {
	formatManualActionsPrCreationCommand,
	installCIActionsPrCreationStep,
} from '../src/install-ci-actions-pr-creation.js';

/**
 * `install-ci-enables-actions-pr-creation`: install-ci reads "Allow GitHub
 * Actions to create and approve pull requests" and, when it is off, enables it
 * (admin) or prints the exact command (non-admin), keeping
 * `default_workflow_permissions`. Tests go through the in-memory CI context:
 * NO real GitHub API call, NO network, NO real `gh`.
 */

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'install-ci-apr-'));
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

function configFile(): string {
	const f = join(work, 'ci.json');
	writeFileSync(f, exportCIConfig(config, {ANTHROPIC_API_KEY: 'sk'}));
	return f;
}

function capture(): {log: (line: string) => void; lines: string[]} {
	const lines: string[] = [];
	return {log: (line) => lines.push(line), lines};
}

describe('installCIActionsPrCreationStep', () => {
	it('enables the setting when it is off (admin) and reports it, keeping default_workflow_permissions', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'write',
				canApprovePullRequestReviews: false,
			},
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log});
		expect(result.status).toBe('set');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([
			{canApprovePullRequestReviews: true, defaultWorkflowPermissions: 'write'},
		]);
		expect(ctx.actionsWorkflowPermissions).toEqual({
			defaultWorkflowPermissions: 'write',
			canApprovePullRequestReviews: true,
		});
		const out = lines.join('\n');
		expect(out).toMatch(/enabled "Allow GitHub Actions to create and approve/);
		expect(out).toMatch(/default_workflow_permissions kept as write/);
	});

	it('leaves the setting alone when it is already on (no write, even as admin)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: true,
			},
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log});
		expect(result.status).toBe('already-enabled');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
		expect(lines.join('\n')).toMatch(/already on for o\/r/);
	});

	it('prints the exact manual command (keeping the read default) when not admin, and calls nothing', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: false,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log});
		expect(result.status).toBe('instructed');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
		const out = lines.join('\n');
		expect(out).toContain(
			'gh api -X PUT repos/o/r/actions/permissions/workflow -F can_approve_pull_request_reviews=true -f default_workflow_permissions=read',
		);
		expect(out).toContain('https://github.com/o/r/settings/actions');
	});

	it('treats an unknown admin scope as non-admin (instructs, never calls)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
		});
		const result = await installCIActionsPrCreationStep({ctx, log: () => {}});
		expect(result.status).toBe('instructed');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
	});

	it('when the setting cannot be read, a non-admin gets the command WITHOUT default_workflow_permissions (so it is preserved)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: false,
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log});
		expect(result.status).toBe('instructed');
		expect(result.before).toBeUndefined();
		const out = lines.join('\n');
		expect(out).toMatch(/could not read/);
		expect(out).toContain(
			'gh api -X PUT repos/o/r/actions/permissions/workflow -F can_approve_pull_request_reviews=true',
		);
		expect(out).not.toContain('default_workflow_permissions=');
	});

	it('when the setting cannot be read, an admin sets ONLY can_approve_pull_request_reviews', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
		});
		const result = await installCIActionsPrCreationStep({ctx, log: () => {}});
		expect(result.status).toBe('set');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([
			{canApprovePullRequestReviews: true},
		]);
	});

	it('reports a rejected PUT as failed and prints the command to retry by hand', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
			actionsWorkflowPermissionsError: 'HTTP 409: disabled by organization',
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log});
		expect(result.status).toBe('failed');
		expect(result.error).toBe('HTTP 409: disabled by organization');
		const out = lines.join('\n');
		expect(out).toMatch(/FAILED \(HTTP 409: disabled by organization\)/);
		expect(out).toContain(formatManualActionsPrCreationCommand('o/r', 'read'));
	});

	it('--fake reports the step without reading or writing anything', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
		});
		const {log, lines} = capture();
		const result = await installCIActionsPrCreationStep({ctx, log, fake: true});
		expect(result.status).toBe('skipped-fake');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
		expect(lines.join('\n')).toMatch(
			/--fake; would check that "Allow GitHub Actions to create and approve pull requests" is on/,
		);
	});

	it('skips when the repo is unknown', async () => {
		const ctx = new MemoryCIProviderContext({workDir: work, adminScope: true});
		const result = await installCIActionsPrCreationStep({ctx, log: () => {}});
		expect(result.status).toBe('skipped-no-repo');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
	});

	it('skips on a provider that does not implement the seam', async () => {
		const result = await installCIActionsPrCreationStep({
			ctx: {
				workDir: work,
				repo: 'o/r',
				ghAvailable: true,
				setSecret: async () => {},
			},
			log: () => {},
		});
		expect(result.status).toBe('skipped-no-seam');
	});
});

describe('formatManualActionsPrCreationCommand', () => {
	it('passes the known default back unchanged, and omits it when unknown', () => {
		expect(formatManualActionsPrCreationCommand('o/r', 'write')).toBe(
			'gh api -X PUT repos/o/r/actions/permissions/workflow -F can_approve_pull_request_reviews=true -f default_workflow_permissions=write',
		);
		expect(formatManualActionsPrCreationCommand('o/r')).toBe(
			'gh api -X PUT repos/o/r/actions/permissions/workflow -F can_approve_pull_request_reviews=true',
		);
	});
});

describe('parseActionsWorkflowPermissions (the GitHub adapter read)', () => {
	it('parses the GET body', () => {
		expect(
			parseActionsWorkflowPermissions(
				'{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}',
			),
		).toEqual({
			defaultWorkflowPermissions: 'read',
			canApprovePullRequestReviews: false,
		});
	});

	it('returns undefined on an unexpected shape', () => {
		expect(parseActionsWorkflowPermissions('not json')).toBeUndefined();
		expect(parseActionsWorkflowPermissions('null')).toBeUndefined();
		expect(
			parseActionsWorkflowPermissions(
				'{"default_workflow_permissions":"read"}',
			),
		).toBeUndefined();
	});
});

describe('installCI wires the actions-PR-creation step', () => {
	it('enables it on a fresh repo (off, admin) and returns the outcome', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			defaultBranch: 'main',
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
		});
		const result = await installCI({
			ctx,
			configFile: configFile(),
			log: () => {},
		});
		expect(result.actionsPrCreation?.status).toBe('set');
		expect(ctx.actionsWorkflowPermissions).toEqual({
			defaultWorkflowPermissions: 'read',
			canApprovePullRequestReviews: true,
		});
	});

	it('--fake reports it without touching the setting', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'o/r',
			adminScope: true,
			actionsWorkflowPermissions: {
				defaultWorkflowPermissions: 'read',
				canApprovePullRequestReviews: false,
			},
		});
		const result = await installCI({
			ctx,
			fake: true,
			configFile: configFile(),
			log: () => {},
		});
		expect(result.actionsPrCreation?.status).toBe('skipped-fake');
		expect(ctx.actionsWorkflowPermissionsSets).toEqual([]);
	});
});

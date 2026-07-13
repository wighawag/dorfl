import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportCIConfig, type ResolvedCIConfig} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';
import {
	buildBranchProtectionSpec,
	buildBranchProtectionRuleset,
	formatManualBranchProtectionCommand,
	formatManualBranchRulesetCommand,
	installCIBranchProtectionStep,
	BRANCH_PROTECTION_RULESET_NAME,
	DEFAULT_PROTECTED_BRANCH,
	VERIFY_CHECK_CONTEXT,
} from '../src/install-ci-branch-protection.js';
import {
	VERIFY_CHECK_CONTEXT as WORKFLOW_CHECK_CONTEXT,
	VERIFY_WORKFLOW_PATH,
	generateVerifyWorkflow,
	validateVerifyWorkflow,
} from '../src/verify-workflow-template.js';

/**
 * `install-ci-tier1-branch-protection` — auto-configure GitHub branch
 * protection (Tier-1 ceiling) when run with an admin-scoped credential, else
 * print the exact ready-to-run `gh api` command + manual fallback. Tests stub
 * the CI-provider seam ENTIRELY ({@link MemoryCIProviderContext}: scope verdict
 * is a fixture; `setBranchProtection` records to memory) — NO real GitHub API
 * call, NO network, NO real `gh`.
 */

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'install-ci-bp-'));
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

// ─── the context-name diff: the required `context` IS the job name ──────────

describe('the required `context` matches the emitted workflow job name (by construction)', () => {
	it('exports one VERIFY_CHECK_CONTEXT constant the workflow template AND the deadlock-guard ruleset both consume', () => {
		// SINGLE source of truth — re-imported from two modules, asserted equal.
		expect(VERIFY_CHECK_CONTEXT).toBe(WORKFLOW_CHECK_CONTEXT);
		// The required check now lives in the RULESET, not the classic PUT.
		expect(
			buildBranchProtectionRuleset().rules[0].parameters.required_status_checks,
		).toEqual([{context: VERIFY_CHECK_CONTEXT}]);
		expect(buildBranchProtectionSpec().required_status_checks.checks).toEqual(
			[],
		);
	});

	it('the emitted verify.yml declares a job named exactly VERIFY_CHECK_CONTEXT', () => {
		const yml = generateVerifyWorkflow(config);
		// Extract everything after the `jobs:` key, strip blank/comment lines, take
		// the FIRST non-comment job key (2-space indent under `jobs:`).
		const idx = yml.indexOf('\njobs:\n');
		expect(idx).toBeGreaterThan(-1);
		const after = yml.slice(idx + '\njobs:\n'.length);
		const firstJob = after
			.split('\n')
			.find((line) => /^ {2}[a-zA-Z_][\w-]*:/.test(line));
		expect(firstJob).toBeDefined();
		const jobName = firstJob!.match(/^ {2}([a-zA-Z_][\w-]*):/)![1];
		expect(jobName).toBe(VERIFY_CHECK_CONTEXT);
	});

	it('the emitted verify.yml passes its structural validator', () => {
		const yml = generateVerifyWorkflow(config);
		const v = validateVerifyWorkflow(yml);
		expect(v.problems).toEqual([]);
		expect(v.ok).toBe(true);
	});

	it('the workflow lists merge_group as a forward seam (Tier-2 follow-on)', () => {
		const yml = generateVerifyWorkflow(config);
		expect(yml).toMatch(/\bmerge_group\s*:/);
	});

	it('the workflow path is workflows/verify.yml', () => {
		expect(VERIFY_WORKFLOW_PATH).toBe('workflows/verify.yml');
	});
});

// ─── branch-protection spec shape ───────────────────────────────────────────

describe('branch-protection spec is the brief-fixed Tier-1 shape', () => {
	it('base PUT is strict: true with EMPTY checks (required check moved to ruleset); other required fields null', () => {
		const spec = buildBranchProtectionSpec();
		expect(spec.required_status_checks.strict).toBe(true);
		// The required check now lives in the deadlock-guard RULESET, so the
		// classic PUT carries no named check (see module header).
		expect(spec.required_status_checks.checks).toEqual([]);
		// The GitHub PUT REQUIRES these to be present; null = "not configured".
		// install-ci must NOT silently impose review / admin-enforcement / push
		// restrictions the user did not opt into.
		expect(spec.enforce_admins).toBeNull();
		expect(spec.required_pull_request_reviews).toBeNull();
		expect(spec.restrictions).toBeNull();
	});

	it('the deadlock-guard ruleset carries the required check + do_not_enforce_on_create', () => {
		const rs = buildBranchProtectionRuleset();
		expect(rs.name).toBe(BRANCH_PROTECTION_RULESET_NAME);
		expect(rs.enforcement).toBe('active');
		expect(rs.conditions.ref_name.include).toEqual([
			`refs/heads/${DEFAULT_PROTECTED_BRANCH}`,
		]);
		const rule = rs.rules[0];
		expect(rule.type).toBe('required_status_checks');
		expect(rule.parameters.do_not_enforce_on_create).toBe(true);
		expect(rule.parameters.required_status_checks).toEqual([
			{context: VERIFY_CHECK_CONTEXT},
		]);
	});

	it('the ruleset ref_name targets the passed branch, not a hardcoded main', () => {
		const rs = buildBranchProtectionRuleset('master');
		expect(rs.conditions.ref_name.include).toEqual(['refs/heads/master']);
	});

	it('the manual `gh api` PUT command is copy-paste runnable (strict, no named check)', () => {
		const cmd = formatManualBranchProtectionCommand('owner/repo');
		expect(cmd).toContain(
			`repos/owner/repo/branches/${DEFAULT_PROTECTED_BRANCH}/protection`,
		);
		expect(cmd).toContain('gh api -X PUT');
		expect(cmd).toContain('--input -');
		expect(cmd).toContain('"strict":true');
	});

	it('the manual ruleset POST command carries the required check + create-exemption', () => {
		const cmd = formatManualBranchRulesetCommand('owner/repo');
		expect(cmd).toContain('repos/owner/repo/rulesets');
		expect(cmd).toContain('gh api -X POST');
		expect(cmd).toContain('--input -');
		expect(cmd).toContain(`"context":"${VERIFY_CHECK_CONTEXT}"`);
		expect(cmd).toContain('"do_not_enforce_on_create":true');
	});
});

// ─── orchestrator: admin → auto, non-admin → instruct ────────────────────────

describe('installCIBranchProtectionStep: admin auto-configures, non-admin prints fallback', () => {
	it('admin-scoped credential ⇒ calls the seam, records `set`', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('set');
		expect(result.adminScope).toBe(true);
		expect(ctx.branchProtections.get(DEFAULT_PROTECTED_BRANCH)).toEqual(
			buildBranchProtectionSpec(),
		);
		// The deadlock guard is a real ruleset, not just a log line.
		expect(result.rulesetStatus).toBe('set');
		expect(ctx.rulesets).toEqual([buildBranchProtectionRuleset('main')]);
		const joined = lines.join('\n');
		expect(joined).toContain('branch protection: set on owner/repo@main');
		expect(joined).toContain(
			'deadlock-guard ruleset: created on owner/repo@main',
		);
		// The deadlock-guard remediation note is in the success log.
		expect(joined).toContain('verify.yml');
	});

	it('non-admin credential ⇒ NO API call; prints the gh api command + manual UI fallback', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: false,
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('instructed');
		expect(result.adminScope).toBe(false);
		// The seam was NOT called.
		expect(ctx.branchProtections.size).toBe(0);
		expect(ctx.rulesets.length).toBe(0);
		const joined = lines.join('\n');
		expect(joined).toContain('no admin-scoped credential');
		expect(joined).toContain('repos/owner/repo/branches/main/protection');
		expect(joined).toContain('gh api -X PUT');
		// The ruleset POST command is also printed for the non-admin path.
		expect(joined).toContain('repos/owner/repo/rulesets');
		expect(joined).toContain('gh api -X POST');
		// Manual UI fallback one-liner.
		expect(joined).toContain('https://github.com/owner/repo/settings/branches');
		expect(joined).toContain(`required check \`${VERIFY_CHECK_CONTEXT}\``);
	});

	it('unknown scope (undefined) is treated as non-admin (never silently attempts)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			// adminScope omitted ⇒ undefined ⇒ unknown
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('instructed');
		expect(result.adminScope).toBeUndefined();
		expect(ctx.branchProtections.size).toBe(0);
	});

	it('--fake mode skips the step (no real API touched)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			fake: true,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('skipped-fake');
		expect(ctx.branchProtections.size).toBe(0);
		expect(lines.join('\n')).toContain('--fake');
	});

	it('non-GitHub provider (no seam) skips cleanly', async () => {
		const ctx: import('../src/install-ci-core.js').CIProviderContext = {
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
			async setSecret() {},
			// no setBranchProtection, no getRepoAdminScope
		};
		const result = await installCIBranchProtectionStep({
			ctx,
			log: () => {},
		});
		expect(result.status).toBe('skipped-no-seam');
	});

	it('unknown repo skips cleanly with a clear message', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			// no repo
			adminScope: true,
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('skipped-no-repo');
		expect(lines.join('\n')).toContain('repo unknown');
	});

	it('seam rejection is reported as `failed` (never thrown), retry-by-hand command printed', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			branchProtectionError: 'simulated 403',
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('failed');
		expect(result.error).toBe('simulated 403');
		const joined = lines.join('\n');
		expect(joined).toContain('FAILED');
		expect(joined).toContain('gh api -X PUT');
	});

	it('an explicit branch is honoured and overrides auto-detection', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			// default-branch fixture would say `master`, but the explicit option wins
			defaultBranch: 'master',
		});
		const result = await installCIBranchProtectionStep({
			ctx,
			log: () => {},
			branch: 'develop',
		});
		expect(ctx.branchProtections.has('develop')).toBe(true);
		expect(ctx.branchProtections.has('main')).toBe(false);
		expect(ctx.branchProtections.has('master')).toBe(false);
		expect(result.branch).toBe('develop');
		expect(result.branchAutoDetected).toBe(false);
		expect(ctx.rulesets).toEqual([buildBranchProtectionRuleset('develop')]);
	});
});

// ─── nit (b): the default branch is auto-detected, not hardcoded `main` ──────
describe('the protected branch is the repo default branch, not a hardcoded `main`', () => {
	it('a `master`-defaulted repo: PUT + ruleset + fallback all use `master`, never `main`', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			defaultBranch: 'master',
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.branch).toBe('master');
		expect(result.branchAutoDetected).toBe(true);
		// The PUT targeted `master`, not `main`.
		expect(ctx.branchProtections.has('master')).toBe(true);
		expect(ctx.branchProtections.has('main')).toBe(false);
		// The ruleset targets `master`.
		expect(ctx.rulesets).toEqual([buildBranchProtectionRuleset('master')]);
		// No log line contains a hardcoded `main` branch reference.
		const joined = lines.join('\n');
		expect(joined).toContain('owner/repo@master');
		expect(joined).not.toContain('@main');
		expect(joined).not.toContain('branches/main/protection');
		expect(joined).not.toContain('refs/heads/main');
	});

	it('a `master`-defaulted repo, NON-admin: the printed fallback commands target `master`, not `main`', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: false,
			defaultBranch: 'master',
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('instructed');
		expect(result.branch).toBe('master');
		const joined = lines.join('\n');
		// The PUT fallback + ruleset POST fallback both target `master`.
		expect(joined).toContain('repos/owner/repo/branches/master/protection');
		expect(joined).toContain('refs/heads/master');
		// And NOT `main` anywhere in the printed commands.
		expect(joined).not.toContain('branches/main/protection');
		expect(joined).not.toContain('refs/heads/main');
	});

	it('a `main`-defaulted repo auto-detects `main` (unchanged behaviour)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			defaultBranch: 'main',
		});
		const result = await installCIBranchProtectionStep({ctx, log: () => {}});
		expect(result.branch).toBe('main');
		expect(result.branchAutoDetected).toBe(true);
		expect(ctx.branchProtections.has('main')).toBe(true);
	});

	it('lookup failure (undefined) falls back to `main` and LOGS the fallback', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			// defaultBranch omitted ⇒ getDefaultBranch() returns undefined (lookup failed)
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.branch).toBe('main');
		expect(result.branchAutoDetected).toBe(false);
		expect(lines.join('\n')).toContain(
			'could not detect the default branch; falling back to',
		);
	});
});

// ─── nit (c): the deadlock guard is a real ruleset, not just a log line ─────
describe('the deadlock guard is a runtime ruleset mechanism', () => {
	it('admin path creates the ruleset with do_not_enforce_on_create', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			defaultBranch: 'main',
		});
		const result = await installCIBranchProtectionStep({ctx, log: () => {}});
		expect(result.rulesetStatus).toBe('set');
		const rs = ctx.rulesets[0] as ReturnType<
			typeof buildBranchProtectionRuleset
		>;
		expect(rs.rules[0].parameters.do_not_enforce_on_create).toBe(true);
		expect(rs.rules[0].parameters.required_status_checks).toEqual([
			{context: VERIFY_CHECK_CONTEXT},
		]);
	});

	it('a ruleset rejection is reported as rulesetStatus=failed (never thrown), base PUT still `set`', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
			defaultBranch: 'main',
			branchRulesetError: 'simulated ruleset 403',
		});
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		// Base protection still succeeded.
		expect(result.status).toBe('set');
		expect(result.rulesetStatus).toBe('failed');
		expect(result.rulesetError).toBe('simulated ruleset 403');
		const joined = lines.join('\n');
		expect(joined).toContain('deadlock-guard ruleset: FAILED');
		expect(joined).toContain('gh api -X POST');
	});

	it('a provider without the ruleset seam skips the guard cleanly', async () => {
		const ctx: import('../src/install-ci-core.js').CIProviderContext = {
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			async setSecret() {},
			async getRepoAdminScope() {
				return true;
			},
			async getDefaultBranch() {
				return 'main';
			},
			async setBranchProtection() {},
			// no setBranchRuleset
		};
		const lines: string[] = [];
		const result = await installCIBranchProtectionStep({
			ctx,
			log: (l) => lines.push(l),
		});
		expect(result.status).toBe('set');
		expect(result.rulesetStatus).toBe('skipped-no-seam');
		expect(lines.join('\n')).toContain('does not implement the ruleset seam');
	});
});

// ─── installCI integrates the step after secrets ─────────────────────────────

describe('installCI runs the branch-protection step after artifacts + secrets', () => {
	it('admin scope ⇒ records the spec on the seam (non-fake)', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
		});
		const result = await installCI({
			ctx,
			configFile: configFile(),
			log: () => {},
		});
		expect(result.branchProtection?.status).toBe('set');
		expect(ctx.branchProtections.get('main')).toEqual(
			buildBranchProtectionSpec(),
		);
	});

	it('non-admin ⇒ NO seam call; result carries the `instructed` verdict', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: false,
		});
		const result = await installCI({
			ctx,
			configFile: configFile(),
			log: () => {},
		});
		expect(result.branchProtection?.status).toBe('instructed');
		expect(ctx.branchProtections.size).toBe(0);
	});

	it('--fake skips the step entirely', async () => {
		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: true,
			adminScope: true,
		});
		const result = await installCI({
			ctx,
			fake: true,
			configFile: configFile(),
			log: () => {},
		});
		expect(result.branchProtection?.status).toBe('skipped-fake');
		expect(ctx.branchProtections.size).toBe(0);
	});
});

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {rmrf} from './helpers/gitRepo.js';
import {
	buildSetupArtifacts,
	loadCapabilityRegistry,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';
import {
	GATE_OVERRIDES,
	ITEM_DISPATCH_WORKFLOW_PATH,
	ITEM_WORKFLOW_PATH,
	generateItemDispatchWorkflow,
	generateItemWorkflow,
} from '../src/dorfl-item-template.js';
import {generateAdvanceLifecycleWorkflow} from '../src/advance-lifecycle-template.js';
import {generateIntakeWorkflow} from '../src/intake-trigger-template.js';
import {LOCK_OUTPUT_KEYS} from '../src/ci-lock-outputs.js';

/**
 * The SPLIT CI ITEM workflows (task `ci-split-generate-workflows`, spec
 * `ci-agent-job-without-write-token` §2, ADR
 * `ci-agent-job-holds-no-write-token`): `dorfl-item.yml` (lock, agent, apply),
 * `dorfl-item-dispatch.yml` (one run per advance item, holding a slot), and
 * how `advance-lifecycle.yml` and `intake.yml` reach them. Asserted over the
 * PARSED YAML (job wiring, permissions, credentials), and the shell of the
 * `dispatch` and phase steps is RUN with `gh` / `dorfl` stubbed.
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
	maxParallel: 3,
};

type Step = {
	name?: string;
	id?: string;
	uses?: string;
	run?: string;
	if?: string;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
	'continue-on-error'?: boolean;
};
type Job = {
	permissions?: unknown;
	needs?: unknown;
	if?: string;
	'runs-on'?: string;
	'timeout-minutes'?: unknown;
	outputs?: Record<string, string>;
	steps?: Step[];
	uses?: string;
	with?: Record<string, unknown>;
	secrets?: unknown;
};
type Workflow = {
	name?: string;
	'run-name'?: string;
	on?: Record<string, unknown>;
	permissions?: unknown;
	concurrency?: Record<string, unknown>;
	jobs: Record<string, Job>;
};

const doc = (text: string): Workflow => parse(text) as Workflow;
const item = doc(generateItemWorkflow(config));
const dispatchWf = doc(generateItemDispatchWorkflow(config));
const lifecycle = doc(generateAdvanceLifecycleWorkflow(config));
const intake = doc(generateIntakeWorkflow(config));

/** The step of `job` whose run script invokes the phase (`--phase <p>`). */
function phaseStep(job: Job, phase: string): Step {
	const step = (job.steps ?? []).find(
		(s) => typeof s.run === 'string' && s.run.includes(`--phase ${phase}`),
	);
	expect(step, `a --phase ${phase} step`).toBeDefined();
	return step!;
}

const UNION = {
	contents: 'write',
	issues: 'write',
	'pull-requests': 'write',
	actions: 'read',
	checks: 'read',
};

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'dorfl-item-'));
});
afterEach(() => rmrf(work));

/** Write an executable bash stub named `name` into `dir`. */
function stub(dir: string, name: string, body: string): void {
	const p = join(dir, name);
	writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(p, 0o755);
}

/** Run a step's `run:` script with bash, its `env:` plus `extraEnv`, and `bin` first on PATH. */
function runStep(
	step: Step,
	bin: string,
	extraEnv: Record<string, string> = {},
): {status: number | null; stdout: string; stderr: string} {
	const env: NodeJS.ProcessEnv = {
		PATH: `${bin}:${process.env.PATH ?? ''}`,
		HOME: work,
		RUNNER_TEMP: join(work, 'runner-temp'),
		GITHUB_ENV: join(work, 'github-env'),
	};
	for (const [k, v] of Object.entries(step.env ?? {})) {
		// `${{ }}` values are GitHub's to fill: the test provides them explicitly.
		if (!String(v).includes('${{')) env[k] = String(v);
	}
	Object.assign(env, extraEnv);
	// `--norc` and stdin not a socket: bash would otherwise treat a socket stdin
	// as a remote shell and source a bashrc that may reset PATH (dropping the
	// stubs in favour of a real `gh` / `dorfl`).
	const r = spawnSync(
		'bash',
		['--norc', '--noprofile', '-e', '-c', step.run ?? ''],
		{
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	return {status: r.status, stdout: r.stdout, stderr: r.stderr};
}

describe('dorfl-item.yml: the lock, agent and apply jobs of ONE item', () => {
	it('is reached only through workflow_call, has no workflow-level concurrency, and grants nothing at workflow level', () => {
		expect(Object.keys(item.on ?? {})).toEqual(['workflow_call']);
		expect(item.concurrency).toBeUndefined();
		expect(item.permissions).toEqual({});
		expect(Object.keys(item.jobs)).toEqual(['lock', 'agent', 'apply']);
		for (const job of Object.values(item.jobs)) {
			expect(job['runs-on']).toBe('ubuntu-latest');
		}
	});

	it('lock: exactly contents/issues/pull-requests write; outputs exactly the lock-output keys; fetches the arbiter tip and publishes it as baseSha', () => {
		const lock = item.jobs.lock;
		expect(lock.permissions).toEqual({
			contents: 'write',
			issues: 'write',
			'pull-requests': 'write',
		});
		expect(lock['timeout-minutes']).toBe(15);
		expect(Object.keys(lock.outputs ?? {})).toEqual([...LOCK_OUTPUT_KEYS]);
		for (const k of LOCK_OUTPUT_KEYS) {
			expect(lock.outputs![k]).toBe(`\${{ steps.lock.outputs.${k} }}`);
		}
		const step = phaseStep(lock, 'lock');
		expect(step.id).toBe('lock');
		// dorfl's lock phase fetches <arbiter>/main and writes its tip as baseSha.
		expect(step.run).toContain('--phase lock --arbiter origin');
		expect(lock.outputs!.baseSha).toBe('${{ steps.lock.outputs.baseSha }}');
		expect(lock.steps![0].uses).toMatch(/^actions\/checkout@/);
		expect(lock.steps![0].with).toEqual({'fetch-depth': 0});
		expect(lock.steps![1].uses).toBe('./.github/actions/dorfl-setup-writer');
		expect(step.env!.GH_TOKEN).toBe(
			'${{ secrets.DORFL_GH_TOKEN || secrets.GITHUB_TOKEN }}',
		);
	});

	it('agent: exactly contents/issues read; checks out the base with persist-credentials false, fetch-depth 0, lfs; runs `git lfs install --local`; skipped when needsAgent is false; uploads with retention-days 1', () => {
		const agent = item.jobs.agent;
		expect(agent.permissions).toEqual({contents: 'read', issues: 'read'});
		expect(agent.needs).toBe('lock');
		expect(agent.if).toBe(
			"${{ needs.lock.outputs.acquired == 'true' && needs.lock.outputs.needsAgent == 'true' }}",
		);
		expect(agent['timeout-minutes']).toBe(
			'${{ fromJSON(needs.lock.outputs.agentTimeoutMinutes) }}',
		);
		const [checkout, setup, lfs] = agent.steps!;
		expect(checkout.uses).toMatch(/^actions\/checkout@/);
		expect(checkout.with).toEqual({
			ref: '${{ needs.lock.outputs.baseSha }}',
			'fetch-depth': 0,
			'persist-credentials': false,
			lfs: true,
		});
		expect(setup.uses).toBe('./.github/actions/dorfl-setup');
		expect(setup.with).toEqual({
			ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}',
		});
		expect(lfs.run).toBe('git lfs install --local');
		const step = phaseStep(agent, 'agent');
		expect(step.env).toMatchObject({
			GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			DORFL_LOCK_OUTPUTS: '${{ toJSON(needs.lock.outputs) }}',
		});
		expect(step.run).toContain(
			'--phase agent --watch --handoff-out "${RUNNER_TEMP}/dorfl-handoff"',
		);
		const upload = agent.steps!.find((s) =>
			(s.uses ?? '').startsWith('actions/upload-artifact@'),
		)!;
		expect(upload.if).toBe('${{ always() }}');
		expect(upload.with).toMatchObject({
			name: '${{ needs.lock.outputs.handoffName }}',
			'retention-days': 1,
		});
	});

	it('apply: the lock scopes plus actions/checks read; needs [lock, agent] with always(); downloads its own run artifact (no run-id); passes --agent-result and the lock timeout', () => {
		const apply = item.jobs.apply;
		expect(apply.permissions).toEqual(UNION);
		expect(apply.needs).toEqual(['lock', 'agent']);
		expect(apply.if).toBe(
			"${{ always() && needs.lock.outputs.acquired == 'true' }}",
		);
		expect(apply['timeout-minutes']).toBe(30);
		expect(apply.steps![0].with).toEqual({
			ref: '${{ needs.lock.outputs.baseSha }}',
			'fetch-depth': 0,
		});
		expect(apply.steps![1].uses).toBe('./.github/actions/dorfl-setup-writer');
		const download = apply.steps!.find((s) =>
			(s.uses ?? '').startsWith('actions/download-artifact@'),
		)!;
		expect(download.with).toEqual({
			name: '${{ needs.lock.outputs.handoffName }}',
			path: '${{ runner.temp }}/dorfl-handoff',
		});
		expect(download.with).not.toHaveProperty('run-id');
		expect(download['continue-on-error']).toBe(true);
		const step = phaseStep(apply, 'apply');
		expect(step.env).toMatchObject({
			GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			DORFL_LOCK_OUTPUTS: '${{ toJSON(needs.lock.outputs) }}',
			AGENT_RESULT: '${{ needs.agent.result }}',
			AGENT_TIMEOUT_MINUTES: '${{ needs.lock.outputs.agentTimeoutMinutes }}',
		});
		expect(step.run).toContain('--agent-result "${AGENT_RESULT}"');
		expect(step.run).toContain('--handoff-in "${RUNNER_TEMP}/dorfl-handoff"');
	});

	it('secrets: the provider key reaches the agent job only; DORFL_GH_TOKEN reaches lock and apply only', () => {
		const text = (job: Job): string => JSON.stringify(job);
		expect(text(item.jobs.agent)).toContain('secrets.ANTHROPIC_API_KEY');
		expect(text(item.jobs.agent)).not.toContain('DORFL_GH_TOKEN');
		for (const j of ['lock', 'apply']) {
			expect(text(item.jobs[j])).not.toContain('ANTHROPIC_API_KEY');
			expect(text(item.jobs[j])).toContain('secrets.DORFL_GH_TOKEN');
		}
		const call = item.on!.workflow_call as {secrets: Record<string, unknown>};
		expect(Object.keys(call.secrets)).toEqual([
			'ANTHROPIC_API_KEY',
			'DORFL_GH_TOKEN',
		]);
	});

	it('the four gate overrides are inputs, and each of lock, agent and apply exports them with the line-break guard (and the enum check)', () => {
		const call = item.on!.workflow_call as {inputs: Record<string, unknown>};
		for (const g of GATE_OVERRIDES) {
			expect(call.inputs).toHaveProperty(g.input);
		}
		for (const jobId of ['lock', 'agent', 'apply']) {
			const step = item.jobs[jobId].steps!.find(
				(s) =>
					s.name === 'apply dispatch gate overrides (one-shot, this run only)',
			)!;
			expect(step, jobId).toBeDefined();
			for (const g of GATE_OVERRIDES) {
				const v = g.env.replace(/^DORFL_/, 'DISPATCH_');
				expect(step.env![v]).toBe(`\${{ inputs.${g.input} }}`);
				expect(step.run).toContain(
					`[ -n "\${${v}}" ] && echo "${g.env}=\${${v}}" >> "$GITHUB_ENV"`,
				);
			}
			expect(step.run).toContain("*$'\\n'*|*$'\\r'*)");
			// The step runs BEFORE the phase step.
			const idx = item.jobs[jobId].steps!.indexOf(step);
			const phaseIdx = item.jobs[jobId].steps!.indexOf(
				phaseStep(item.jobs[jobId], jobId),
			);
			expect(idx).toBeLessThan(phaseIdx);

			// Run it: a valid override is exported, an off-enum one is refused.
			const bin = mkdtempSync(join(work, 'bin-'));
			writeFileSync(join(work, 'github-env'), '');
			const ok = runStep(step, bin, {
				DISPATCH_AUTO_BUILD: 'true',
				DISPATCH_AUTO_TASK: '',
				DISPATCH_OBSERVATION_TRIAGE: 'ask',
				DISPATCH_SURFACE_BLOCKERS: '',
			});
			expect(ok.status, ok.stderr).toBe(0);
			expect(readFileSync(join(work, 'github-env'), 'utf8')).toBe(
				'DORFL_AUTO_BUILD=true\nDORFL_OBSERVATION_TRIAGE=ask\n',
			);
			const bad = runStep(step, bin, {
				DISPATCH_AUTO_BUILD: 'yes',
				DISPATCH_AUTO_TASK: '',
				DISPATCH_OBSERVATION_TRIAGE: '',
				DISPATCH_SURFACE_BLOCKERS: '',
			});
			expect(bad.status).not.toBe(0);
		}
	});

	it('each phase step routes issue:<N> to `dorfl intake <N>` and every other id to `dorfl advance <id> --<mode>`, refusing a bad mode or a flag-like item', () => {
		const bin = mkdtempSync(join(work, 'bin-'));
		const log = join(work, 'dorfl.log');
		stub(bin, 'dorfl', `printf '%s\\n' "$*" >> "${log}"`);
		const base = {
			AGENT_RESULT: 'success',
			AGENT_TIMEOUT_MINUTES: '95',
			DORFL_LOCK_OUTPUTS: '{}',
		};
		const cases: Array<[string, string, Record<string, string>, string]> = [
			[
				'lock',
				'lock',
				{},
				'advance task:x --merge --phase lock --arbiter origin',
			],
			[
				'lock',
				'lock',
				{WORK_ITEM: 'issue:42'},
				'intake 42 --phase lock --arbiter origin',
			],
			[
				'agent',
				'agent',
				{},
				`advance task:x --merge --phase agent --watch --handoff-out ${join(work, 'runner-temp')}/dorfl-handoff --arbiter origin`,
			],
			[
				'apply',
				'apply',
				{},
				`advance task:x --merge --phase apply --agent-result success --agent-timeout-minutes 95 --handoff-in ${join(work, 'runner-temp')}/dorfl-handoff --arbiter origin`,
			],
			[
				'apply',
				'apply',
				{WORK_ITEM: 'issue:7', AGENT_TIMEOUT_MINUTES: ''},
				`intake 7 --phase apply --agent-result success --handoff-in ${join(work, 'runner-temp')}/dorfl-handoff --arbiter origin`,
			],
		];
		for (const [jobId, phase, env, expected] of cases) {
			writeFileSync(log, '');
			const r = runStep(phaseStep(item.jobs[jobId], phase), bin, {
				...base,
				WORK_ITEM: 'task:x',
				INTEGRATION_MODE: 'merge',
				...env,
			});
			expect(r.status, r.stderr).toBe(0);
			expect(readFileSync(log, 'utf8')).toBe(`${expected}\n`);
		}
		for (const env of [
			{WORK_ITEM: 'task:x', INTEGRATION_MODE: 'yolo'},
			{WORK_ITEM: '--merge', INTEGRATION_MODE: 'merge'},
			{WORK_ITEM: '', INTEGRATION_MODE: 'merge'},
		]) {
			writeFileSync(log, '');
			const r = runStep(phaseStep(item.jobs.lock, 'lock'), bin, env);
			expect(r.status).not.toBe(0);
			expect(readFileSync(log, 'utf8')).toBe('');
		}
	});
});

describe('dorfl-item-dispatch.yml: one advance item per run, in a slot', () => {
	it('is a workflow_dispatch wrapper named after its item, in the slot group with queue: max, granting nothing at workflow level', () => {
		expect(Object.keys(dispatchWf.on ?? {})).toEqual(['workflow_dispatch']);
		expect(dispatchWf['run-name']).toBe('dorfl-item ${{ inputs.item }}');
		expect(dispatchWf.permissions).toEqual({});
		expect(dispatchWf.concurrency).toEqual({
			group: 'dorfl-slot-${{ inputs.slot }}',
			'cancel-in-progress': false,
			queue: 'max',
		});
		const inputs = (
			dispatchWf.on!.workflow_dispatch as {
				inputs: Record<string, Record<string, unknown>>;
			}
		).inputs;
		expect(inputs.integrationMode).toMatchObject({
			type: 'choice',
			required: true,
			default: 'propose',
			options: ['propose', 'merge'],
		});
		expect(inputs.slot).toMatchObject({required: true, default: '0'});
		for (const g of GATE_OVERRIDES) {
			expect(inputs[g.input]).toMatchObject({
				type: 'choice',
				default: '',
				options: ['', ...g.values],
			});
		}
	});

	it('its one job calls dorfl-item.yml, granting the union of what the called jobs request, forwarding the item, the mode and the four overrides, with explicit secrets', () => {
		expect(Object.keys(dispatchWf.jobs)).toEqual(['item']);
		const job = dispatchWf.jobs.item;
		expect(job.uses).toBe('./.github/workflows/dorfl-item.yml');
		expect(job.permissions).toEqual(UNION);
		expect(job.with).toEqual({
			item: '${{ inputs.item }}',
			integrationMode: '${{ inputs.integrationMode }}',
			autoBuild: '${{ inputs.autoBuild }}',
			autoTask: '${{ inputs.autoTask }}',
			observationTriage: '${{ inputs.observationTriage }}',
			surfaceBlockers: '${{ inputs.surfaceBlockers }}',
		});
		expect(job.secrets).toEqual({
			ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}',
			DORFL_GH_TOKEN: '${{ secrets.DORFL_GH_TOKEN }}',
		});
	});
});

describe('the callers grant every scope a job of dorfl-item.yml requests', () => {
	it('the union of the called jobs is exactly what dorfl-item-dispatch.yml and intake.yml grant', () => {
		const requested: Record<string, string> = {};
		for (const job of Object.values(item.jobs)) {
			for (const [scope, level] of Object.entries(
				job.permissions as Record<string, string>,
			)) {
				if (requested[scope] !== 'write') requested[scope] = level;
			}
		}
		expect(requested).toEqual(UNION);
		expect(dispatchWf.jobs.item.permissions).toEqual(requested);
		expect(intake.jobs.intake.permissions).toEqual(requested);
		expect(intake.jobs.intake.uses).toBe('./.github/workflows/dorfl-item.yml');
		expect(intake.jobs.intake.with).toEqual({
			item: 'issue:${{ github.event.issue.number }}',
		});
	});
});

describe('advance-lifecycle.yml: the dispatch job', () => {
	const dispatchJob = lifecycle.jobs.dispatch;
	const step = dispatchJob.steps![0];

	it('holds actions: write only, runs no checkout and no setup, and passes every value through env', () => {
		expect(dispatchJob.permissions).toEqual({actions: 'write'});
		expect(dispatchJob.steps).toHaveLength(1);
		expect(step.uses).toBeUndefined();
		expect(step.run).not.toContain('${{');
		expect(step.env).toMatchObject({
			GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			ITEMS: '${{ needs.enumerate.outputs.items }}',
			MAX_PARALLEL: '3',
			INTEGRATION_MODE:
				"${{ github.event.inputs.integrationMode || 'propose' }}",
		});
		for (const g of GATE_OVERRIDES) {
			expect(step.env![g.env.replace(/^DORFL_/, 'DISPATCH_')]).toBe(
				`\${{ github.event.inputs.${g.input} }}`,
			);
		}
	});

	/** Run the dispatch step with `gh` stubbed: `active` are the non-completed run names. */
	function runDispatch(
		items: string[],
		active: string[],
		env: Record<string, string> = {},
	): {stdout: string; calls: string[]; status: number | null; stderr: string} {
		const bin = mkdtempSync(join(work, 'bin-'));
		const log = join(work, 'gh.log');
		const activeFile = join(work, 'active.txt');
		writeFileSync(activeFile, active.map((a) => `${a}\n`).join(''));
		writeFileSync(log, '');
		stub(
			bin,
			'gh',
			[
				`if [ "$1 $2" = "run list" ]; then`,
				// The real call filters with --jq; the stub prints the filtered names.
				`  case "$*" in *'--workflow dorfl-item-dispatch.yml'*'--json displayTitle,status'*) cat "${activeFile}" ;; *) exit 9 ;; esac`,
				`  exit 0`,
				`fi`,
				`printf '%s\\n' "$*" >> "${log}"`,
			].join('\n'),
		);
		const r = runStep(step, bin, {
			REPO: 'o/r',
			DEFAULT_BRANCH: 'main',
			ITEMS: JSON.stringify(items),
			INTEGRATION_MODE: 'propose',
			DISPATCH_AUTO_BUILD: '',
			DISPATCH_AUTO_TASK: '',
			DISPATCH_OBSERVATION_TRIAGE: '',
			DISPATCH_SURFACE_BLOCKERS: '',
			...env,
		});
		return {
			stdout: r.stdout,
			stderr: r.stderr,
			status: r.status,
			calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
		};
	}

	it('dispatches one run per item in slot index mod maxParallel, and SKIPS an item whose `dorfl-item <item>` run is not completed', () => {
		const r = runDispatch(
			['task:a', 'task:b', 'spec:c', 'obs:d'],
			['dorfl-item task:b', 'dorfl-item task:bb'],
		);
		expect(r.status, r.stderr).toBe(0);
		expect(r.calls).toEqual([
			'workflow run dorfl-item-dispatch.yml -R o/r --ref main -f item=task:a -f slot=0 -f integrationMode=propose',
			'workflow run dorfl-item-dispatch.yml -R o/r --ref main -f item=spec:c -f slot=2 -f integrationMode=propose',
			'workflow run dorfl-item-dispatch.yml -R o/r --ref main -f item=obs:d -f slot=0 -f integrationMode=propose',
		]);
		// The log names each item, its slot and whether it was dispatched.
		expect(r.stdout).toMatch(/dispatched task:a {2}slot 0/);
		expect(r.stdout).toMatch(/skipped {4}task:b {2}slot 1/);
		expect(r.stdout).toMatch(/dispatched spec:c {2}slot 2/);
	});

	it('forwards integrationMode and every non-blank gate override to each item run', () => {
		const r = runDispatch(['task:a'], [], {
			INTEGRATION_MODE: 'merge',
			DISPATCH_AUTO_BUILD: 'true',
			DISPATCH_AUTO_TASK: 'false',
			DISPATCH_OBSERVATION_TRIAGE: 'auto',
			DISPATCH_SURFACE_BLOCKERS: 'true',
		});
		expect(r.status, r.stderr).toBe(0);
		expect(r.calls).toEqual([
			'workflow run dorfl-item-dispatch.yml -R o/r --ref main -f item=task:a -f slot=0 -f integrationMode=merge -f autoBuild=true -f autoTask=false -f observationTriage=auto -f surfaceBlockers=true',
		]);
	});
});

describe('workspace install mode (this repository, decision 8)', () => {
	const ws = generateItemWorkflow({...config, installSource: 'workspace'});
	const wsDoc = doc(ws);

	it('all three jobs build dorfl from the base sha, and the comment says merge mode runs agent-landed main code in the write jobs', () => {
		// lock: resolves the arbiter tip first and builds from it.
		const lock = wsDoc.jobs.lock;
		const base = lock.steps!.find((s) => s.id === 'base')!;
		expect(base.run).toContain(
			'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main',
		);
		const setup = lock.steps!.find(
			(s) => s.uses === './.github/actions/dorfl-setup-writer',
		)!;
		expect(setup.with).toEqual({'source-ref': '${{ steps.base.outputs.sha }}'});
		expect(lock.steps!.indexOf(base)).toBeLessThan(lock.steps!.indexOf(setup));
		// agent + apply: check out baseSha, whose tree their setup builds.
		for (const j of ['agent', 'apply']) {
			expect(wsDoc.jobs[j].steps![0].with!.ref).toBe(
				'${{ needs.lock.outputs.baseSha }}',
			);
		}
		expect(ws).toMatch(
			/In MERGE mode this runs code an earlier agent landed on `main`\n# inside the WRITE jobs/,
		);
		// Registry mode has neither.
		const reg = generateItemWorkflow(config);
		expect(reg).not.toContain('id: base');
		expect(reg).not.toContain('WORKSPACE INSTALL MODE');
	});

	it('the writer setup builds the source-ref tree from $RUNNER_TEMP with --ignore-scripts; in registry mode it installs dorfl from $RUNNER_TEMP with --ignore-scripts', async () => {
		const pick = (c: ResolvedCIConfig): string =>
			buildSetupArtifacts(c).find((f) =>
				f.path.split('\\').join('/').startsWith('actions/dorfl-setup-writer/'),
			)!.content;
		const wsAction = pick({...config, installSource: 'workspace'});
		expect(wsAction).toContain(
			'git archive "$(git rev-parse --verify "${SOURCE_REF:-HEAD}^{commit}")" | tar -x -C "$src"',
		);
		expect(wsAction).toContain(
			'pnpm install --frozen-lockfile --ignore-scripts',
		);
		const regAction = pick(config);
		expect(regAction).toMatch(
			/cd "\$RUNNER_TEMP"\n\s+npm install -g --ignore-scripts dorfl@/,
		);
		// No harness, no provider key, no models.json in either (the comment may
		// NAME models.json to say it is absent, so check the steps only).
		for (const a of [wsAction, regAction]) {
			const steps = JSON.stringify((parse(a) as {runs: unknown}).runs);
			expect(steps).not.toMatch(/pi-coding-agent|models\.json|API_KEY|\bpi\b/);
		}
	});
});

describe('the item workflows are emitted by a self-registering capability', () => {
	it('loadCapabilityRegistry emits dorfl-item.yml and dorfl-item-dispatch.yml', async () => {
		const caps = await loadCapabilityRegistry();
		const cap = caps.find((c) => c.id === 'dorfl-item')!;
		expect(cap).toBeDefined();
		expect(cap.emit(config).map((f) => f.path)).toEqual([
			ITEM_WORKFLOW_PATH,
			ITEM_DISPATCH_WORKFLOW_PATH,
		]);
	});

	it('every generated workflow grants nothing at workflow level (permissions: {})', async () => {
		const caps = await loadCapabilityRegistry();
		for (const f of buildSetupArtifacts(config, caps)) {
			if (!f.path.split('\\').join('/').startsWith('workflows/')) continue;
			expect((parse(f.content) as Workflow).permissions, f.path).toEqual({});
		}
	});
});

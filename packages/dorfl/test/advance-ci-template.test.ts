import {describe, it, expect} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	resolveAdvanceCiTemplatePath,
	loadAdvanceCiTemplate,
	validateAdvanceCiTemplate,
} from '../src/advance-ci-template.js';

/**
 * `advance-install-ci` — the CI-integration deliverable (PRD `advance-loop`, US
 * #27/28): the `install-ci` notion as a DOCUMENTED workflow TEMPLATE (chosen over
 * a CLI subcommand — see the task's `## Decisions`). Per the acceptance criteria,
 * a documented template is VALIDATED here: it locates as a `.template` (so it
 * never self-triggers in THIS repo), parses into the required structural shape,
 * and references the right DRIVER invocations: the items enumerated via the
 * mirror-side `scan --json`, then one `dorfl-item-dispatch.yml` run per item
 * (THE SPLIT, ADR `ci-agent-job-holds-no-write-token`), whose lock, agent and
 * apply jobs run `advance`; in merge mode the land tail is serialised by the
 * engine's `mergeRetries` CAS-retry loop (see
 * `land-time-reverify-and-parallel-merge-ceiling`).
 *
 * `validateAdvanceCiTemplate` is the dependency-free counterpart of a YAML parse
 * (the package has no YAML lib, mirroring `frontmatter.ts`): a set of presence/
 * shape assertions over the raw text. The negative cases below construct a tmp
 * template missing each invariant and assert the validator FLAGS it — no shared/
 * global location is touched (only a throwaway tmp dir).
 */
describe('advance-install-ci — the CI workflow template (the install-ci notion)', () => {
	it('ships as a `.template`, so it never self-triggers as a live workflow here', () => {
		const path = resolveAdvanceCiTemplatePath();
		// A live `.github/workflows/*.yml` here would loop the tool on its own work;
		// the `.template` suffix keeps it inert until a consumer copies it.
		expect(path.endsWith('.yml.template')).toBe(true);
		expect(path).not.toContain(`${join('.github', 'workflows')}`);
	});

	it('the shipped template satisfies every structural invariant', () => {
		const text = loadAdvanceCiTemplate();
		const result = validateAdvanceCiTemplate(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('triggers on cron AND on-answer-committed (a push touching work/questions/*)', () => {
		const text = loadAdvanceCiTemplate();
		expect(/\bschedule:\s*[\s\S]*?-\s*cron:/.test(text)).toBe(true);
		expect(/work\/questions\//.test(text)).toBe(true);
	});

	it('the tick runs no agent: one dorfl-item-dispatch.yml run per item enumerated via the pool scan, never a matrix', () => {
		const text = loadAdvanceCiTemplate();
		// THE SPLIT (ADR ci-agent-job-holds-no-write-token, decision 1): one
		// workflow run per item, so no item shares another's artifact namespace.
		expect(/strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(false);
		expect(text).toContain('dorfl scan --json');
		expect(text).toContain('gh workflow run dorfl-item-dispatch.yml');
		expect(/^\s*[^#\n]*dorfl (?:advance|do|intake)\b/m.test(text)).toBe(false);
	});

	it('the dispatch job holds actions: write only, runs no checkout and no setup, and forwards integrationMode + a slot', () => {
		const text = loadAdvanceCiTemplate();
		expect(text).toMatch(
			/\n  dispatch:\n[\s\S]*?\n    permissions:\n      actions: write\n    steps:/,
		);
		const job = /\n  dispatch:[\s\S]*?(?=\n  [#\w])/.exec(text)?.[0] ?? '';
		expect(job).not.toBe('');
		expect(job).not.toMatch(/uses:/);
		expect(job).toContain('-f "integrationMode=${INTEGRATION_MODE}"');
		expect(job).toContain('-f "slot=${slot}"');
	});

	it('carries NO host-specific serialiser on main (the floor is git-alone; CAS-retry is the cross-run serialiser)', () => {
		const text = loadAdvanceCiTemplate();
		// The only workflow-level group is the per-ref tick group; the slot groups
		// live on the item runs and cap parallelism only.
		expect(text.match(/\n {2}group:/g)?.length ?? 0).toBe(1);
		expect(text).toMatch(/^permissions: \{\}$/m);
	});

	it('states that a lost CAS does not re-run the gate (decision 2)', () => {
		const text = loadAdvanceCiTemplate();
		expect(text).toContain('A lost CAS does');
		expect(text).toContain('NOT re-run the gate');
		expect(
			/re-gate \+ retry|re-rebase \+ re-gate|re-gates \+ retries/.test(text),
		).toBe(false);
	});

	it('uses ONE word (integrationMode) for the dispatch input that drives BOTH flag and shape', () => {
		const text = loadAdvanceCiTemplate();
		// Vocabulary reconciliation: the dispatch input is `integrationMode` (the same
		// vocabulary as `dorfl.json`'s `integration` and `advance --propose`/
		// `--merge`), driving BOTH the flag the legs pass and the derived job shape —
		// not a second, independent `mode` knob that could disagree with the flag.
		expect(text).toContain('integrationMode:');
		expect(/github\.event\.inputs\.integrationMode/.test(text)).toBe(true);
	});

	it('only INVOKES the existing advance driver (not entangled with the tick)', () => {
		const text = loadAdvanceCiTemplate();
		// `advance` runs inside the per-item workflow the template dispatches.
		expect(text).toContain('`advance`');
		expect(
			validateAdvanceCiTemplate(text).problems.map((p) => p.id),
		).not.toContain('invokes-advance-driver');
	});

	it(
		'the propose `enumerate` `jq` UNIONS taskable SPECS into the matrix as ' +
			'`spec:<slug>` legs alongside the task legs (the ' +
			'`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` fix)',
		() => {
			const text = loadAdvanceCiTemplate();
			// The task-only jq this fix replaced left `DORFL_AUTO_TASK` dead on
			// the hourly cron — a ready ungated SPEC never became a matrix leg. The new jq
			// must read `scan --json`'s taskable-SPEC pool (`repos[].specs[]` +
			// `cwd.repo.specs[]`) and emit `spec:<slug>` legs alongside `task:<slug>`.
			// HARD CUTOVER: the pool emits `spec:` legs (the dead `prd:` leg is GONE).
			expect(/"task:" \+ \.slug/.test(text)).toBe(true);
			expect(/"spec:" \+ \.slug/.test(text)).toBe(true);
			expect(/\.repos\[\]\.specs\[\]\?/.test(text)).toBe(true);
			expect(/\.cwd\.repo\.specs\[\]\?/.test(text)).toBe(true);
		},
	);

	describe('validateAdvanceCiTemplate flags a template missing each invariant', () => {
		const base = loadAdvanceCiTemplate();

		const withTmpTemplate = (
			text: string,
		): ReturnType<typeof validateAdvanceCiTemplate> => {
			const dir = mkdtempSync(join(tmpdir(), 'advance-ci-template-'));
			try {
				const path = join(dir, 'advance-loop.yml.template');
				writeFileSync(path, text, 'utf8');
				const loaded = loadAdvanceCiTemplate(path);
				return validateAdvanceCiTemplate(loaded);
			} finally {
				rmrf(dir);
			}
		};

		it('flags a missing cron trigger', () => {
			const broken = base.replace(/-\s*cron:.*$/m, '# (cron removed)');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('trigger-cron');
		});

		it('flags a missing on-answer-committed trigger', () => {
			const broken = base.replace(
				/work\/questions\/\*\*/g,
				'work/tasks/ready/**',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'trigger-on-answer-committed',
			);
		});

		it('flags a missing scan-based enumeration', () => {
			const broken = base.replace(/dorfl scan --json/g, 'echo nope');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('enumerates-via-scan');
		});

		it('flags a matrix sneaking back (one item per run)', () => {
			const broken = base.replace(
				/(\n  dispatch:\n)/,
				'\n  legs:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        item: [a]\n    steps:\n      - run: echo\n$1',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('no-matrix');
		});

		it('flags a dispatch that stops forwarding integrationMode', () => {
			const broken = base.replace(
				' -f "integrationMode=${INTEGRATION_MODE}"',
				'',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'dispatch-forwards-integration-mode',
			);
		});

		it('flags a checkout in the dispatch job (actions: write next to repository code)', () => {
			const broken = base.replace(
				/(\n  dispatch:\n[\s\S]*?\n    steps:\n)/,
				'$1      - uses: actions/checkout@v7\n',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'dispatch-no-checkout-no-setup',
			);
		});

		it('flags an agent verb run by the tick itself', () => {
			const broken = base.replace(
				/run: dorfl gc --remote-branches --arbiter origin/,
				'run: dorfl advance task:x --merge',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'invokes-advance-driver',
			);
		});

		it('flags an unpinned on-answer-committed push trigger', () => {
			const broken = base.replace(
				/    branches:\n      - main\n    paths:/,
				'    paths:',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('push-pinned-to-main');
		});

		it(
			'flags a regression to a TASK-ONLY `jq` (no `spec:` legs) — the ' +
				'taskable-SPEC pool must be enumerated',
			() => {
				// Strip the SPEC union from the jq: a task-only enumerator would silently
				// kill auto-slice on the hourly cron (the exact pre-fix bug).
				const broken = base
					.replace(/"spec:" \+ \.slug/g, '"task:" + .slug')
					.replace(/\.repos\[\]\.specs\[\]\?/g, '.repos[].items[]?')
					.replace(/\.cwd\.repo\.specs\[\]\?/g, '.cwd.repo.items[]?');
				const result = withTmpTemplate(broken);
				expect(result.ok).toBe(false);
				expect(result.problems.map((p) => p.id)).toContain(
					'propose-enumerates-taskable-specs',
				);
			},
		);
	});
});

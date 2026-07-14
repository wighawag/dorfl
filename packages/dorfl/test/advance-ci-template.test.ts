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
 * and references the right DRIVER invocations (propose ⇒ matrix enumerated via the
 * mirror-side `scan --json`; merge ⇒ ALSO a matrix per item, the parallel-build /
 * serialised-land shape that the engine's `integrateLock` + `mergeRetries`
 * CAS-retry loop makes safe — see `land-time-reverify-and-parallel-merge-ceiling`).
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

	it('propose mode is a MATRIX enumerated via the mirror-side pool scan, one advance per item', () => {
		const text = loadAdvanceCiTemplate();
		// A matrix strategy enumerated by `scan --json` (the mirror-side pool scan),
		// one `advance <matrix item>` per leg = one PR per item.
		expect(/strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(true);
		expect(text).toContain('dorfl scan --json');
		expect(/dorfl advance "?\$\{\{\s*matrix\./.test(text)).toBe(true);
	});

	it('each propose matrix leg carries --propose, tying integration mode to the matrix shape', () => {
		const text = loadAdvanceCiTemplate();
		// The fix for the Gate-2 desync bug: the matrix leg must pass `--propose` so
		// the integration mode is TIED to the matrix shape the dispatch input picked
		// (it can never fall back to a repo config default of `merge`).
		expect(
			/advance-propose:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
				text,
			),
		).toBe(true);
		// And `--merge` must NEVER ride a `propose` matrix leg (it would silently
		// land a propose leg on main). The MERGE matrix leg DOES carry `--merge`
		// (the new fan-out shape), so the guard is scoped to the propose section
		// only — split off the merge section so the regex cannot reach it.
		const proposeSection = text.split('advance-merge:')[0];
		expect(
			/dorfl advance "?\$\{\{\s*matrix\.[^\n]*--merge\b/.test(proposeSection),
		).toBe(false);
	});

	it("merge mode fans out as a MATRIX per item, with --merge per leg (parallel build/gate/review, serialised land via the engine's CAS-retry loop)", () => {
		const text = loadAdvanceCiTemplate();
		// The new shape (PRD `land-time-reverify-and-parallel-merge-ceiling`,
		// stories 4 + 6): merge mode fans out one job per item. Build/gate/review
		// run concurrently across siblings; the land tail is serialised by the
		// engine's `mergeRetries` CAS-retry loop (the git-alone floor), NOT by the
		// workflow's job shape.
		expect(/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(
			true,
		);
		expect(
			/advance-merge:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--merge\b/.test(
				text,
			),
		).toBe(true);
	});

	it('the merge job carries NO host-specific `concurrency:` serialiser (the floor is git-alone; CAS-retry is the cross-job serialiser)', () => {
		const text = loadAdvanceCiTemplate();
		// Applied Answer q1: scaled `mergeRetries` is the floor; the portable
		// cross-job ref-lock is the planned accelerator; a GitHub Actions
		// `concurrency:` block on `advance-merge` is OPTIONAL host sugar only,
		// deliberately NOT shipped — a host-specific serialiser would be
		// load-bearing for safety, which the floor framing forbids.
		expect(/advance-merge:[\s\S]*?\n {4}concurrency:/.test(text)).toBe(false);
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
		expect(text).toContain('dorfl advance');
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

		it('flags a missing scan-based matrix enumeration', () => {
			const broken = base.replace(/dorfl scan --json/g, 'echo nope');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'propose-enumerates-via-scan',
			);
		});

		it('flags a merge job that is NOT a matrix (the new fan-out shape requires it)', () => {
			// Strip the matrix block from the merge job: a single-sequential merge
			// (the OLD shape) must now FAIL validation.
			const broken = base.replace(
				/(advance-merge:[\s\S]*?)strategy:\s*\n(?:\s+[^\n]*\n)+?(\s+steps:)/,
				'$1$2',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('merge-matrix');
		});

		it('flags a propose matrix leg missing the --propose flag', () => {
			// Drop `--propose` from the matrix leg only: the integration mode would then
			// fall back to config and could desync from the matrix shape.
			const broken = base.replace(
				/(dorfl advance "?\$\{\{\s*matrix\.item\s*\}\}"?) --propose/,
				'$1',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'propose-leg-carries-propose-flag',
			);
		});

		it('flags a merge matrix leg missing the --merge flag', () => {
			// Drop `--merge` from the merge matrix leg only: the integration mode
			// would then fall back to config and could desync from the matrix shape.
			const broken = base.replace(
				/(advance-merge:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.item\s*\}\}"?) --merge/,
				'$1',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-leg-carries-merge-flag',
			);
		});

		it('flags a host-specific `concurrency:` group injected on the `advance-merge` job (would make safety host-dependent)', () => {
			// Inject a forbidden `concurrency:` block under the `advance-merge:` job:
			// a host-specific serialiser at the workflow layer would be load-bearing
			// for cross-job land safety, breaking the git-alone floor framing.
			const broken = base.replace(
				/(advance-merge:\n)(\s{4}needs:)/,
				'$1    concurrency:\n      group: dorfl-merge-${{ github.ref }}\n      cancel-in-progress: false\n$2',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-no-host-concurrency-serialiser',
			);
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

import {describe, it, expect} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
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
 * a CLI subcommand — see the slice's `## Decisions`). Per the acceptance criteria,
 * a documented template is VALIDATED here: it locates as a `.template` (so it
 * never self-triggers in THIS repo), parses into the required structural shape,
 * and references the right DRIVER invocations (propose ⇒ matrix enumerated via the
 * mirror-side `scan --json`; merge ⇒ a single sequential `advance -n`).
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
		expect(text).toContain('agent-runner scan --json');
		expect(/agent-runner advance "?\$\{\{\s*matrix\./.test(text)).toBe(true);
	});

	it('merge mode is a SINGLE SEQUENTIAL job invoking the -n driver (no matrix)', () => {
		const text = loadAdvanceCiTemplate();
		// The `-n` driver is always sequential; the merge job must not use a matrix
		// (parallel merge jobs would thrash the main-CAS).
		expect(/agent-runner advance -n\b/.test(text)).toBe(true);
		expect(/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(
			false,
		);
	});

	it('only INVOKES the existing advance driver (not entangled with the tick)', () => {
		const text = loadAdvanceCiTemplate();
		expect(text).toContain('agent-runner advance');
	});

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
				rmSync(dir, {recursive: true, force: true});
			}
		};

		it('flags a missing cron trigger', () => {
			const broken = base.replace(/-\s*cron:.*$/m, '# (cron removed)');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('trigger-cron');
		});

		it('flags a missing on-answer-committed trigger', () => {
			const broken = base.replace(/work\/questions\/\*\*/g, 'work/backlog/**');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'trigger-on-answer-committed',
			);
		});

		it('flags a missing scan-based matrix enumeration', () => {
			const broken = base.replace(/agent-runner scan --json/g, 'echo nope');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'propose-enumerates-via-scan',
			);
		});

		it('flags a missing sequential -n merge driver', () => {
			const broken = base.replace(
				/agent-runner advance -n\b/g,
				'agent-runner advance',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-sequential-n-driver',
			);
		});
	});
});

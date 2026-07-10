import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	extractPromptSection,
	extractCanonicalWrapperTemplate,
	resolveProtocolDoc,
	wrapper,
	applyPromptGuidance,
	buildAgentPrompt,
	buildContinueBlock,
	extractRequeueNotes,
	resolveContinueContext,
	resolveTask,
	inferSlugFromBranch,
	renderPrompt,
	resolveItemPromptGuidance,
	resolvePromptGuidanceForItem,
	findSpecPath,
	PromptError,
	type ContinueContext,
} from '../src/prompt.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	fixtureFolderRel,
	type Scratch,
} from './helpers/gitRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The canonical work-contract, owned by the `setup` skill at the monorepo root. */
const CLAIM_PROTOCOL = resolve(
	HERE,
	'..',
	'..',
	'..',
	'skills',
	'setup',
	'protocol',
	'CLAIM-PROTOCOL.md',
);

const TASK = `---
title: Example task
slug: example
spec: my-spec
blockedBy: []
---

## What to build

Some thing.

## Acceptance criteria

- [ ] it works

## Prompt

> Build the example feature.
>
> Make the tests green.
`;

/** Write a task file into work/<folder>/<slug>.md under root, return root. */
function seedTask(
	root: string,
	folder: 'in-progress' | 'backlog' | 'pre-backlog',
	slug: string,
	body: string,
	spec = 'my-spec',
): void {
	const dir = join(root, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	const content = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`spec: ${spec}`,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Prompt',
		'',
		body,
		'',
	].join('\n');
	writeFileSync(join(dir, `${slug}.md`), content);
}

/** Task file CONTENT (not written to disk) for the done/-continue fixtures. */
function doneTask(slug: string, spec = 'my-spec'): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`spec: ${spec}`,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Prompt',
		'',
		`> Implement ${slug}.`,
		'',
	].join('\n');
}

describe('extractPromptSection', () => {
	it('extracts the body under the ## Prompt heading, sans heading + quoting', () => {
		const prompt = extractPromptSection(TASK)!;
		expect(prompt).toContain('Build the example feature.');
		expect(prompt).toContain('Make the tests green.');
		expect(prompt).not.toContain('## Prompt');
		expect(prompt).not.toMatch(/^>/m);
	});

	it('stops at the next heading of the same or higher level', () => {
		const withTrailer = `## Prompt\n\n> The prompt body.\n\n## Notes\n\nNot part of the prompt.\n`;
		const prompt = extractPromptSection(withTrailer)!;
		expect(prompt).toContain('The prompt body.');
		expect(prompt).not.toContain('Not part of the prompt.');
	});

	it('returns undefined when there is no ## Prompt section', () => {
		expect(extractPromptSection('# Title\n\nno prompt here')).toBeUndefined();
	});

	it('is case-insensitive about the heading text', () => {
		expect(extractPromptSection('## prompt\n\n> hello\n')).toContain('hello');
	});
});

describe('canonical wrapper — read from the contract, not a divergent copy', () => {
	it('the emitted wrapper IS the CLAIM-PROTOCOL template with <slug>/<spec> substituted (default-OFF nudge applied)', () => {
		const protocol = readFileSync(CLAIM_PROTOCOL, 'utf8');
		const template = extractCanonicalWrapperTemplate(protocol);

		// Sanity: the canonical template carries the placeholders we substitute.
		expect(template).toContain('<slug>');

		const emitted = wrapper('example', 'my-spec');
		// With the nudge OFF (the default), the conditional-fragment transform
		// strips the markers + the IF-branch and keeps the historic ELSE text
		// (BYTE-IDENTITY guard — see the `promptGuidance.testFirst` seam tests).
		const expected = applyPromptGuidance(template, {testFirst: false})
			.replace(/<slug>/g, 'example')
			.replace(/<spec>/g, 'my-spec');
		expect(emitted).toBe(expected);
	});

	it('substitutes <slug> everywhere it appears in the canonical text', () => {
		const emitted = wrapper('my-slug', 'my-spec');
		// The canonical wrapper comes from CLAIM-PROTOCOL.md (the PROTOCOL doc), now
		// cut over to the new layout/vocabulary by the protocol-docs/skills/setup
		// vocabulary task. The emitted task-body path is `work/tasks/ready/<slug>.md`.
		expect(emitted).toContain('work/tasks/ready/my-slug.md');
		expect(emitted).not.toContain('<slug>');
	});

	it('substitutes the source spec path (work/specs/ready/<spec>.md)', () => {
		const emitted = wrapper('example', 'dorfl');
		expect(emitted).toContain('dorfl');
		expect(emitted).not.toContain('<spec>');
	});

	it('resolveProtocolDoc finds the bundled contract by default', () => {
		const resolved = resolveProtocolDoc('CLAIM-PROTOCOL.md');
		expect(resolved.endsWith('CLAIM-PROTOCOL.md')).toBe(true);
		expect(readFileSync(resolved, 'utf8')).toContain(
			'prompt handed to the work agent',
		);
	});

	it('resolveProtocolDoc finds REVIEW-PROTOCOL.md by default (the set-vendor proof)', () => {
		const resolved = resolveProtocolDoc('REVIEW-PROTOCOL.md');
		expect(resolved.endsWith('REVIEW-PROTOCOL.md')).toBe(true);
		// The discipline body is present (a strong marker of the canonical doc).
		expect(readFileSync(resolved, 'utf8')).toMatch(/destination check/i);
	});

	it('the assembled wrapper carries the machine-readable STOP sentinel form (Part A)', () => {
		const emitted = wrapper('example', 'my-spec');
		// The runner detects this EXACT block; it must be in-band in the prompt.
		expect(emitted).toContain('=== TASK-STOP ===');
		expect(emitted).toContain('=== END TASK-STOP ===');
		// The reason goes INSIDE the block (it becomes the needs-attention reason).
		expect(emitted).toMatch(/reason.*INSIDE it|INSIDE it/i);
	});

	it('the assembled wrapper carries the ## Decisions block + reframed decision bar (Part B)', () => {
		const emitted = wrapper('example', 'my-spec');
		expect(emitted).toContain('## Decisions');
		// The reframed bar: a choice touching another command/flag/task or a
		// user-visible default is a DESIGN decision, not a small factual gap.
		expect(emitted).toMatch(/DESIGN decision/);
		expect(emitted).toMatch(/command\/flag\/task/);
		expect(emitted).toMatch(/USER-VISIBLE DEFAULT|user-visible default/i);
		// It must NOT block the build (record, proceed).
		expect(emitted).toMatch(/does NOT stop\s+the build/i);
	});
});

describe('resolveProtocolDoc — packaged-CLI-safe resolution order', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-protocol-resolve-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** The vendored in-package copy the build step writes (`dist/protocol/`). */
	const vendored = (name: string) =>
		resolve(HERE, '..', 'dist', 'protocol', name);

	for (const name of ['CLAIM-PROTOCOL.md', 'REVIEW-PROTOCOL.md']) {
		it(`prefers the TARGET repo work/protocol/ copy when present (${name})`, () => {
			// A set-up target repo carries its adopted copy; it must WIN over the
			// bundled/dev fallbacks (it reflects the protocol version that repo adopted).
			const protoDir = join(scratch.root, 'work', 'protocol');
			mkdirSync(protoDir, {recursive: true});
			const target = join(protoDir, name);
			writeFileSync(target, `TARGET-REPO PROTOCOL COPY (${name})\n`);

			const resolved = resolveProtocolDoc(name, scratch.root);
			expect(resolved).toBe(target);
			expect(readFileSync(resolved, 'utf8')).toContain(
				'TARGET-REPO PROTOCOL COPY',
			);
		});

		it(`falls back to the VENDORED in-package copy in a simulated installed layout (${name})`, () => {
			// Installed-CLI shape: the target repo has NO work/protocol/ and there is no
			// reachable sibling skills/ tree. The resolver must pick the bundled copy
			// (ranked above the dev-only skills/ walk) so prompt assembly never ENOENTs.
			const resolved = resolveProtocolDoc(name, scratch.root);
			expect(resolved).toBe(vendored(name));
		});

		it(`the override short-circuits ahead of every other source (${name})`, () => {
			const protoDir = join(scratch.root, 'work', 'protocol');
			mkdirSync(protoDir, {recursive: true});
			writeFileSync(join(protoDir, name), 'TARGET\n');
			const override = join(scratch.root, 'explicit.md');
			writeFileSync(override, 'OVERRIDE\n');
			expect(resolveProtocolDoc(name, scratch.root, override)).toBe(override);
		});
	}
});

describe('buildAgentPrompt — packaged + target-repo protocol sources', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-protocol-build-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('builds a prompt from the VENDORED copy when no work/protocol/ exists (no ENOENT)', () => {
		// The regression guard: against a temp dir with no work/protocol/ (and no
		// sibling skills/), buildAgentPrompt must return a prompt, not throw ENOENT.
		const out = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {
			cwd: scratch.root,
		});
		expect(out).toContain('work/tasks/ready/example.md');
		expect(out).toContain('TASK-BODY');
		expect(out).not.toContain('<slug>');
	});

	it('builds a prompt from the TARGET repo work/protocol/ copy when present', () => {
		// Seed a target-repo copy whose canonical wrapper carries a UNIQUE marker so
		// we can prove THAT copy (not the bundled one) was the source.
		// 'complete spec' is inside the canonical wrapper template; tagging it in the
		// target copy proves THAT copy (not the bundled one) was the prompt source.
		const bundled = readFileSync(
			resolveProtocolDoc('CLAIM-PROTOCOL.md'),
			'utf8',
		);
		expect(bundled).toContain('complete spec');
		const tagged = bundled.replace(
			'complete spec',
			'TARGET-MARKER complete spec',
		);
		const protoDir = join(scratch.root, 'work', 'protocol');
		mkdirSync(protoDir, {recursive: true});
		writeFileSync(join(protoDir, 'CLAIM-PROTOCOL.md'), tagged);

		const out = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {
			cwd: scratch.root,
		});
		expect(out).toContain('TARGET-MARKER complete spec');
	});
});

describe('promptGuidance.testFirst nudge — the conditional-fragment seam', () => {
	it('applyPromptGuidance: OFF ⇒ keeps the ELSE branch verbatim (off-path)', () => {
		const tmpl =
			'before\n<!-- if promptGuidance.testFirst -->\nSTRONG\n<!-- else -->\nSOFT\n<!-- /if -->\nafter';
		expect(applyPromptGuidance(tmpl, {testFirst: false})).toBe(
			'before\nSOFT\nafter',
		);
		// Omitted == false (the documented default).
		expect(applyPromptGuidance(tmpl)).toBe('before\nSOFT\nafter');
	});

	it('applyPromptGuidance: ON ⇒ keeps the IF branch verbatim', () => {
		const tmpl =
			'before\n<!-- if promptGuidance.testFirst -->\nSTRONG\n<!-- else -->\nSOFT\n<!-- /if -->\nafter';
		expect(applyPromptGuidance(tmpl, {testFirst: true})).toBe(
			'before\nSTRONG\nafter',
		);
	});

	it('wrapper OFF (default) is byte-identical to the manually-stripped canonical template', () => {
		// The off-path acceptance criterion: with the nudge off, the assembled
		// wrapper must be byte-identical to what you would get if the conditional
		// markers were not in CLAIM-PROTOCOL.md at all (i.e. only the historic
		// soft TDD line was there). We reconstruct that baseline by stripping the
		// markers from the canonical template and asserting equality.
		const protocol = readFileSync(CLAIM_PROTOCOL, 'utf8');
		const template = extractCanonicalWrapperTemplate(protocol);
		const baseline = applyPromptGuidance(template, {testFirst: false})
			.replace(/<slug>/g, 'example')
			.replace(/<spec>/g, 'my-spec');
		expect(wrapper('example', 'my-spec')).toBe(baseline);
		expect(
			wrapper('example', 'my-spec', {promptGuidance: {testFirst: false}}),
		).toBe(baseline);
		// And the byte-identity guard: with the nudge OFF, the strengthened text
		// must be absent and the soft historic text must be present (the soft line
		// is the ELSE branch).
		const off = wrapper('example', 'my-spec');
		// The historic soft line is hard-wrapped (newline between "for" and "it");
		// matching the unwrapped prefix is enough to prove it is present.
		expect(off).toContain('TDD where the task asks for');
		expect(off).not.toContain('failing test BEFORE the production code');
		expect(off).not.toContain('<!-- if promptGuidance');
	});

	it('wrapper ON contains the strengthened test-first text and DROPS the soft phrasing (REPLACE, not append)', () => {
		const on = wrapper('example', 'my-spec', {
			promptGuidance: {testFirst: true},
		});
		expect(on).toContain('failing test BEFORE the production code');
		expect(on).toContain('guidance, not a gate');
		expect(on).toContain('`verify` step still decides pass/fail');
		// Q2 answer: REPLACE — the original soft phrasing is GONE when on.
		expect(on).not.toContain('TDD where the task asks for it');
		expect(on).not.toContain('<!-- if promptGuidance');
		expect(on).not.toContain('<!-- else -->');
		expect(on).not.toContain('<!-- /if -->');
	});

	it('the strengthened text is SOURCED from CLAIM-PROTOCOL.md (not a TS literal)', () => {
		// Proof-by-divergence: edit ONLY the markdown (a tagged override) and the
		// emitted wrapper must change accordingly. If the strengthened text lived
		// in a TS literal, this would be invariant to the markdown edit.
		const scratch = makeScratch('dorfl-prompt-guidance-source-');
		try {
			const bundled = readFileSync(CLAIM_PROTOCOL, 'utf8');
			const tagged = bundled.replace(
				'failing test BEFORE the production code',
				'failing test BEFORE the production code [MARKDOWN-SOURCED-MARKER]',
			);
			const protoDir = join(scratch.root, 'work', 'protocol');
			mkdirSync(protoDir, {recursive: true});
			writeFileSync(join(protoDir, 'CLAIM-PROTOCOL.md'), tagged);
			const on = wrapper('example', 'my-spec', {
				cwd: scratch.root,
				promptGuidance: {testFirst: true},
			});
			expect(on).toContain('[MARKDOWN-SOURCED-MARKER]');
		} finally {
			scratch.cleanup();
		}
	});

	it('buildAgentPrompt OFF is byte-identical to the no-options assembly (snapshot guard)', () => {
		const a = buildAgentPrompt('example', 'my-spec', 'TASK-BODY');
		const b = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {
			promptGuidance: {testFirst: false},
		});
		expect(b).toBe(a);
	});

	it('buildAgentPrompt ON contains the strengthened line at the wrapper seam', () => {
		const on = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {
			promptGuidance: {testFirst: true},
		});
		expect(on).toContain('failing test BEFORE the production code');
		expect(on).toContain('TASK-BODY');
	});
});

describe('buildAgentPrompt', () => {
	it('is the canonical wrapper followed by the task prompt body verbatim', () => {
		const prompt = buildAgentPrompt('example', 'my-spec', 'UNIQUE-MARKER-123');
		expect(prompt).toContain(wrapper('example', 'my-spec'));
		expect(prompt).toContain('UNIQUE-MARKER-123');
	});

	it('only slug/spec vary in the wrapper (two tasks share the wrapper text)', () => {
		const a = buildAgentPrompt('alpha', 'spec-a', 'BODY');
		const b = buildAgentPrompt('bravo', 'spec-b', 'BODY');
		const stripA = a.replace(/alpha/g, 'SLUG').replace(/spec-a/g, 'SPEC');
		const stripB = b.replace(/bravo/g, 'SLUG').replace(/spec-b/g, 'SPEC');
		expect(stripA).toBe(stripB);
	});
});

describe('extractRequeueNotes — accumulated handoff notes from the body', () => {
	it('returns [] when no `## Requeue` section is present', () => {
		expect(extractRequeueNotes('# Title\n\nbody only')).toEqual([]);
	});

	it('extracts a single requeue note', () => {
		const body = [
			'## What to build',
			'',
			'thing',
			'',
			'## Requeue 2026-06-07',
			'',
			'Try the other approach next time.',
			'',
		].join('\n');
		expect(extractRequeueNotes(body)).toEqual([
			'Try the other approach next time.',
		]);
	});

	it('accumulates multiple requeue notes in file order (oldest first)', () => {
		const body = [
			'## What to build',
			'',
			'thing',
			'',
			'## Requeue 2026-06-01',
			'',
			'first note',
			'',
			'## Requeue 2026-06-07',
			'',
			'second note',
			'',
		].join('\n');
		expect(extractRequeueNotes(body)).toEqual(['first note', 'second note']);
	});

	it('captures multi-line note prose under a heading', () => {
		const body = ['## Requeue 2026-06-07', '', 'line one', 'line two', ''].join(
			'\n',
		);
		expect(extractRequeueNotes(body)).toEqual(['line one\nline two']);
	});
});

describe('buildContinueBlock — the injected CONTINUE block', () => {
	it('frames continuing + points at the prior diff vs <arbiter>/main', () => {
		const ctx: ContinueContext = {
			arbiter: 'origin',
			branch: 'work/task-my-slug',
			reason: '',
			requeueNotes: [],
		};
		const block = buildContinueBlock('my-slug', ctx);
		expect(block).toMatch(/CONTINUING/i);
		expect(block).toContain('origin/main...work/task-my-slug');
	});

	it('includes the needs-attention reason when present', () => {
		const ctx: ContinueContext = {
			arbiter: 'origin',
			branch: 'work/task-my-slug',
			reason: 'the acceptance gate was red',
			requeueNotes: [],
		};
		const block = buildContinueBlock('my-slug', ctx);
		expect(block).toContain('the acceptance gate was red');
	});

	it('includes the requeue handoff note(s) when present', () => {
		const ctx: ContinueContext = {
			arbiter: 'origin',
			branch: 'work/task-my-slug',
			reason: 'red gate',
			requeueNotes: ['note A', 'note B'],
		};
		const block = buildContinueBlock('my-slug', ctx);
		expect(block).toContain('note A');
		expect(block).toContain('note B');
	});

	it('omits the reason/note sub-sections when both are empty', () => {
		const block = buildContinueBlock('my-slug', {
			arbiter: 'origin',
			branch: 'work/task-my-slug',
			reason: '',
			requeueNotes: [],
		});
		expect(block).not.toMatch(/needs-attention reason/i);
		expect(block).not.toMatch(/handoff note/i);
	});
});

describe('buildAgentPrompt — continue-mode vs fresh-mode', () => {
	const FRESH = buildAgentPrompt('example', 'my-spec', 'TASK-BODY');

	it('fresh-mode (no continueContext) is byte-identical to the baseline', () => {
		// The baseline = wrapper + task body, no CONTINUE block. Passing options
		// without a continueContext must not alter a single byte.
		const again = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {});
		expect(again).toBe(FRESH);
		expect(FRESH).toContain(wrapper('example', 'my-spec'));
		expect(FRESH).toContain('TASK-BODY');
		expect(FRESH).not.toMatch(/CONTINUING/i);
	});

	it('continue-mode injects the CONTINUE block before the task body', () => {
		const out = buildAgentPrompt('example', 'my-spec', 'TASK-BODY', {
			continueContext: {
				arbiter: 'origin',
				branch: 'work/task-example',
				reason: 'the gate was red',
				requeueNotes: ['use the v2 helper'],
			},
		});
		// It is a SUPERSET of fresh: same wrapper + same task body, PLUS the block.
		expect(out).toContain(wrapper('example', 'my-spec'));
		expect(out).toContain('TASK-BODY');
		expect(out).toMatch(/CONTINUING/i);
		expect(out).toContain('origin/main...work/task-example');
		expect(out).toContain('the gate was red');
		expect(out).toContain('use the v2 helper');
		// The block precedes the task body in the assembly.
		expect(out.indexOf('CONTINUING')).toBeLessThan(out.indexOf('TASK-BODY'));
		expect(out).not.toBe(FRESH);
	});
});

describe('resolveContinueContext — reuse branchAheadOf detection', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-continue-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** A repo with a `main` and a `work/<slug>` branch ahead of main. */
	function repoWithKeptBranch(slug: string, ahead: boolean): string {
		const repo = join(scratch.root, 'repo');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		writeFileSync(join(repo, 'README.md'), '# x\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		gitIn(['branch', `work/task-${slug}`], repo);
		if (ahead) {
			gitIn(['switch', '-q', `work/task-${slug}`], repo);
			writeFileSync(join(repo, 'prior.txt'), 'prior work\n');
			gitIn(['add', '-A'], repo);
			gitIn(['commit', '-q', '-m', 'prior attempt'], repo);
			gitIn(['switch', '-q', 'main'], repo);
		}
		return repo;
	}

	const BODY = [
		'## What to build',
		'',
		'thing',
		'',
		'## Needs attention',
		'',
		'the acceptance gate was red',
		'',
		'## Requeue 2026-06-07',
		'',
		'try the other approach',
		'',
	].join('\n');

	it('returns a context (reason+notes from body) when the branch is ahead', () => {
		const repo = repoWithKeptBranch('alpha', true);
		const ctx = resolveContinueContext({
			cwd: repo,
			slug: 'alpha',
			arbiter: 'origin',
			branchRef: 'work/task-alpha',
			mainRef: 'main',
			content: BODY,
			env: gitEnv(),
		});
		expect(ctx).toBeDefined();
		expect(ctx!.arbiter).toBe('origin');
		// The namespaced branch is recovered from branchRef (no `<arbiter>/` prefix
		// to strip here) — the continue-block prose points the agent at it.
		expect(ctx!.branch).toBe('work/task-alpha');
		expect(ctx!.reason).toBe('the acceptance gate was red');
		expect(ctx!.requeueNotes).toEqual(['try the other approach']);
	});

	it('returns undefined (fresh) when the branch is NOT ahead of main', () => {
		const repo = repoWithKeptBranch('beta', false);
		const ctx = resolveContinueContext({
			cwd: repo,
			slug: 'beta',
			arbiter: 'origin',
			branchRef: 'work/task-beta',
			mainRef: 'main',
			content: BODY,
			env: gitEnv(),
		});
		expect(ctx).toBeUndefined();
	});

	it('returns undefined (fresh) when the branch is absent', () => {
		const repo = repoWithKeptBranch('gamma', false);
		const ctx = resolveContinueContext({
			cwd: repo,
			slug: 'absent-slug',
			arbiter: 'origin',
			branchRef: 'work/task-absent-slug',
			mainRef: 'main',
			content: BODY,
			env: gitEnv(),
		});
		expect(ctx).toBeUndefined();
	});
});

describe('resolveTask — in-progress over backlog', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('resolves from work/in-progress/ when present', () => {
		seedTask(scratch.root, 'in-progress', 'foo', '> in-progress body');
		const task = resolveTask(scratch.root, 'foo');
		expect(task.folder).toBe('in-progress');
		expect(task.taskPrompt).toContain('in-progress body');
		expect(task.spec).toBe('my-spec');
	});

	it('falls back to work/tasks/ready/ when not in-progress', () => {
		seedTask(scratch.root, 'backlog', 'bar', '> backlog body');
		// `resolveTask` returns the resolved folder by its symbolic KEY, which now
		// reads in the new task vocabulary (`tasks-ready`).
		const task = resolveTask(scratch.root, 'bar');
		expect(task.folder).toBe('tasks-ready');
		expect(task.taskPrompt).toContain('backlog body');
	});

	it('prefers in-progress when the slug exists in BOTH folders', () => {
		seedTask(scratch.root, 'backlog', 'dup', '> the BACKLOG copy');
		seedTask(scratch.root, 'in-progress', 'dup', '> the IN-PROGRESS copy');
		const task = resolveTask(scratch.root, 'dup');
		expect(task.folder).toBe('in-progress');
		expect(task.taskPrompt).toContain('IN-PROGRESS');
		expect(task.taskPrompt).not.toContain('BACKLOG');
	});

	it('throws PromptError when the slug is in neither folder', () => {
		expect(() => resolveTask(scratch.root, 'missing')).toThrow(PromptError);
	});
});

describe('resolveTask — --allow-backlog widens to tasks-backlog (staging)', () => {
	// spec `do-allow-backlog-drive-staged-tasks-without-promotion`: an operator's
	// explicit `--allow-backlog` lets resolution ALSO search `tasks/backlog/`
	// (staging) at LOWEST priority; default off keeps staging invisible.
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-allow-backlog-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('WITHOUT the flag: a staged-only task does NOT resolve (no silent widening)', () => {
		seedTask(scratch.root, 'pre-backlog', 'staged', '> the STAGED body');
		expect(() => resolveTask(scratch.root, 'staged')).toThrow(PromptError);
		// Explicit flag-off is the same as today.
		expect(() =>
			resolveTask(scratch.root, 'staged', undefined, {allowBacklog: false}),
		).toThrow(PromptError);
	});

	it('WITH the flag: resolves a task that exists ONLY in tasks-backlog', () => {
		seedTask(scratch.root, 'pre-backlog', 'staged', '> the STAGED body');
		const task = resolveTask(scratch.root, 'staged', undefined, {
			allowBacklog: true,
		});
		expect(task.folder).toBe('tasks-backlog');
		expect(task.taskPrompt).toContain('STAGED');
	});

	it('precedence: a slug in BOTH tasks-ready and tasks-backlog resolves to READY', () => {
		seedTask(scratch.root, 'backlog', 'dup', '> the READY copy');
		seedTask(scratch.root, 'pre-backlog', 'dup', '> the STAGED copy');
		const task = resolveTask(scratch.root, 'dup', undefined, {
			allowBacklog: true,
		});
		expect(task.folder).toBe('tasks-ready');
		expect(task.taskPrompt).toContain('READY');
		expect(task.taskPrompt).not.toContain('STAGED');
	});

	it('in-progress still wins over a staged copy under the flag', () => {
		seedTask(scratch.root, 'pre-backlog', 'dup', '> the STAGED copy');
		seedTask(scratch.root, 'in-progress', 'dup', '> the IN-PROGRESS copy');
		const task = resolveTask(scratch.root, 'dup', undefined, {
			allowBacklog: true,
		});
		expect(task.folder).toBe('in-progress');
		expect(task.taskPrompt).toContain('IN-PROGRESS');
	});
});

describe('resolveTask — done/ on a CONTINUE, gated by tip-vs-arbiter (story 5)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-done-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/**
	 * Build a throwaway repo whose task `<slug>` has been DONE-MOVED into
	 * `work/tasks/done/` on a `work/task-<slug>` branch, with a sibling `--bare`
	 * arbiter. `integrated` controls the tip-vs-arbiter state under test:
	 *   - `false` (STRANDED): the done-move commit is committed on the branch but
	 *     NOT pushed to the arbiter — `arbiter/main` lacks it (the strand state).
	 *   - `true`  (COMPLETE): the done-move commit IS on `arbiter/main` (integrated).
	 * Returns the working repo path; the branch tip is left checked out, and the
	 * remote-tracking refs (`arbiter/work/task-<slug>`, `arbiter/main`) are
	 * fetched — exactly the in-place-clone refs the `do` caller feeds the gate.
	 */
	function doneMovedRepo(slug: string, integrated: boolean): string {
		const repo = join(scratch.root, `repo-${slug}`);
		const arbiter = join(scratch.root, `arbiter-${slug}.git`);
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		// Seed main with the task already claimed into in-progress/.
		const inProgress = join(repo, 'work', 'in-progress');
		mkdirSync(inProgress, {recursive: true});
		writeFileSync(join(inProgress, `${slug}.md`), doneTask(slug));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'claim: in-progress'], repo);
		// A bare arbiter mirroring main at the CLAIM commit.
		gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
		// The done-move commit: in-progress/ -> done/, on a work/task-<slug> branch.
		gitIn(['switch', '-q', '-c', `work/task-${slug}`], repo);
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/in-progress/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
		gitIn(['commit', '-q', '-m', `done: ${slug}`], repo);
		if (integrated) {
			// COMPLETE: the done-move tip is published to arbiter/main (integrated).
			gitIn(['push', '-q', 'arbiter', `work/task-${slug}:main`], repo);
		}
		// Else STRANDED: the done-move stays committed-but-unpushed on the branch.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		return repo;
	}

	/** The continue gate the in-place `do` caller feeds resolveTask. */
	function inPlaceGate(repo: string, slug: string) {
		return {
			cwd: repo,
			branchRef: `arbiter/work/task-${slug}`,
			mainRef: 'arbiter/main',
			env: gitEnv(),
		};
	}

	it('(a) STRANDED: resolves a done/ task on a continue (tip NOT on arbiter)', () => {
		const repo = doneMovedRepo('alpha', false);
		// Push the work branch to the arbiter so the remote-tracking branchRef
		// resolves (the strand keeps the branch, just NOT merged to main).
		gitIn(['push', '-q', 'arbiter', 'work/task-alpha:work/task-alpha'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const task = resolveTask(repo, 'alpha', inPlaceGate(repo, 'alpha'));
		expect(task.folder).toBe('done');
		expect(task.taskPrompt).toContain('Implement alpha.');
	});

	it('(b) COMPLETE: does NOT resolve a done/ task whose tip is on arbiter/main', () => {
		const repo = doneMovedRepo('beta', true);
		// The branch tip == arbiter/main (integrated). A continue gate must NOT admit
		// done/ — onboard must not resurrect a finished task — so this is "not found".
		expect(() => resolveTask(repo, 'beta', inPlaceGate(repo, 'beta'))).toThrow(
			PromptError,
		);
	});

	it('does NOT admit done/ on a FRESH claim (no continue gate), even if stranded', () => {
		const repo = doneMovedRepo('gamma', false);
		gitIn(['push', '-q', 'arbiter', 'work/task-gamma:work/task-gamma'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// No gate => the original ['in-progress','backlog']-only resolution; done/ is
		// unreachable, so the slug (now only in done/) is "not found".
		expect(() => resolveTask(repo, 'gamma')).toThrow(PromptError);
	});

	it('a continue gate leaves in-progress resolution UNCHANGED (in-progress wins)', () => {
		// in-progress/ present AND a (stranded) work branch: in-progress still wins,
		// because done/ is only APPENDED after in-progress/backlog in the order.
		const repo = join(scratch.root, 'repo-inprog');
		const arbiter = join(scratch.root, 'arbiter-inprog.git');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const ip = join(repo, 'work', 'in-progress');
		mkdirSync(ip, {recursive: true});
		writeFileSync(join(ip, 'delta.md'), doneTask('delta'));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
		gitIn(['switch', '-q', '-c', 'work/task-delta'], repo);
		writeFileSync(join(repo, 'extra.txt'), 'stranded churn\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/task-delta:work/task-delta'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const task = resolveTask(repo, 'delta', inPlaceGate(repo, 'delta'));
		expect(task.folder).toBe('in-progress');
	});
});

describe('renderPrompt — slug given', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('renders the wrapper + task prompt for an explicit slug', () => {
		seedTask(scratch.root, 'in-progress', 'given', '> GIVEN-BODY', 'the-spec');
		const out = renderPrompt({slug: 'given', cwd: scratch.root});
		expect(out).toContain('work/tasks/ready/given.md');
		expect(out).toContain('the-spec');
		expect(out).toContain('GIVEN-BODY');
		expect(out).not.toContain('<slug>');
	});

	it('an explicit slug overrides any branch inference', () => {
		// Even on a work/other branch, the explicit slug wins.
		gitIn(['init', '-q', '-b', 'main'], scratch.root);
		writeFileSync(join(scratch.root, 'x'), 'x');
		gitIn(['add', '-A'], scratch.root);
		gitIn(['commit', '-q', '-m', 'seed'], scratch.root);
		gitIn(['switch', '-q', '-c', 'work/other'], scratch.root);
		seedTask(scratch.root, 'backlog', 'given', '> GIVEN-BODY');
		const out = renderPrompt({slug: 'given', cwd: scratch.root});
		expect(out).toContain('work/tasks/ready/given.md');
		expect(out).toContain('GIVEN-BODY');
	});
});

describe('renderPrompt — slug inferred from a work/<slug> branch', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	function initRepoOnBranch(branch: string): void {
		gitIn(['init', '-q', '-b', 'main'], scratch.root);
		writeFileSync(join(scratch.root, 'README.md'), '# x\n');
		gitIn(['add', '-A'], scratch.root);
		gitIn(['commit', '-q', '-m', 'seed'], scratch.root);
		gitIn(['switch', '-q', '-c', branch], scratch.root);
	}

	it('infers <slug> from the current work/<slug> branch when omitted', () => {
		initRepoOnBranch('work/inferred');
		seedTask(scratch.root, 'in-progress', 'inferred', '> INFERRED-BODY');
		const out = renderPrompt({cwd: scratch.root, env: gitEnv()});
		expect(out).toContain('work/tasks/ready/inferred.md');
		expect(out).toContain('INFERRED-BODY');
	});

	it('inferSlugFromBranch returns the slug on a work/<slug> branch', () => {
		initRepoOnBranch('work/some-slug');
		expect(inferSlugFromBranch(scratch.root, gitEnv())).toBe('some-slug');
	});

	it('inferSlugFromBranch returns empty on a non-work branch', () => {
		initRepoOnBranch('feature/x');
		expect(inferSlugFromBranch(scratch.root, gitEnv())).toBe('');
	});

	it('throws PromptError when no slug and not on a work/<slug> branch', () => {
		gitIn(['init', '-q', '-b', 'main'], scratch.root);
		writeFileSync(join(scratch.root, 'README.md'), '# x\n');
		gitIn(['add', '-A'], scratch.root);
		gitIn(['commit', '-q', '-m', 'seed'], scratch.root);
		// Still on main (a non-work/<slug> branch) — no slug can be inferred.
		expect(() => renderPrompt({cwd: scratch.root, env: gitEnv()})).toThrow(
			PromptError,
		);
	});
});

// ---------------------------------------------------------------------------
// Per-item override layer for `promptGuidance.testFirst`
// (task `prompt-guidance-testfirst-item-override`, spec US #5).
//
// Precedence chain (highest → lowest):
//   per-task frontmatter
//   > per-spec frontmatter (when the task carries `spec:`)
//   > repo-resolved policy (CLI flag > env > per-repo > global > default false)
//
// We test at TWO seams:
//   - {@link resolveItemPromptGuidance}: the pure precedence resolver,
//     parameterised over the full (repo × spec × task) matrix.
//   - {@link renderPrompt}: the prompt-assembly seam, end-to-end — a task or
//     spec frontmatter override changes the strengthened/soft text the worker
//     actually receives.
//
// We deliberately do NOT test process-level behaviour ("the agent really wrote
// a test first"): the strengthened line is a NUDGE; only its PRESENCE in the
// assembled prompt is observable here. The acceptance gate is `verify`.
// ---------------------------------------------------------------------------

describe('resolveItemPromptGuidance — the precedence matrix', () => {
	/** Helper: produce a parsed frontmatter object stamped with a given testFirst value. */
	function fm(testFirst: boolean | undefined) {
		return {
			...parseFrontmatter('---\nslug: x\n---\n'),
			promptGuidance: {testFirst},
		};
	}

	it('repo-only: with no task / no spec, the repo policy wins', () => {
		expect(resolveItemPromptGuidance({testFirst: false})).toEqual({
			testFirst: false,
		});
		expect(resolveItemPromptGuidance({testFirst: true})).toEqual({
			testFirst: true,
		});
	});

	it('spec overrides repo when the task does not override', () => {
		expect(
			resolveItemPromptGuidance({testFirst: false}, fm(undefined), fm(true)),
		).toEqual({testFirst: true});
		expect(
			resolveItemPromptGuidance({testFirst: true}, fm(undefined), fm(false)),
		).toEqual({testFirst: false});
	});

	it('task overrides spec AND repo (the highest tier wins outright)', () => {
		expect(
			resolveItemPromptGuidance({testFirst: false}, fm(true), fm(false)),
		).toEqual({testFirst: true});
		expect(
			resolveItemPromptGuidance({testFirst: true}, fm(false), fm(true)),
		).toEqual({testFirst: false});
	});

	it('a task `false` override is honoured (it is NOT confused with omitted)', () => {
		// The escape hatch: an exploratory task pins testFirst:false even when the
		// repo + spec both default it on. Critical guard against `?? false` bugs.
		expect(
			resolveItemPromptGuidance({testFirst: true}, fm(false), fm(true)),
		).toEqual({testFirst: false});
	});

	it('a task with NO `spec:` (chore) can still carry the override (by symmetry with humanOnly)', () => {
		// Recorded decision: a spec-less chore task may still pin the nudge in
		// its own frontmatter — the spec layer is simply absent and the chain
		// reads task ⇒ repo.
		expect(
			resolveItemPromptGuidance({testFirst: false}, fm(true), undefined),
		).toEqual({testFirst: true});
	});
});

describe('resolvePromptGuidanceForItem — the file-loading seam', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-override-resolve-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** Write a spec file with the given testFirst marker (or none). */
	function seedSpec(
		root: string,
		folder: 'specs-ready' | 'specs-tasked',
		slug: string,
		testFirst: boolean | undefined,
	): void {
		const dir = join(
			root,
			'work',
			folder === 'specs-ready' ? 'specs/ready' : 'specs/tasked',
		);
		mkdirSync(dir, {recursive: true});
		const body = ['---', `slug: ${slug}`];
		if (testFirst !== undefined) {
			body.push(`promptGuidance.testFirst: ${String(testFirst)}`);
		}
		body.push('---', '', '## Problem Statement', '', 'thing', '');
		writeFileSync(join(dir, `${slug}.md`), body.join('\n'));
	}

	function taskContent(
		slug: string,
		spec: string | undefined,
		testFirst: boolean | undefined,
	): string {
		const body = ['---', `slug: ${slug}`];
		if (spec !== undefined) {
			body.push(`spec: ${spec}`);
		}
		if (testFirst !== undefined) {
			body.push(`promptGuidance.testFirst: ${String(testFirst)}`);
		}
		body.push('---', '', '## Prompt', '', '> body', '');
		return body.join('\n');
	}

	it('loads the spec at specs/ready and applies its override over the repo policy', () => {
		seedSpec(scratch.root, 'specs-ready', 'my-spec', true);
		const content = taskContent('t', 'my-spec', undefined);
		const out = resolvePromptGuidanceForItem({
			cwd: scratch.root,
			repoResolved: {testFirst: false},
			taskContent: content,
		});
		expect(out).toEqual({testFirst: true});
	});

	it('falls back to specs/tasked when the spec is not in specs/ready', () => {
		seedSpec(scratch.root, 'specs-tasked', 'tasked-spec', true);
		const out = resolvePromptGuidanceForItem({
			cwd: scratch.root,
			repoResolved: {testFirst: false},
			taskContent: taskContent('t', 'tasked-spec', undefined),
		});
		expect(out).toEqual({testFirst: true});
	});

	it('a task override beats the spec override (per-task wins)', () => {
		seedSpec(scratch.root, 'specs-ready', 'my-spec', true);
		const out = resolvePromptGuidanceForItem({
			cwd: scratch.root,
			repoResolved: {testFirst: false},
			taskContent: taskContent('t', 'my-spec', false),
		});
		expect(out).toEqual({testFirst: false});
	});

	it('a missing spec file silently falls through to the repo policy (the override is OPTIONAL)', () => {
		const out = resolvePromptGuidanceForItem({
			cwd: scratch.root,
			repoResolved: {testFirst: true},
			taskContent: taskContent('t', 'absent-spec', undefined),
		});
		expect(out).toEqual({testFirst: true});
	});

	it('findSpecPath returns undefined when the spec is in neither folder', () => {
		expect(findSpecPath(scratch.root, 'nope')).toBeUndefined();
	});
});

describe('renderPrompt — per-item override is honoured at the assembly seam', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-prompt-override-render-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** Write a task + (optional) spec, with explicit per-item testFirst overrides. */
	function seedItem(
		root: string,
		slug: string,
		opts: {
			spec?: string;
			taskTestFirst?: boolean;
			specTestFirst?: boolean;
		},
	): void {
		const taskDir = join(root, 'work', 'tasks', 'ready');
		mkdirSync(taskDir, {recursive: true});
		const t = ['---', `slug: ${slug}`];
		if (opts.spec !== undefined) {
			t.push(`spec: ${opts.spec}`);
		}
		if (opts.taskTestFirst !== undefined) {
			t.push(`promptGuidance.testFirst: ${String(opts.taskTestFirst)}`);
		}
		t.push('---', '', '## Prompt', '', '> TASK-BODY', '');
		writeFileSync(join(taskDir, `${slug}.md`), t.join('\n'));
		if (opts.spec !== undefined) {
			const specDir = join(root, 'work', 'specs', 'ready');
			mkdirSync(specDir, {recursive: true});
			const b = ['---', `slug: ${opts.spec}`];
			if (opts.specTestFirst !== undefined) {
				b.push(`promptGuidance.testFirst: ${String(opts.specTestFirst)}`);
			}
			b.push('---', '', '## Problem Statement', '', 'thing', '');
			writeFileSync(join(specDir, `${opts.spec}.md`), b.join('\n'));
		}
	}

	/** The marker line ONLY the strengthened (ON) wrapper text carries. */
	const STRONG = 'failing test BEFORE the production code';
	/** The marker line ONLY the historic (OFF/soft) wrapper text carries. */
	const SOFT = 'TDD where the task asks for';

	it('repo=OFF, task=ON → strengthened (per-task opt-in beats repo default)', () => {
		seedItem(scratch.root, 'a', {taskTestFirst: true});
		const out = renderPrompt({
			slug: 'a',
			cwd: scratch.root,
			promptGuidance: {testFirst: false},
		});
		expect(out).toContain(STRONG);
		expect(out).not.toContain(SOFT);
	});

	it('repo=ON, task=OFF → soft (per-task opt-out beats repo default)', () => {
		seedItem(scratch.root, 'b', {taskTestFirst: false});
		const out = renderPrompt({
			slug: 'b',
			cwd: scratch.root,
			promptGuidance: {testFirst: true},
		});
		expect(out).toContain(SOFT);
		expect(out).not.toContain(STRONG);
	});

	it('repo=OFF, spec=ON, task=(omit) → strengthened (inherits the spec)', () => {
		seedItem(scratch.root, 'c', {spec: 'feature-x', specTestFirst: true});
		const out = renderPrompt({
			slug: 'c',
			cwd: scratch.root,
			promptGuidance: {testFirst: false},
		});
		expect(out).toContain(STRONG);
		expect(out).not.toContain(SOFT);
	});

	it('repo=OFF, spec=ON, task=OFF → soft (per-task beats per-spec)', () => {
		seedItem(scratch.root, 'd', {
			spec: 'feature-x',
			specTestFirst: true,
			taskTestFirst: false,
		});
		const out = renderPrompt({
			slug: 'd',
			cwd: scratch.root,
			promptGuidance: {testFirst: false},
		});
		expect(out).toContain(SOFT);
		expect(out).not.toContain(STRONG);
	});

	it('repo=OFF, no overrides → soft (the unchanged default path)', () => {
		seedItem(scratch.root, 'e', {});
		const out = renderPrompt({
			slug: 'e',
			cwd: scratch.root,
			promptGuidance: {testFirst: false},
		});
		expect(out).toContain(SOFT);
		expect(out).not.toContain(STRONG);
	});

	it('repo=ON, no overrides → strengthened (the repo-policy path)', () => {
		seedItem(scratch.root, 'f', {});
		const out = renderPrompt({
			slug: 'f',
			cwd: scratch.root,
			promptGuidance: {testFirst: true},
		});
		expect(out).toContain(STRONG);
		expect(out).not.toContain(SOFT);
	});
});

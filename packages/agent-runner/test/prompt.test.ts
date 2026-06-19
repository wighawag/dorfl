import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	extractPromptSection,
	extractCanonicalWrapperTemplate,
	resolveClaimProtocolPath,
	wrapper,
	buildAgentPrompt,
	buildContinueBlock,
	extractRequeueNotes,
	resolveContinueContext,
	resolveSlice,
	inferSlugFromBranch,
	renderPrompt,
	PromptError,
	type ContinueContext,
} from '../src/prompt.js';
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

const SLICE = `---
title: Example slice
slug: example
prd: my-prd
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

/** Write a slice file into work/<folder>/<slug>.md under root, return root. */
function seedSlice(
	root: string,
	folder: 'in-progress' | 'backlog',
	slug: string,
	body: string,
	prd = 'my-prd',
): void {
	const dir = join(root, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	const content = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`prd: ${prd}`,
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

/** Slice file CONTENT (not written to disk) for the done/-continue fixtures. */
function doneSlice(slug: string, prd = 'my-prd'): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`prd: ${prd}`,
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
		const prompt = extractPromptSection(SLICE)!;
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
	it('the emitted wrapper IS the CLAIM-PROTOCOL template with <slug>/<prd> substituted', () => {
		const protocol = readFileSync(CLAIM_PROTOCOL, 'utf8');
		const template = extractCanonicalWrapperTemplate(protocol);

		// Sanity: the canonical template carries the placeholders we substitute.
		expect(template).toContain('<slug>');

		const emitted = wrapper('example', 'my-prd');
		const expected = template
			.replace(/<slug>/g, 'example')
			.replace(/<prd>/g, 'my-prd');
		expect(emitted).toBe(expected);
	});

	it('substitutes <slug> everywhere it appears in the canonical text', () => {
		const emitted = wrapper('my-slug', 'my-prd');
		// The canonical wrapper comes from CLAIM-PROTOCOL.md (the PROTOCOL doc), which
		// this notes-regroup + task-board-rename slice deliberately leaves UNTOUCHED
		// (the protocol-doc mirror is a sibling slice). So the emitted slice-body path
		// is still the protocol's current `work/backlog/<slug>.md`.
		expect(emitted).toContain('work/backlog/my-slug.md');
		expect(emitted).not.toContain('<slug>');
	});

	it('substitutes the source PRD path (work/prd/<prd>.md)', () => {
		const emitted = wrapper('example', 'agent-runner');
		expect(emitted).toContain('agent-runner');
		expect(emitted).not.toContain('<prd>');
	});

	it('resolveClaimProtocolPath finds the bundled contract by default', () => {
		const resolved = resolveClaimProtocolPath();
		expect(resolved.endsWith('CLAIM-PROTOCOL.md')).toBe(true);
		expect(readFileSync(resolved, 'utf8')).toContain(
			'prompt handed to the work agent',
		);
	});

	it('the assembled wrapper carries the machine-readable STOP sentinel form (Part A)', () => {
		const emitted = wrapper('example', 'my-prd');
		// The runner detects this EXACT block; it must be in-band in the prompt.
		expect(emitted).toContain('=== SLICE-STOP ===');
		expect(emitted).toContain('=== END SLICE-STOP ===');
		// The reason goes INSIDE the block (it becomes the needs-attention reason).
		expect(emitted).toMatch(/reason.*INSIDE it|INSIDE it/i);
	});

	it('the assembled wrapper carries the ## Decisions block + reframed decision bar (Part B)', () => {
		const emitted = wrapper('example', 'my-prd');
		expect(emitted).toContain('## Decisions');
		// The reframed bar: a choice touching another command/flag/slice or a
		// user-visible default is a DESIGN decision, not a small factual gap.
		expect(emitted).toMatch(/DESIGN decision/);
		expect(emitted).toMatch(/command\/flag\/slice/);
		expect(emitted).toMatch(/USER-VISIBLE DEFAULT|user-visible default/i);
		// It must NOT block the build (record, proceed).
		expect(emitted).toMatch(/does NOT stop\s+the build/i);
	});
});

describe('resolveClaimProtocolPath — packaged-CLI-safe resolution order', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-protocol-resolve-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** The vendored in-package copy the build step writes (`dist/protocol/`). */
	const VENDORED = resolve(HERE, '..', 'dist', 'protocol', 'CLAIM-PROTOCOL.md');

	it('prefers the TARGET repo work/protocol/ copy when present', () => {
		// A set-up target repo carries its adopted copy; it must WIN over the
		// bundled/dev fallbacks (it reflects the protocol version that repo adopted).
		const protoDir = join(scratch.root, 'work', 'protocol');
		mkdirSync(protoDir, {recursive: true});
		const target = join(protoDir, 'CLAIM-PROTOCOL.md');
		writeFileSync(target, 'TARGET-REPO PROTOCOL COPY\n');

		const resolved = resolveClaimProtocolPath(scratch.root);
		expect(resolved).toBe(target);
		expect(readFileSync(resolved, 'utf8')).toContain(
			'TARGET-REPO PROTOCOL COPY',
		);
	});

	it('falls back to the VENDORED in-package copy in a simulated installed layout', () => {
		// Installed-CLI shape: the target repo has NO work/protocol/ and there is no
		// reachable sibling skills/ tree. The resolver must pick the bundled copy
		// (ranked above the dev-only skills/ walk) so prompt assembly never ENOENTs.
		const resolved = resolveClaimProtocolPath(scratch.root);
		expect(resolved).toBe(VENDORED);
		expect(readFileSync(resolved, 'utf8')).toContain(
			'prompt handed to the work agent',
		);
	});

	it('the override short-circuits ahead of every other source', () => {
		const protoDir = join(scratch.root, 'work', 'protocol');
		mkdirSync(protoDir, {recursive: true});
		writeFileSync(join(protoDir, 'CLAIM-PROTOCOL.md'), 'TARGET\n');
		const override = join(scratch.root, 'explicit.md');
		writeFileSync(override, 'OVERRIDE\n');
		expect(resolveClaimProtocolPath(scratch.root, override)).toBe(override);
	});
});

describe('buildAgentPrompt — packaged + target-repo protocol sources', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-protocol-build-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('builds a prompt from the VENDORED copy when no work/protocol/ exists (no ENOENT)', () => {
		// The regression guard: against a temp dir with no work/protocol/ (and no
		// sibling skills/), buildAgentPrompt must return a prompt, not throw ENOENT.
		const out = buildAgentPrompt('example', 'my-prd', 'SLICE-BODY', {
			cwd: scratch.root,
		});
		expect(out).toContain('work/backlog/example.md');
		expect(out).toContain('SLICE-BODY');
		expect(out).not.toContain('<slug>');
	});

	it('builds a prompt from the TARGET repo work/protocol/ copy when present', () => {
		// Seed a target-repo copy whose canonical wrapper carries a UNIQUE marker so
		// we can prove THAT copy (not the bundled one) was the source.
		// 'complete brief' is inside the canonical wrapper template; tagging it in the
		// target copy proves THAT copy (not the bundled one) was the prompt source.
		const bundled = readFileSync(resolveClaimProtocolPath(), 'utf8');
		expect(bundled).toContain('complete brief');
		const tagged = bundled.replace(
			'complete brief',
			'TARGET-MARKER complete brief',
		);
		const protoDir = join(scratch.root, 'work', 'protocol');
		mkdirSync(protoDir, {recursive: true});
		writeFileSync(join(protoDir, 'CLAIM-PROTOCOL.md'), tagged);

		const out = buildAgentPrompt('example', 'my-prd', 'SLICE-BODY', {
			cwd: scratch.root,
		});
		expect(out).toContain('TARGET-MARKER complete brief');
	});
});

describe('buildAgentPrompt', () => {
	it('is the canonical wrapper followed by the slice prompt body verbatim', () => {
		const prompt = buildAgentPrompt('example', 'my-prd', 'UNIQUE-MARKER-123');
		expect(prompt).toContain(wrapper('example', 'my-prd'));
		expect(prompt).toContain('UNIQUE-MARKER-123');
	});

	it('only slug/prd vary in the wrapper (two slices share the wrapper text)', () => {
		const a = buildAgentPrompt('alpha', 'prd-a', 'BODY');
		const b = buildAgentPrompt('bravo', 'prd-b', 'BODY');
		const stripA = a.replace(/alpha/g, 'SLUG').replace(/prd-a/g, 'PRD');
		const stripB = b.replace(/bravo/g, 'SLUG').replace(/prd-b/g, 'PRD');
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
			branch: 'work/slice-my-slug',
			reason: '',
			requeueNotes: [],
		};
		const block = buildContinueBlock('my-slug', ctx);
		expect(block).toMatch(/CONTINUING/i);
		expect(block).toContain('origin/main...work/slice-my-slug');
	});

	it('includes the needs-attention reason when present', () => {
		const ctx: ContinueContext = {
			arbiter: 'origin',
			branch: 'work/slice-my-slug',
			reason: 'the acceptance gate was red',
			requeueNotes: [],
		};
		const block = buildContinueBlock('my-slug', ctx);
		expect(block).toContain('the acceptance gate was red');
	});

	it('includes the requeue handoff note(s) when present', () => {
		const ctx: ContinueContext = {
			arbiter: 'origin',
			branch: 'work/slice-my-slug',
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
			branch: 'work/slice-my-slug',
			reason: '',
			requeueNotes: [],
		});
		expect(block).not.toMatch(/needs-attention reason/i);
		expect(block).not.toMatch(/handoff note/i);
	});
});

describe('buildAgentPrompt — continue-mode vs fresh-mode', () => {
	const FRESH = buildAgentPrompt('example', 'my-prd', 'SLICE-BODY');

	it('fresh-mode (no continueContext) is byte-identical to the baseline', () => {
		// The baseline = wrapper + slice body, no CONTINUE block. Passing options
		// without a continueContext must not alter a single byte.
		const again = buildAgentPrompt('example', 'my-prd', 'SLICE-BODY', {});
		expect(again).toBe(FRESH);
		expect(FRESH).toContain(wrapper('example', 'my-prd'));
		expect(FRESH).toContain('SLICE-BODY');
		expect(FRESH).not.toMatch(/CONTINUING/i);
	});

	it('continue-mode injects the CONTINUE block before the slice body', () => {
		const out = buildAgentPrompt('example', 'my-prd', 'SLICE-BODY', {
			continueContext: {
				arbiter: 'origin',
				branch: 'work/slice-example',
				reason: 'the gate was red',
				requeueNotes: ['use the v2 helper'],
			},
		});
		// It is a SUPERSET of fresh: same wrapper + same slice body, PLUS the block.
		expect(out).toContain(wrapper('example', 'my-prd'));
		expect(out).toContain('SLICE-BODY');
		expect(out).toMatch(/CONTINUING/i);
		expect(out).toContain('origin/main...work/slice-example');
		expect(out).toContain('the gate was red');
		expect(out).toContain('use the v2 helper');
		// The block precedes the slice body in the assembly.
		expect(out.indexOf('CONTINUING')).toBeLessThan(out.indexOf('SLICE-BODY'));
		expect(out).not.toBe(FRESH);
	});
});

describe('resolveContinueContext — reuse branchAheadOf detection', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-prompt-continue-');
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
		gitIn(['branch', `work/slice-${slug}`], repo);
		if (ahead) {
			gitIn(['switch', '-q', `work/slice-${slug}`], repo);
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
			branchRef: 'work/slice-alpha',
			mainRef: 'main',
			content: BODY,
			env: gitEnv(),
		});
		expect(ctx).toBeDefined();
		expect(ctx!.arbiter).toBe('origin');
		// The namespaced branch is recovered from branchRef (no `<arbiter>/` prefix
		// to strip here) — the continue-block prose points the agent at it.
		expect(ctx!.branch).toBe('work/slice-alpha');
		expect(ctx!.reason).toBe('the acceptance gate was red');
		expect(ctx!.requeueNotes).toEqual(['try the other approach']);
	});

	it('returns undefined (fresh) when the branch is NOT ahead of main', () => {
		const repo = repoWithKeptBranch('beta', false);
		const ctx = resolveContinueContext({
			cwd: repo,
			slug: 'beta',
			arbiter: 'origin',
			branchRef: 'work/slice-beta',
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
			branchRef: 'work/slice-absent-slug',
			mainRef: 'main',
			content: BODY,
			env: gitEnv(),
		});
		expect(ctx).toBeUndefined();
	});
});

describe('resolveSlice — in-progress over backlog', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-prompt-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('resolves from work/in-progress/ when present', () => {
		seedSlice(scratch.root, 'in-progress', 'foo', '> in-progress body');
		const slice = resolveSlice(scratch.root, 'foo');
		expect(slice.folder).toBe('in-progress');
		expect(slice.slicePrompt).toContain('in-progress body');
		expect(slice.prd).toBe('my-prd');
	});

	it('falls back to work/tasks/todo/ when not in-progress', () => {
		seedSlice(scratch.root, 'backlog', 'bar', '> backlog body');
		const slice = resolveSlice(scratch.root, 'bar');
		expect(slice.folder).toBe('backlog');
		expect(slice.slicePrompt).toContain('backlog body');
	});

	it('prefers in-progress when the slug exists in BOTH folders', () => {
		seedSlice(scratch.root, 'backlog', 'dup', '> the BACKLOG copy');
		seedSlice(scratch.root, 'in-progress', 'dup', '> the IN-PROGRESS copy');
		const slice = resolveSlice(scratch.root, 'dup');
		expect(slice.folder).toBe('in-progress');
		expect(slice.slicePrompt).toContain('IN-PROGRESS');
		expect(slice.slicePrompt).not.toContain('BACKLOG');
	});

	it('throws PromptError when the slug is in neither folder', () => {
		expect(() => resolveSlice(scratch.root, 'missing')).toThrow(PromptError);
	});
});

describe('resolveSlice — done/ on a CONTINUE, gated by tip-vs-arbiter (story 5)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-prompt-done-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/**
	 * Build a throwaway repo whose slice `<slug>` has been DONE-MOVED into
	 * `work/tasks/done/` on a `work/slice-<slug>` branch, with a sibling `--bare`
	 * arbiter. `integrated` controls the tip-vs-arbiter state under test:
	 *   - `false` (STRANDED): the done-move commit is committed on the branch but
	 *     NOT pushed to the arbiter — `arbiter/main` lacks it (the strand state).
	 *   - `true`  (COMPLETE): the done-move commit IS on `arbiter/main` (integrated).
	 * Returns the working repo path; the branch tip is left checked out, and the
	 * remote-tracking refs (`arbiter/work/slice-<slug>`, `arbiter/main`) are
	 * fetched — exactly the in-place-clone refs the `do` caller feeds the gate.
	 */
	function doneMovedRepo(slug: string, integrated: boolean): string {
		const repo = join(scratch.root, `repo-${slug}`);
		const arbiter = join(scratch.root, `arbiter-${slug}.git`);
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		// Seed main with the slice already claimed into in-progress/.
		const inProgress = join(repo, 'work', 'in-progress');
		mkdirSync(inProgress, {recursive: true});
		writeFileSync(join(inProgress, `${slug}.md`), doneSlice(slug));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'claim: in-progress'], repo);
		// A bare arbiter mirroring main at the CLAIM commit.
		gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
		// The done-move commit: in-progress/ -> done/, on a work/slice-<slug> branch.
		gitIn(['switch', '-q', '-c', `work/slice-${slug}`], repo);
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/in-progress/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
		gitIn(['commit', '-q', '-m', `done: ${slug}`], repo);
		if (integrated) {
			// COMPLETE: the done-move tip is published to arbiter/main (integrated).
			gitIn(['push', '-q', 'arbiter', `work/slice-${slug}:main`], repo);
		}
		// Else STRANDED: the done-move stays committed-but-unpushed on the branch.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		return repo;
	}

	/** The continue gate the in-place `do` caller feeds resolveSlice. */
	function inPlaceGate(repo: string, slug: string) {
		return {
			cwd: repo,
			branchRef: `arbiter/work/slice-${slug}`,
			mainRef: 'arbiter/main',
			env: gitEnv(),
		};
	}

	it('(a) STRANDED: resolves a done/ slice on a continue (tip NOT on arbiter)', () => {
		const repo = doneMovedRepo('alpha', false);
		// Push the work branch to the arbiter so the remote-tracking branchRef
		// resolves (the strand keeps the branch, just NOT merged to main).
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const slice = resolveSlice(repo, 'alpha', inPlaceGate(repo, 'alpha'));
		expect(slice.folder).toBe('done');
		expect(slice.slicePrompt).toContain('Implement alpha.');
	});

	it('(b) COMPLETE: does NOT resolve a done/ slice whose tip is on arbiter/main', () => {
		const repo = doneMovedRepo('beta', true);
		// The branch tip == arbiter/main (integrated). A continue gate must NOT admit
		// done/ — onboard must not resurrect a finished slice — so this is "not found".
		expect(() => resolveSlice(repo, 'beta', inPlaceGate(repo, 'beta'))).toThrow(
			PromptError,
		);
	});

	it('does NOT admit done/ on a FRESH claim (no continue gate), even if stranded', () => {
		const repo = doneMovedRepo('gamma', false);
		gitIn(['push', '-q', 'arbiter', 'work/slice-gamma:work/slice-gamma'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// No gate => the original ['in-progress','backlog']-only resolution; done/ is
		// unreachable, so the slug (now only in done/) is "not found".
		expect(() => resolveSlice(repo, 'gamma')).toThrow(PromptError);
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
		writeFileSync(join(ip, 'delta.md'), doneSlice('delta'));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-delta'], repo);
		writeFileSync(join(repo, 'extra.txt'), 'stranded churn\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-delta:work/slice-delta'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const slice = resolveSlice(repo, 'delta', inPlaceGate(repo, 'delta'));
		expect(slice.folder).toBe('in-progress');
	});
});

describe('renderPrompt — slug given', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-prompt-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('renders the wrapper + slice prompt for an explicit slug', () => {
		seedSlice(scratch.root, 'in-progress', 'given', '> GIVEN-BODY', 'the-prd');
		const out = renderPrompt({slug: 'given', cwd: scratch.root});
		expect(out).toContain('work/backlog/given.md');
		expect(out).toContain('the-prd');
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
		seedSlice(scratch.root, 'backlog', 'given', '> GIVEN-BODY');
		const out = renderPrompt({slug: 'given', cwd: scratch.root});
		expect(out).toContain('work/backlog/given.md');
		expect(out).toContain('GIVEN-BODY');
	});
});

describe('renderPrompt — slug inferred from a work/<slug> branch', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-prompt-');
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
		seedSlice(scratch.root, 'in-progress', 'inferred', '> INFERRED-BODY');
		const out = renderPrompt({cwd: scratch.root, env: gitEnv()});
		expect(out).toContain('work/backlog/inferred.md');
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

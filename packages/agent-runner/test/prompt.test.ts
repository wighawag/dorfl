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
	resolveSlice,
	inferSlugFromBranch,
	renderPrompt,
	PromptError,
} from '../src/prompt.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The canonical work-contract, at the monorepo root. */
const CLAIM_PROTOCOL = resolve(
	HERE,
	'..',
	'..',
	'..',
	'skills',
	'to-slices',
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
	const dir = join(root, 'work', folder);
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
		expect(emitted).toContain('work/in-progress/my-slug.md');
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

	it('falls back to work/backlog/ when not in-progress', () => {
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
		expect(out).toContain('work/in-progress/given.md');
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
		expect(out).toContain('work/in-progress/given.md');
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
		expect(out).toContain('work/in-progress/inferred.md');
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

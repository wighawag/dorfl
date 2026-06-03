import {describe, it, expect} from 'vitest';
import {extractPromptSection, buildAgentPrompt} from '../src/prompt.js';

const SLICE = `---
title: Example slice
slug: example
afk: true
blocked_by: []
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

describe('extractPromptSection', () => {
	it('extracts the body under the ## Prompt heading', () => {
		const prompt = extractPromptSection(SLICE);
		expect(prompt).toContain('Build the example feature.');
		expect(prompt).toContain('Make the tests green.');
	});

	it('does NOT include the heading line itself', () => {
		const prompt = extractPromptSection(SLICE);
		expect(prompt).not.toContain('## Prompt');
	});

	it('strips leading blockquote markers from each line', () => {
		const prompt = extractPromptSection(SLICE);
		// the `> ` quoting used in slice templates should be removed
		expect(prompt).not.toMatch(/^>/m);
	});

	it('stops at the next heading of the same or higher level', () => {
		const withTrailer = `## Prompt

> The prompt body.

## Notes

Not part of the prompt.
`;
		const prompt = extractPromptSection(withTrailer);
		expect(prompt).toContain('The prompt body.');
		expect(prompt).not.toContain('Not part of the prompt.');
	});

	it('returns undefined when there is no ## Prompt section', () => {
		expect(extractPromptSection('# Title\n\nno prompt here')).toBeUndefined();
	});

	it('is case-insensitive about the heading text', () => {
		const lower = '## prompt\n\n> hello\n';
		expect(extractPromptSection(lower)).toContain('hello');
	});
});

describe('buildAgentPrompt', () => {
	it('embeds the slug and points the agent at the in-progress brief', () => {
		const prompt = buildAgentPrompt('example', extractPromptSection(SLICE)!);
		expect(prompt).toContain('work/in-progress/example.md');
	});

	it('draws the git boundary in-band (no commit/push, no moving work/ files)', () => {
		const prompt = buildAgentPrompt('example', 'do the thing');
		expect(prompt.toLowerCase()).toContain('do not commit');
		expect(prompt.toLowerCase()).toContain('push');
		expect(prompt.toLowerCase()).toContain('work/');
	});

	it('tells the agent its own tests MAY use throwaway repos', () => {
		const prompt = buildAgentPrompt('example', 'do the thing');
		expect(prompt.toLowerCase()).toContain('throwaway');
	});

	it('instructs to stop and report when build/test/format are green', () => {
		const prompt = buildAgentPrompt('example', 'do the thing');
		const lower = prompt.toLowerCase();
		expect(lower).toContain('build');
		expect(lower).toContain('test');
		expect(lower).toContain('format');
	});

	it('appends the slice prompt body verbatim', () => {
		const prompt = buildAgentPrompt('example', 'UNIQUE-MARKER-123');
		expect(prompt).toContain('UNIQUE-MARKER-123');
	});

	it('only the slug varies in the wrapper (two slices share the wrapper text)', () => {
		const a = buildAgentPrompt('alpha', 'BODY');
		const b = buildAgentPrompt('bravo', 'BODY');
		// remove slug tokens; the rest of the wrapper must be identical
		const stripA = a.replace(/alpha/g, 'SLUG');
		const stripB = b.replace(/bravo/g, 'SLUG');
		expect(stripA).toBe(stripB);
	});
});

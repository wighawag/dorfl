import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {renderTaskBody, renderPrdBody} from '../src/buildable-body.js';
import {extractPromptSection, resolveTask} from '../src/prompt.js';
import {gitIn} from './helpers/gitRepo.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * The SINGLE GOLDEN-SHAPE test for the shared buildable-task / PRD-body renderer
 * (prd `centralize-buildable-task-renderer-shared-by-intake-and-promotion` US
 * #7) — the test the two future producers (intake's `renderBacklogTask`/`renderPrd`
 * and `triage-persist.buildPromotedBody`) will SHARE, so a schema change cannot
 * silently apply to only one of them.
 *
 * Two complementary kinds of assertion:
 *   - PURE-RENDER: each artifact type emits its required sections (task:
 *     `## What to build`, `## Acceptance criteria` when given, `## Prompt`; prd:
 *     `## Problem Statement`, NO `## Prompt`), in BOTH the intake-default-scaffold
 *     and the promotion-structured shapes;
 *   - DISPATCHABILITY: a rendered task (wrapped in frontmatter, as the callers
 *     will) PASSES `extractPromptSection` AND `resolveTask` from a throwaway git
 *     repo's `work/tasks/ready/` — WITHOUT the "has no '## Prompt' section" throw.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-buildable-body-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Wrap a rendered body in minimal task frontmatter (what the callers will do). */
function wrapTask(slug: string, body: string): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'blockedBy: []',
		'---',
		'',
		body,
	].join('\n');
}

describe('renderTaskBody — the shared buildable-TASK section skeleton', () => {
	it("expresses intake's DEFAULT-SCAFFOLD shape (## What to build + ## Acceptance criteria + thin ## Prompt)", () => {
		const body = renderTaskBody({
			whatToBuild: 'Resolve issue #42: do the thing',
			acceptanceCriteria: '- [ ] the issue is resolved',
			prompt: 'Resolve issue #42: do the thing',
		});
		// The three default-scaffold sections, in order.
		expect(body).toContain('## What to build');
		expect(body).toContain('## Acceptance criteria');
		expect(body).toContain('## Prompt');
		expect(body.indexOf('## What to build')).toBeLessThan(
			body.indexOf('## Acceptance criteria'),
		);
		expect(body.indexOf('## Acceptance criteria')).toBeLessThan(
			body.indexOf('## Prompt'),
		);
		// The default scaffold carries no open-questions block.
		expect(body).not.toContain('## Open questions');
		// `## Prompt` is blockquoted (the `> `-shape `extractPromptSection` strips).
		expect(body).toContain('> Resolve issue #42: do the thing');
	});

	it("expresses promotion's STRUCTURED shape (## What to build + ## Open questions + seeded ## Prompt, NO ## Acceptance criteria)", () => {
		const mechanism =
			'claim-cas.ts:270 exits 2 on a stale snapshot; add a flag.';
		const openQ = '1. Should it be the default, or opt-in behind a flag?';
		const body = renderTaskBody({
			whatToBuild: mechanism,
			openQuestions: openQ,
			prompt: mechanism,
		});
		expect(body).toContain('## What to build');
		expect(body).toContain(mechanism);
		expect(body).toContain('## Open questions');
		expect(body).toContain(openQ);
		expect(body).toContain('## Prompt');
		// Promotion's structured body carries NO acceptance section.
		expect(body).not.toContain('## Acceptance criteria');
		// The `## Prompt` is SEEDED (blockquoted) from the mechanism prose.
		const prompt = extractPromptSection(body);
		expect(prompt).toContain(mechanism);
	});

	it('ALWAYS emits a non-empty `## Prompt` even when no seed is supplied (never the promptless bug)', () => {
		const body = renderTaskBody({whatToBuild: 'x', prompt: ''});
		expect(body).toContain('## Prompt');
		expect(extractPromptSection(body)).toBeDefined();
	});

	it('drops the optional ## Acceptance criteria / ## Open questions sections when empty', () => {
		const body = renderTaskBody({
			whatToBuild: 'x',
			acceptanceCriteria: '   ',
			openQuestions: '',
			prompt: 'p',
		});
		expect(body).not.toContain('## Acceptance criteria');
		expect(body).not.toContain('## Open questions');
	});

	it('a rendered task PASSES extractPromptSection / resolveTask without the missing-`## Prompt` throw', () => {
		const repo = join(scratch.root, 'p');
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);

		const mechanism = 'the real seeded mechanism signal';
		const body = renderTaskBody({
			whatToBuild: mechanism,
			openQuestions: '1. a question',
			prompt: mechanism,
		});
		const slug = 'rendered';
		writeFileSync(
			join(repo, 'work', 'tasks', 'ready', `${slug}.md`),
			wrapTask(slug, body),
		);

		// The consumer the producers must satisfy: no "has no '## Prompt' section" throw.
		expect(() => resolveTask(repo, slug)).not.toThrow();
		const resolved = resolveTask(repo, slug);
		expect(resolved.taskPrompt).toContain(mechanism);
	});
});

describe('renderPrdBody — the symmetric PRD-body section skeleton', () => {
	it('emits ## Problem Statement and NO ## Prompt (a PRD is not dispatched)', () => {
		const body = renderPrdBody({
			problemStatement: 'Transformed from issue #7: the problem',
		});
		expect(body).toContain('## Problem Statement');
		expect(body).not.toContain('## Prompt');
	});

	it('transcribes an ## Open questions block when given, and drops it when empty', () => {
		const withQ = renderPrdBody({
			problemStatement: 'a problem',
			openQuestions: '1. an open scoping question',
		});
		expect(withQ).toContain('## Open questions');
		expect(withQ).toContain('1. an open scoping question');

		const withoutQ = renderPrdBody({problemStatement: 'a problem'});
		expect(withoutQ).not.toContain('## Open questions');
		// Still never a prompt.
		expect(withoutQ).not.toContain('## Prompt');
	});

	it("expresses intake's DEFAULT PRD SCAFFOLD shape (## Problem Statement + ## Solution + ## User Stories, NO ## Open questions / ## Prompt)", () => {
		const body = renderPrdBody({
			problemStatement: 'Transformed from issue #7: the problem',
			solution: '(to be detailed; this prd needs tasking via `do prd:`).',
			userStories: '1. As a user, I want issue #7 addressed.',
		});
		expect(body).toContain('## Problem Statement');
		expect(body).toContain('## Solution');
		expect(body).toContain('## User Stories');
		// Canonical order: Problem Statement → Solution → User Stories.
		expect(body.indexOf('## Problem Statement')).toBeLessThan(
			body.indexOf('## Solution'),
		);
		expect(body.indexOf('## Solution')).toBeLessThan(
			body.indexOf('## User Stories'),
		);
		// The default scaffold carries no open-questions block and never a prompt.
		expect(body).not.toContain('## Open questions');
		expect(body).not.toContain('## Prompt');
	});

	it('emits ## Solution and ## User Stories each only when supplied, dropping each independently', () => {
		// Solution only.
		const solOnly = renderPrdBody({
			problemStatement: 'a problem',
			solution: 'the solution prose',
		});
		expect(solOnly).toContain('## Solution');
		expect(solOnly).toContain('the solution prose');
		expect(solOnly).not.toContain('## User Stories');

		// User Stories only.
		const usOnly = renderPrdBody({
			problemStatement: 'a problem',
			userStories: '1. As a user, I want a thing.',
		});
		expect(usOnly).toContain('## User Stories');
		expect(usOnly).toContain('1. As a user, I want a thing.');
		expect(usOnly).not.toContain('## Solution');

		// Empty/whitespace inputs drop both sections.
		const emptyBoth = renderPrdBody({
			problemStatement: 'a problem',
			solution: '   ',
			userStories: '',
		});
		expect(emptyBoth).not.toContain('## Solution');
		expect(emptyBoth).not.toContain('## User Stories');
	});

	it('canonical full order is Problem Statement → Solution → User Stories → Open questions', () => {
		const body = renderPrdBody({
			problemStatement: 'a problem',
			solution: 'a solution',
			userStories: '1. a story',
			openQuestions: '1. an open question',
		});
		expect(body.indexOf('## Problem Statement')).toBeLessThan(
			body.indexOf('## Solution'),
		);
		expect(body.indexOf('## Solution')).toBeLessThan(
			body.indexOf('## User Stories'),
		);
		expect(body.indexOf('## User Stories')).toBeLessThan(
			body.indexOf('## Open questions'),
		);
		expect(body).not.toContain('## Prompt');
	});

	it('keeps the existing promotion shape (neither new input) BYTE-FOR-BYTE unchanged', () => {
		// The already-merged promotion caller passes neither solution nor userStories;
		// the additive change must not alter its output by a single byte.
		const promotionWithQ = renderPrdBody({
			problemStatement: 'the mechanism prose',
			openQuestions: '1. an open scoping question',
		});
		expect(promotionWithQ).toBe(
			[
				'## Problem Statement',
				'',
				'the mechanism prose',
				'',
				'## Open questions',
				'',
				'1. an open scoping question',
				'',
			].join('\n'),
		);

		const promotionNoQ = renderPrdBody({
			problemStatement: 'the mechanism prose',
		});
		expect(promotionNoQ).toBe(
			['## Problem Statement', '', 'the mechanism prose', ''].join('\n'),
		);
	});
});

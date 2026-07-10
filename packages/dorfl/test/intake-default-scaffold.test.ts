import {describe, it, expect} from 'vitest';
import {renderBacklogTask, renderSpec} from '../src/intake.js';

/**
 * Characterisation (golden) test for intake's task/PRD renderers
 * (prd `centralize-buildable-task-renderer-shared-by-intake-and-promotion`, US
 * #2). It pins intake's EMITTED BYTES for both the drafted-body wrap path AND the
 * no-body-drafted DEFAULT SCAFFOLD, so the rewire that sources the empty-body
 * scaffold from the shared renderer (`buildable-body.ts`) is proven to be a pure
 * internal re-source with NO output drift.
 *
 * The goldens below are the literal bytes intake produced BEFORE the rewire
 * (asserted as whole-string equality, not section presence — the
 * byte-drift-the-test-misses pattern that bit the promotion rewire). The
 * drafted-body path is the control: it must stay verbatim-wrapped, never
 * re-rendered.
 */
describe('intake renderBacklogTask — task body', () => {
	it('wraps a DRAFTED body verbatim (frontmatter + drafted, trimmed, one trailing newline)', () => {
		const draftedBody = [
			'## What to build',
			'',
			'A --quiet flag on the CLI that suppresses the progress notes.',
			'',
			'## Acceptance criteria',
			'',
			'- [ ] --quiet suppresses the >> notes',
			'',
			'## Prompt',
			'',
			'> Add a --quiet flag.',
		].join('\n');
		const out = renderBacklogTask({
			slug: 'add-quiet-flag',
			title: 'Add a --quiet flag',
			body: draftedBody,
			issueNumber: 42,
		});
		expect(out).toBe(
			'---\n' +
				'title: Add a --quiet flag\n' +
				'slug: add-quiet-flag\n' +
				'issue: 42\n' +
				'covers: []\n' +
				'blockedBy: []\n' +
				'---\n' +
				'\n' +
				'## What to build\n' +
				'\n' +
				'A --quiet flag on the CLI that suppresses the progress notes.\n' +
				'\n' +
				'## Acceptance criteria\n' +
				'\n' +
				'- [ ] --quiet suppresses the >> notes\n' +
				'\n' +
				'## Prompt\n' +
				'\n' +
				'> Add a --quiet flag.\n',
		);
	});

	it('emits the DEFAULT SCAFFOLD byte-for-byte when no body is drafted', () => {
		const out = renderBacklogTask({
			slug: 'fix-the-thing',
			title: 'Fix the thing',
			body: undefined,
			issueNumber: 7,
		});
		expect(out).toBe(
			'---\n' +
				'title: Fix the thing\n' +
				'slug: fix-the-thing\n' +
				'issue: 7\n' +
				'covers: []\n' +
				'blockedBy: []\n' +
				'---\n' +
				'\n' +
				'## What to build\n' +
				'\n' +
				'Fix the thing\n' +
				'\n' +
				'## Acceptance criteria\n' +
				'\n' +
				'- [ ] the issue is resolved\n' +
				'\n' +
				'## Prompt\n' +
				'\n' +
				'> Resolve issue #7: Fix the thing\n',
		);
	});

	it('treats an empty/whitespace drafted body as no-body (falls back to scaffold)', () => {
		const out = renderBacklogTask({
			slug: 'fix-the-thing',
			title: 'Fix the thing',
			body: '   \n  ',
			issueNumber: 7,
		});
		expect(out).toContain('## What to build\n\nFix the thing\n');
		expect(out).toContain('> Resolve issue #7: Fix the thing\n');
	});

	it('preserves the origin-trust stamp in the scaffold output', () => {
		const out = renderBacklogTask({
			slug: 'fix-the-thing',
			title: 'Fix the thing',
			body: undefined,
			issueNumber: 7,
			originTrust: 'untrusted',
		});
		expect(out).toBe(
			'---\n' +
				'title: Fix the thing\n' +
				'slug: fix-the-thing\n' +
				'issue: 7\n' +
				'origin: issue\n' +
				'originTrust: untrusted\n' +
				'covers: []\n' +
				'blockedBy: []\n' +
				'---\n' +
				'\n' +
				'## What to build\n' +
				'\n' +
				'Fix the thing\n' +
				'\n' +
				'## Acceptance criteria\n' +
				'\n' +
				'- [ ] the issue is resolved\n' +
				'\n' +
				'## Prompt\n' +
				'\n' +
				'> Resolve issue #7: Fix the thing\n',
		);
	});
});

describe('intake renderSpec — PRD body', () => {
	it('wraps a DRAFTED PRD body verbatim', () => {
		const draftedBody = [
			'## Problem Statement',
			'',
			'The thing is broken.',
			'',
			'## Solution',
			'',
			'Fix it well.',
			'',
			'## User Stories',
			'',
			'1. As a user, I want it fixed.',
		].join('\n');
		const out = renderSpec({
			slug: 'fix-thing-prd',
			title: 'Fix the thing properly',
			body: draftedBody,
			issueNumber: 9,
			humanOnly: undefined,
			needsAnswers: undefined,
		});
		expect(out).toBe(
			'---\n' +
				'title: Fix the thing properly\n' +
				'slug: fix-thing-prd\n' +
				'issue: 9\n' +
				'---\n' +
				'\n' +
				'## Problem Statement\n' +
				'\n' +
				'The thing is broken.\n' +
				'\n' +
				'## Solution\n' +
				'\n' +
				'Fix it well.\n' +
				'\n' +
				'## User Stories\n' +
				'\n' +
				'1. As a user, I want it fixed.\n',
		);
	});

	it('emits the DEFAULT PRD SCAFFOLD byte-for-byte when no body is drafted', () => {
		const out = renderSpec({
			slug: 'fix-thing-prd',
			title: 'Fix the thing properly',
			body: undefined,
			issueNumber: 9,
			humanOnly: undefined,
			needsAnswers: undefined,
		});
		expect(out).toBe(
			'---\n' +
				'title: Fix the thing properly\n' +
				'slug: fix-thing-prd\n' +
				'issue: 9\n' +
				'---\n' +
				'\n' +
				'## Problem Statement\n' +
				'\n' +
				'Transformed from issue #9: Fix the thing properly\n' +
				'\n' +
				'## Solution\n' +
				'\n' +
				'(to be detailed; this spec needs tasking via `do spec:`).\n' +
				'\n' +
				'## User Stories\n' +
				'\n' +
				'1. As a user, I want issue #9 addressed.\n',
		);
	});

	it('emits the gate axes (humanOnly/needsAnswers) above the fence in the scaffold case', () => {
		const out = renderSpec({
			slug: 'fix-thing-prd',
			title: 'Fix the thing properly',
			body: undefined,
			issueNumber: 9,
			humanOnly: true,
			needsAnswers: true,
		});
		expect(out).toBe(
			'---\n' +
				'title: Fix the thing properly\n' +
				'slug: fix-thing-prd\n' +
				'issue: 9\n' +
				'humanOnly: true\n' +
				'needsAnswers: true\n' +
				'---\n' +
				'\n' +
				'## Problem Statement\n' +
				'\n' +
				'Transformed from issue #9: Fix the thing properly\n' +
				'\n' +
				'## Solution\n' +
				'\n' +
				'(to be detailed; this spec needs tasking via `do spec:`).\n' +
				'\n' +
				'## User Stories\n' +
				'\n' +
				'1. As a user, I want issue #9 addressed.\n',
		);
	});
});

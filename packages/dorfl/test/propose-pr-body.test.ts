import {describe, it, expect} from 'vitest';
import {
	synthesiseProposeTitle,
	composeProposeBody,
	PR_TITLE_MAX,
} from '../src/complete.js';
import {prCreateContentArgs} from '../src/github.js';
import {NoneProvider, manualRequestText} from '../src/integrator.js';

/**
 * Unit tests for the propose-mode PR TITLE + BODY synthesis (task
 * `propose-pr-body`). Half A: a single-line, capped title synthesised runner-side
 * from the task frontmatter (never the multi-line `--fill` run-on). Half B: the
 * body threaded to the provider (`gh pr create --body` when present, else
 * `--fill`), surfaced in the `none` provider's manual instructions.
 */

describe('synthesiseProposeTitle — Half A (runner-synthesised, single line, capped)', () => {
	it('composes `<type>(<slug>): <title>` from the task frontmatter', () => {
		expect(
			synthesiseProposeTitle({
				type: 'feat',
				slug: 'widget',
				title: 'add a widget',
			}),
		).toBe('feat(widget): add a widget');
	});

	it('reuses the --type convention (a non-default type is honoured)', () => {
		expect(
			synthesiseProposeTitle({
				type: 'fix',
				slug: 'bug',
				title: 'stop the crash',
			}),
		).toBe('fix(bug): stop the crash');
	});

	it('flattens a MULTI-LINE source title to a SINGLE line', () => {
		const multiline =
			'do the thing;\n--reset the state;\n--message done;\ndone';
		const title = synthesiseProposeTitle({
			type: 'feat',
			slug: 'slug',
			title: multiline,
		});
		expect(title).not.toContain('\n');
		// Whitespace runs collapse to single spaces (no run-on newlines survive). This
		// composed title is under the cap, so it is flattened but not truncated.
		expect(title).toBe(
			'feat(slug): do the thing; --reset the state; --message done; done',
		);
		expect(title.length).toBeLessThanOrEqual(PR_TITLE_MAX);
	});

	it('CAPS a long source to ≤ PR_TITLE_MAX with a trailing ellipsis', () => {
		const long = 'x'.repeat(200);
		const title = synthesiseProposeTitle({
			type: 'feat',
			slug: 's',
			title: long,
		});
		expect(title.length).toBeLessThanOrEqual(PR_TITLE_MAX);
		expect(title.endsWith('…')).toBe(true);
		expect(title).not.toContain('\n');
	});

	it('a long/multi-line source ALWAYS yields one capped line (the core guarantee)', () => {
		const nasty = 'line one\n'.repeat(50) + 'tail';
		const title = synthesiseProposeTitle({
			type: 'feat',
			slug: 'nasty',
			title: nasty,
		});
		expect(title.split('\n')).toHaveLength(1);
		expect(title.length).toBeLessThanOrEqual(PR_TITLE_MAX);
	});

	it('strips a leading `slug — ` prefix the task title may repeat', () => {
		expect(
			synthesiseProposeTitle({
				type: 'feat',
				slug: 'complete',
				title: 'complete — gate, mark done, integrate',
			}),
		).toBe('feat(complete): gate, mark done, integrate');
	});

	it('falls back to `<type>(<slug>)` when the task title is missing/empty', () => {
		expect(synthesiseProposeTitle({type: 'feat', slug: 'lonely'})).toBe(
			'feat(lonely)',
		);
		expect(
			synthesiseProposeTitle({type: 'feat', slug: 'lonely', title: '   '}),
		).toBe('feat(lonely)');
	});

	it('an empty/whitespace type degrades to the default `feat`', () => {
		expect(synthesiseProposeTitle({type: '  ', slug: 's', title: 't'})).toBe(
			'feat(s): t',
		);
	});
});

describe('composeProposeBody — Half B (agent summary under a runner header)', () => {
	it('wraps the supplied prose under a task-pointer header', () => {
		const body = composeProposeBody({
			slug: 'widget',
			body: 'Built the widget. Decided X over Y.',
		});
		expect(body).toContain('work/tasks/done/widget.md');
		expect(body).toContain('Built the widget. Decided X over Y.');
		// The header precedes the prose.
		expect(body!.indexOf('work/tasks/done/widget.md')).toBeLessThan(
			body!.indexOf('Built the widget'),
		);
	});

	it('returns undefined when no body is supplied (⇒ provider degrades to --fill)', () => {
		expect(composeProposeBody({slug: 'widget'})).toBeUndefined();
		expect(composeProposeBody({slug: 'widget', body: '   '})).toBeUndefined();
	});
});

describe('prCreateContentArgs — gh content args (Half B)', () => {
	it('passes explicit --title/--body when present (and NOT --fill)', () => {
		const args = prCreateContentArgs({
			title: 'feat(s): t',
			body: 'the summary',
		});
		expect(args).toEqual(['--title', 'feat(s): t', '--body', 'the summary']);
		expect(args).not.toContain('--fill');
	});

	it('completes a partial set so --fill is never mixed with an explicit field', () => {
		expect(prCreateContentArgs({title: 'feat(s): t'})).toEqual([
			'--title',
			'feat(s): t',
			'--body',
			'',
		]);
		expect(prCreateContentArgs({body: 'just a body'})).toEqual([
			'--title',
			'',
			'--body',
			'just a body',
		]);
	});

	it('falls back to the lone --fill when BOTH are absent (no regression)', () => {
		expect(prCreateContentArgs({})).toEqual(['--fill']);
	});
});

describe('NoneProvider — surfaces title/body in the manual instructions (Half A + B)', () => {
	it('echoes the suggested title + body the human should use', async () => {
		const result = await new NoneProvider().openRequest({
			cwd: '/tmp',
			branch: 'work/widget',
			arbiter: 'origin',
			title: 'feat(widget): add a widget',
			body: 'Task: `work/tasks/done/widget.md`\n\nThe summary.',
		});
		expect(result.opened).toBe(false);
		expect(result.instruction).toContain('feat(widget): add a widget');
		expect(result.instruction).toContain('The summary.');
	});

	it('without title/body the manual instruction is unchanged (no regression)', async () => {
		const result = await new NoneProvider().openRequest({
			cwd: '/tmp',
			branch: 'work/widget',
			arbiter: 'origin',
		});
		expect(result.instruction).not.toContain('Suggested title');
		expect(result.instruction).not.toContain('Suggested body');
		// `manualRequestText` is empty when neither is present.
		expect(manualRequestText({})).toBe('');
	});
});

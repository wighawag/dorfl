import {describe, it, expect} from 'vitest';
import {withoutEmDashes} from '../src/plain-text.js';
import {appendQuestions, newSidecar} from '../src/sidecar.js';

describe('withoutEmDashes: committed engine text carries no em dash', () => {
	it('turns a spaced em dash into a colon separator', () => {
		expect(
			withoutEmDashes("'task:a' was bounced \u2014 how should we proceed?"),
		).toBe("'task:a' was bounced: how should we proceed?");
		expect(
			withoutEmDashes(
				'acceptance gate failed (exit 1) on the rebased tip \u2014 the failing step was: `x`',
			),
		).toBe(
			'acceptance gate failed (exit 1) on the rebased tip: the failing step was: `x`',
		);
	});

	it('handles unspaced dashes, line starts, and is idempotent', () => {
		expect(withoutEmDashes('a\u2014b')).toBe('a: b');
		expect(withoutEmDashes('\u2014 leading')).toBe('leading');
		expect(withoutEmDashes('trailing \u2014.')).toBe('trailing.');
		const once = withoutEmDashes('x \u2014 y \u2014 z');
		expect(withoutEmDashes(once)).toBe(once);
		expect(once).not.toContain('\u2014');
		expect(withoutEmDashes('no dash here')).toBe('no dash here');
	});

	it('the sidecar appender normalises question, context and default (never the answer)', () => {
		const model = appendQuestions(newSidecar('task:a', []), [
			{
				question: 'Q \u2014 really?',
				context: 'why \u2014 because',
				default: 'd \u2014 e',
			},
		]);
		const [entry] = model.entries;
		expect(entry.question).toBe('Q: really?');
		expect(entry.context).toBe('why: because');
		expect(entry.default).toBe('d: e');
		expect(entry.answer).toBe('');
	});
});

/**
 * Text dorfl COMMITS to a repository (question sidecars, the applied-answers
 * record, surface and bounce commit messages) carries no em dash: some
 * repositories forbid the character, and the engine's own prose used it as a
 * clause separator. Each em dash, with the spaces around it, becomes `': '`,
 * which reads as the same separator ("X was bounced: how should we proceed?").
 *
 * Idempotent, so it is safe to apply at more than one layer (the surface builds
 * an envelope, the sidecar appender normalises again). A human's ANSWER is never
 * passed through it: answers are recorded verbatim.
 */
export function withoutEmDashes(text: string): string {
	if (!text.includes('\u2014')) {
		return text;
	}
	return text
		.replace(/[ \t]*\u2014[ \t]*/g, ': ')
		.replace(/: (?=[.,;:!?)])/g, '')
		.replace(/^: /gm, '');
}

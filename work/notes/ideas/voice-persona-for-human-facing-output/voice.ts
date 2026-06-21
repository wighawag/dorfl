/**
 * SPIKE / EXPLORATORY — optional human-facing PERSONA layer (the golem voice).
 *
 * This is a throwaway spike to SEE and FEEL the voice before it is wired into the
 * CLI. The durable capture is the idea file
 * `work/notes/ideas/voice-persona-for-human-facing-output.md`. Do not treat this
 * as committed design; it exists so the maintainer can run it and judge the tone.
 *
 * Two orthogonal knobs, both resolved upstream like the other config axes
 * (flag > env > per-repo > global > default):
 *
 *   - `voice`       — WHERE the persona reaches: 'plain' (default, none) |
 *                     'cli' (the CLI's own messages only) | 'all' (also work/
 *                     artifacts + the agent prompt). NEVER produced code.
 *   - `voiceCasing` — HOW the persona is cased: 'title' (default, Dorfl's
 *                     Robocop register) | 'caps' (faithful golem-speech) |
 *                     'plain' (golem phrasing, ordinary case).
 *
 * INVARIANTS (prose-only):
 *   - The persona is forced OFF for every machine-read path (pipe / non-TTY /
 *     NO_COLOR / --json / --print-dir). It rides the SAME TTY/NO_COLOR rule as
 *     color, plus an explicit `machineRead` escape.
 *
 * NOTE: this spike INLINES the TTY/NO_COLOR rule (mirroring `output.ts`'s
 * `shouldUseColor`) so the demo is self-contained outside the src tree. When
 * this ripens into `packages/agent-runner/src/voice.ts`, replace the inlined
 * `shouldUseColor` below with an import from `./output.js`.
 *   - It WRAPS messages; the caller always supplies BOTH the plain text and the
 *     persona text, so the facts (slug, branch, reason, exit code) survive at
 *     every level.
 *   - The persona NEVER appears in produced code, at any level.
 */
/** Minimal shape of the stream we inspect (mirrors `output.ts`'s `TtyLike`). */
export interface TtyLike {
	isTTY?: boolean;
}

/**
 * Inlined copy of `output.ts`'s `shouldUseColor`: color/persona ONLY when the
 * stream is an interactive TTY AND `NO_COLOR` is unset. Replace with an import
 * when this moves into the src tree.
 */
function shouldUseColor(
	stream: TtyLike | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.NO_COLOR !== undefined) return false;
	return stream?.isTTY === true;
}

/** WHERE the persona reaches. */
export type Voice = 'plain' | 'cli' | 'all';

/** HOW the persona is cased (only meaningful when `voice` is not 'plain'). */
export type VoiceCasing = 'title' | 'caps' | 'plain';

export interface VoiceContext {
	/** Resolved voice level (default 'plain' ⇒ no persona anywhere). */
	voice: Voice;
	/** Resolved casing register (default 'title'). */
	voiceCasing?: VoiceCasing;
	/** The stream prose is written to (for the TTY decision). */
	stream: TtyLike | undefined;
	/** Override for tests; defaults to process.env. */
	env?: NodeJS.ProcessEnv;
	/** True when this output path is machine-read (--json / --print-dir). */
	machineRead?: boolean;
}

/**
 * Is the persona ALLOWED to speak on this output right now? Only when voice is
 * not 'plain', the path is not machine-read, and the output is interactive prose
 * (same TTY/NO_COLOR rule as color). The 'cli' vs 'all' distinction is about
 * WHERE the persona reaches (CLI vs also work/ artifacts + prompt) and is decided
 * at those call sites, not here — here we only gate the CLI-prose case.
 */
export function voiceActive(ctx: VoiceContext): boolean {
	if (ctx.voice === 'plain') return false;
	if (ctx.machineRead) return false;
	return shouldUseColor(ctx.stream, ctx.env);
}

// --- Casing transforms over a canonical line ------------------------------

/** `The Work Is Mine Now.` — Title Case (Dorfl's Robocop register). */
function toTitle(text: string): string {
	return text.replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** `THE WORK IS MINE NOW.` — faithful golem-speech (full caps). */
function toCaps(text: string): string {
	return text.toUpperCase();
}

/** Apply the chosen casing register to a canonical (sentence-case) line. */
export function applyCasing(text: string, casing: VoiceCasing): string {
	switch (casing) {
		case 'caps':
			return toCaps(text);
		case 'plain':
			return text;
		case 'title':
		default:
			return toTitle(text);
	}
}

/**
 * Pick the persona text (cased) when the voice is active, else the plain text.
 * `personaText` is the CANONICAL line in ordinary sentence case; the casing is
 * applied here. The caller always supplies both, so the facts survive.
 */
export function flavour(
	ctx: VoiceContext,
	plainText: string,
	personaText: string,
): string {
	if (!voiceActive(ctx)) return plainText;
	return applyCasing(personaText, ctx.voiceCasing ?? 'title');
}

// --- The curated lines (authored once, in sentence case) ------------------
//
// A small, hand-written set for the few moments a human actually reads. The
// {slug}/{branch}/{count} placeholders are interpolated by the caller BEFORE
// casing, so the facts ride along in every register.

export const DORFL_LINES = {
	claimWon: 'Claimed. The work is mine now.',
	claimLost: 'Another took it first. I look for other work.',
	gateGreen: 'The gate is green. The work is sound.',
	gateRed:
		'The gate is red. I did not finish. A job done badly is a job done twice.',
	pushedPropose:
		'The work is on the branch. A human must say the word to land it.',
	gcReaped: 'The work is safe on the arbiter. I put away the tools.',
	nothingToDo: 'There is no work I may take. I wait.',
	signature: 'Words in the heart can not be taken.',
} as const;

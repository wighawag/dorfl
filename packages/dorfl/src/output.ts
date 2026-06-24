/**
 * Tiny, dependency-free terminal-output helpers shared by the CLI's
 * human-facing messages. Two concerns live here:
 *
 *   - `shouldUseColor` — the TTY/`NO_COLOR` decision (color ONLY when stdout is
 *     an interactive TTY and `NO_COLOR` is unset), so the same rule is applied
 *     everywhere and is unit-testable without a real terminal.
 *   - `formatProposeNextStep` — the visually-distinct "branch pushed; open the
 *     review" block emitted after a `propose`-mode completion. It is the ONE
 *     thing the human must act on, so it stands out: a blank line before and
 *     after, a heading marker, and (on a TTY) ANSI color. Piped/redirected
 *     output is plain so logs and pipes stay clean.
 *
 * Cosmetic only — none of this changes gate/done-move/commit/integrate behaviour.
 */

/** Minimal shape of the stream we inspect (so tests can pass a fake). */
export interface TtyLike {
	isTTY?: boolean;
}

/**
 * Decide whether to emit ANSI color: true iff `stream` is an interactive TTY
 * AND `NO_COLOR` is not set (https://no-color.org/ — ANY non-empty value
 * disables color). Plain (false) when piped/redirected or non-interactive, so
 * captured logs never carry escape codes.
 */
export function shouldUseColor(
	stream: TtyLike | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	// NO_COLOR: presence (even empty string) disables color, per the convention.
	if (env.NO_COLOR !== undefined) {
		return false;
	}
	return stream?.isTTY === true;
}

// A small, conventional ANSI palette — bold + a bright cyan heading, reset.
const BOLD = '\u001b[1m';
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';

/** Wrap `text` in `codes` + reset when `color`, else return it unchanged. */
function paint(text: string, color: boolean, ...codes: string[]): string {
	return color ? `${codes.join('')}${text}${RESET}` : text;
}

export interface ProposeNextStepInput {
	/** The pushed work branch (e.g. `work/<slug>`). */
	branch: string;
	/** The arbiter remote the branch was pushed to. */
	arbiter: string;
	/** True iff a provider actually opened a review request (vs. push-only). */
	requestOpened: boolean;
	/** Emit ANSI color (TTY) vs. plain text (piped / `NO_COLOR`). */
	color: boolean;
}

/**
 * Build the propose-mode next-step block: the human's single call to action.
 * It is surrounded by blank lines and led by a heading marker so it cannot be
 * lost in surrounding log noise; on a TTY the heading is bold-cyan, the branch
 * ref is bold, and the next command(s) stand out. The content is accurate to
 * the actual push: the branch/ref that was pushed and the exact next command.
 *
 * Returns the multi-line string (leading + trailing blank line included) so the
 * caller can print it as one unit.
 */
export function formatProposeNextStep(input: ProposeNextStepInput): string {
	const {branch, arbiter, requestOpened, color} = input;
	const ref = `${arbiter}/${branch}`;

	const heading = paint('▶ Next step — review required', color, BOLD, CYAN);
	const branchLine = requestOpened
		? `Pushed ${paint(branch, color, BOLD)} to ${ref} and opened a review.`
		: `Pushed ${paint(branch, color, BOLD)} to ${ref}.`;

	const lines: string[] = ['', heading, branchLine];
	if (requestOpened) {
		lines.push('Open the review request to land it on main.');
	} else {
		// No provider review created — give the exact command to open one.
		lines.push('Open a PR/MR to land it on main, e.g.:');
		lines.push(`  ${paint(`gh pr create --head ${branch}`, color, BOLD)}`);
	}
	lines.push('');
	return lines.join('\n');
}

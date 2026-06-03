/**
 * Builds the prompt the runner hands to `agentCmd`: a small CONSTANT wrapper
 * (only the `<slug>` varies) around the claimed slice's own `## Prompt` section.
 *
 * The wrapper draws the git boundary IN-BAND — the spawned agent does NO git ops
 * on the repo (no commit/push, no moving `work/` files); the RUNNER owns every
 * git-state transition (claim, done-move, work commit, integration). We state
 * this in the prompt rather than relying on the host's global agent config (an
 * `AGENTS.md`), because the runner is portable and cannot assume any host rule
 * exists. See CLAIM-PROTOCOL.md → "The prompt handed to the work agent".
 */

/**
 * Extract the body of the `## Prompt` section from a slice's markdown. Returns
 * the section text with the heading removed, leading `>` blockquote markers
 * stripped, trimmed; or `undefined` when the slice has no `## Prompt` heading.
 */
export function extractPromptSection(content: string): string | undefined {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	let start = -1;
	let headingLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
		if (match && match[2].trim().toLowerCase() === 'prompt') {
			start = i + 1;
			headingLevel = match[1].length;
			break;
		}
	}
	if (start === -1) {
		return undefined;
	}

	// Collect until the next heading of the same or higher level (fewer/equal #).
	const body: string[] = [];
	for (let i = start; i < lines.length; i++) {
		const heading = /^(#{1,6})\s+/.exec(lines[i]);
		if (heading && heading[1].length <= headingLevel) {
			break;
		}
		body.push(lines[i]);
	}

	// Strip a single leading blockquote marker (`> ` or `>`) from each line.
	const unquoted = body.map((line) => line.replace(/^>\s?/, ''));

	const text = unquoted.join('\n').trim();
	return text === '' ? undefined : text;
}

/**
 * The constant wrapper, parameterised only by the slice slug. Points the agent
 * at its brief, restates the implement-to-acceptance-criteria task, draws the
 * git boundary in-band, and tells it to stop + report when build/test/format
 * are green.
 */
function wrapper(slug: string): string {
	return [
		`You are completing one work slice in this repository.`,
		`Your complete brief is the file work/in-progress/${slug}.md — read it`,
		`fully (What to build, Acceptance criteria, and the Prompt below).`,
		`Implement to satisfy every Acceptance criterion in that slice.`,
		``,
		`Git boundary (important): you do NO git operations on this repository.`,
		`Do not commit, do not stage, do not push, and do NOT move any files between work/`,
		`folders (e.g. work/in-progress/ -> work/done/). The runner — not you —`,
		`owns every git-state transition (the claim, the done-move, the completion`,
		`commit, and integration). Just edit code and get the acceptance tests`,
		`green. (Your OWN tests MAY create and operate on their own throwaway git`,
		`repositories — that is expected; the boundary is only about THIS repo.)`,
		``,
		`When the project's build, tests, and format checks are all green, STOP`,
		`and report what you did. Do not attempt to integrate or merge anything.`,
		``,
		`--- Slice prompt (work/in-progress/${slug}.md → ## Prompt) ---`,
	].join('\n');
}

/**
 * Build the full prompt: the constant wrapper for `slug` followed by the slice's
 * own `## Prompt` body (appended verbatim).
 */
export function buildAgentPrompt(slug: string, slicePrompt: string): string {
	return `${wrapper(slug)}\n\n${slicePrompt}\n`;
}

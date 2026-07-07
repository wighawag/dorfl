/**
 * The SINGLE owner of the buildable-task (and PRD-body) markdown SECTION SCHEMA
 * (prd `centralize-buildable-task-renderer-shared-by-intake-and-promotion`, US
 * #1/#4/#7). dorfl has TWO independent producers of a buildable task/PRD body —
 * `intake.ts` (`renderBacklogTask`/`renderPrd`, a wrapper+fallback) and
 * `triage-persist.ts` (`buildPromotedBody`, a structured renderer) — and until
 * this module they each HAND-ROLLED the `## What to build` / `## Acceptance
 * criteria` / `## Open questions` / `## Prompt` skeleton, so the schema could (and
 * did) DRIFT apart silently (the promptless-promotion stuck-lock bug, see the
 * origin observation
 * `advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25`).
 *
 * This module renders only the BODY (the markdown AFTER the frontmatter fence) —
 * the part both producers actually share. Each producer keeps its OWN frontmatter
 * writer (intake stamps `issue:`/`originTrust:`; promotion stamps `needsAnswers:`/
 * `blockedBy:`) and its OWN writer/integration mode (intake's branch+PR front
 * door; promotion's triage-local CAS create) — only the section skeleton is
 * centralized here.
 *
 * The two producers are ASYMMETRIC, and that asymmetry is expressed by the
 * renderer's inputs rather than by two divergent bodies:
 *
 *   - intake's DEFAULT-SCAFFOLD skeleton (used ONLY when the intake agent drafted
 *     no body) is `## What to build` + `## Acceptance criteria` + a thin default
 *     `## Prompt`. Reproduced by passing all three.
 *   - promotion's structured body is `## What to build` (the mechanism prose) +
 *     optional `## Open questions` + a `## Prompt` seeded (blockquoted) from the
 *     mechanism prose, and NO `## Acceptance criteria`. Reproduced by omitting
 *     `acceptanceCriteria` and passing the open-questions block + the seed prose.
 *
 * Symmetrically, {@link renderPrdBody} owns the FULL PRD section schema both PRD
 * producers need: intake's default PRD scaffold is `## Problem Statement` +
 * `## Solution` + `## User Stories` (reproduced by passing all three), while
 * promotion's structured PRD body is `## Problem Statement` + optional
 * `## Open questions` (reproduced by omitting `solution`/`userStories`). Each
 * optional section is emitted only when its input is non-empty.
 *
 * `## Prompt` is TASK-ONLY: a PRD is not dispatched by `do`/`run`, so a PRD body
 * carries none (the symmetric reason the task body MUST carry one — the consumer
 * `extractPromptSection`/`resolveTask` in `prompt.ts` throws "has no '## Prompt'
 * section" at dispatch time without it). {@link renderTaskBody} always emits a
 * `## Prompt`; {@link renderPrdBody} never does.
 *
 * NOTE (extract-only): this module is a PURE ADDITION. Neither producer is rewired
 * here — that is the two follow-on tasks (kept file-orthogonal so each proves its
 * own output is byte-for-byte preserved). This task lands the renderer + its
 * golden-shape test ONLY.
 */

/** Blockquote a prompt SEED: each line gets a `> ` prefix (blank lines → `>`). */
function blockquote(seed: string): string {
	return seed
		.split('\n')
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n');
}

export interface RenderTaskBodyInput {
	/**
	 * The `## What to build` prose. For intake's default scaffold this is the task
	 * title; for promotion it is the observation's mechanism/fix prose. When empty,
	 * a placeholder keeps the section non-empty.
	 */
	whatToBuild: string;
	/**
	 * The `## Acceptance criteria` block (markdown, e.g. a `- [ ]` checklist).
	 * OMIT it (or pass empty) to drop the section entirely — promotion's structured
	 * body carries no acceptance section, intake's default scaffold does.
	 */
	acceptanceCriteria?: string;
	/**
	 * The `## Open questions` block (markdown). OMIT it (or pass empty) to drop the
	 * section — intake's default scaffold has none, a promoted observation carries
	 * its transcribed open questions here.
	 */
	openQuestions?: string;
	/**
	 * The `## Prompt` body, supplied UNQUOTED — the renderer blockquotes it (the
	 * `> `-prefixed shape `extractPromptSection` strips back off). This is the
	 * task-only dispatchability section; it is ALWAYS emitted (a placeholder seeds
	 * it when empty) so a rendered task never fails the missing-`## Prompt` guard.
	 */
	prompt: string;
}

/**
 * Render a buildable TASK body (the markdown AFTER the frontmatter fence). Emits,
 * in order: `## What to build`, `## Acceptance criteria` (only when given),
 * `## Open questions` (only when given), and ALWAYS `## Prompt` (blockquoted).
 *
 * The output passes `extractPromptSection`/`resolveTask` without the
 * "has no '## Prompt' section" throw, because `## Prompt` is unconditional and
 * never empty. The caller wraps this body with its own frontmatter.
 *
 * FENCE↔HEADING BOUNDARY: this renderer starts at its first heading with NO
 * leading blank line — the caller's frontmatter serializer owns the single blank
 * line between the closing `---` fence and this first heading (ratified in
 * `docs/adr/frontmatter-owns-fence-to-heading-blank-line.md`). Do NOT add a
 * leading blank here; that would reintroduce the fence-spacing drift class.
 */
export function renderTaskBody(input: RenderTaskBodyInput): string {
	const lines: string[] = [
		'## What to build',
		'',
		input.whatToBuild.trim() === ''
			? '(no `## What to build` prose was supplied.)'
			: input.whatToBuild.trim(),
		'',
	];

	const acceptance = (input.acceptanceCriteria ?? '').trim();
	if (acceptance !== '') {
		lines.push('## Acceptance criteria', '', acceptance, '');
	}

	const openQuestions = (input.openQuestions ?? '').trim();
	if (openQuestions !== '') {
		lines.push('## Open questions', '', openQuestions, '');
	}

	const seed =
		input.prompt.trim() === ''
			? 'Build the task described above.'
			: input.prompt.trim();
	lines.push('## Prompt', '', blockquote(seed), '');

	return lines.join('\n');
}

export interface RenderPrdBodyInput {
	/**
	 * The `## Problem Statement` prose. For intake's default scaffold this is the
	 * issue-transform line; for promotion it is the observation's mechanism prose.
	 * When empty, a placeholder keeps the section non-empty.
	 */
	problemStatement: string;
	/**
	 * The `## Solution` prose (markdown). OMIT it (or pass empty) to drop the
	 * section — promotion's structured PRD body carries no Solution section, intake's
	 * default PRD scaffold does.
	 */
	solution?: string;
	/**
	 * The `## User Stories` block (markdown, e.g. a numbered list). OMIT it (or pass
	 * empty) to drop the section — promotion's structured PRD body carries no User
	 * Stories section, intake's default PRD scaffold does.
	 */
	userStories?: string;
	/**
	 * The `## Open questions` block (markdown). OMIT it (or pass empty) to drop the
	 * section. A PRD carries NO `## Prompt` (it is not dispatched).
	 */
	openQuestions?: string;
}

/**
 * Render a PRD body (the markdown AFTER the frontmatter fence). Emits, in the
 * canonical order, `## Problem Statement`, then `## Solution`, `## User Stories`,
 * and `## Open questions` (each only when its input is given), and NEVER a
 * `## Prompt` — a PRD is a spec, not a dispatchable task. The symmetric twin of
 * {@link renderTaskBody}, owning the FULL PRD section schema both producers need
 * (intake's default scaffold supplies Problem Statement + Solution + User Stories;
 * promotion's structured body supplies Problem Statement + optional Open
 * questions) so the two artifact shapes cannot drift apart.
 *
 * FENCE↔HEADING BOUNDARY: same convention as {@link renderTaskBody} — no leading
 * blank; the frontmatter serializer owns the `\n\n` after the closing `---` fence
 * (see `docs/adr/frontmatter-owns-fence-to-heading-blank-line.md`).
 */
export function renderPrdBody(input: RenderPrdBodyInput): string {
	const lines: string[] = [
		'## Problem Statement',
		'',
		input.problemStatement.trim() === ''
			? '(no `## Problem Statement` prose was supplied.)'
			: input.problemStatement.trim(),
		'',
	];

	const solution = (input.solution ?? '').trim();
	if (solution !== '') {
		lines.push('## Solution', '', solution, '');
	}

	const userStories = (input.userStories ?? '').trim();
	if (userStories !== '') {
		lines.push('## User Stories', '', userStories, '');
	}

	const openQuestions = (input.openQuestions ?? '').trim();
	if (openQuestions !== '') {
		lines.push('## Open questions', '', openQuestions, '');
	}

	return lines.join('\n');
}

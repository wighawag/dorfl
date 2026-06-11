/**
 * Builds the prompt the runner hands to `agentCmd`: a small CONSTANT wrapper
 * (only the `<slug>` / source-PRD path vary) around the claimed slice's own
 * `## Prompt` section. This is dual-use — the SAME assembly the autonomous
 * runner feeds `agentCmd` and the human `agent-runner prompt [<slug>]` command.
 *
 * The wrapper is NOT hardcoded here: it is read VERBATIM from the work-contract
 * (`skills/to-slices/CLAIM-PROTOCOL.md` → "The prompt handed to the work agent"),
 * so the emitted text can never silently diverge from the canonical contract.
 * We only substitute the per-slice placeholders (`<slug>`, `<prd>`).
 *
 * The wrapper draws the git boundary IN-BAND — the spawned agent does NO git ops
 * on the repo (no commit/push, no moving `work/` files); the RUNNER owns every
 * git-state transition (claim, done-move, work commit, integration). We state
 * this in the prompt rather than relying on the host's global agent config (an
 * `AGENTS.md`), because the runner is portable and cannot assume any host rule
 * exists. See CLAIM-PROTOCOL.md → "The prompt handed to the work agent".
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseFrontmatter} from './frontmatter.js';
import {run, type RunResult} from './git.js';
import {branchAheadOf} from './continue-branch.js';
import {extractReason} from './needs-attention.js';

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
 * Locate the canonical work-contract document (`CLAIM-PROTOCOL.md`). The
 * contract is the `to-slices` skill bundled at the monorepo root
 * (`skills/to-slices/`), reached relatively from this module so the lookup works
 * both from `src/` (tsx) and `dist/` (built). An explicit override is honoured
 * for tests / unusual layouts.
 */
export function resolveClaimProtocolPath(override?: string): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	// here = .../packages/agent-runner/{src,dist}; the protocol docs are OWNED by the
	// `setup` skill (`skills/setup/protocol/`) at the monorepo root — see
	// `docs/adr/methodology-and-skills.md` §5 and the `work/protocol/` propagation.
	// (They moved here from `skills/to-slices/`; the old paths are kept as a fallback
	// for any not-yet-migrated layout.)
	const candidates = [
		resolve(
			here,
			'..',
			'..',
			'..',
			'skills',
			'setup',
			'protocol',
			'CLAIM-PROTOCOL.md',
		),
		resolve(
			here,
			'..',
			'..',
			'..',
			'..',
			'skills',
			'setup',
			'protocol',
			'CLAIM-PROTOCOL.md',
		),
		// legacy location (pre-move) — fallback only
		resolve(here, '..', '..', '..', 'skills', 'to-slices', 'CLAIM-PROTOCOL.md'),
		resolve(
			here,
			'..',
			'..',
			'..',
			'..',
			'skills',
			'to-slices',
			'CLAIM-PROTOCOL.md',
		),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return candidates[0];
}

/**
 * Pull the canonical wrapper TEMPLATE out of CLAIM-PROTOCOL.md: the first fenced
 * code block following the "The prompt handed to the work agent" heading. The
 * returned text still contains the `<slug>` / `<prd>` placeholders verbatim — it
 * is the single source of truth for the wrapper.
 */
export function extractCanonicalWrapperTemplate(protocol: string): string {
	const normalized = protocol.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	// Find the "prompt handed to the work agent" heading (any level).
	let headingIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		const match = /^#{1,6}\s+(.*)$/.exec(lines[i]);
		if (match && /prompt handed to the work agent/i.test(match[1])) {
			headingIndex = i;
			break;
		}
	}
	if (headingIndex === -1) {
		throw new Error(
			'CLAIM-PROTOCOL.md: could not find the "prompt handed to the work agent" section',
		);
	}

	// Find the opening fence of the first code block after the heading.
	let open = -1;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (/^```/.test(lines[i])) {
			open = i;
			break;
		}
		// A new heading before any fence means the wrapper block is missing.
		if (/^#{1,6}\s+/.test(lines[i])) {
			break;
		}
	}
	if (open === -1) {
		throw new Error(
			'CLAIM-PROTOCOL.md: no fenced wrapper block under the work-agent-prompt section',
		);
	}

	let close = -1;
	for (let i = open + 1; i < lines.length; i++) {
		if (/^```/.test(lines[i])) {
			close = i;
			break;
		}
	}
	if (close === -1) {
		throw new Error('CLAIM-PROTOCOL.md: unterminated wrapper code block');
	}

	return lines
		.slice(open + 1, close)
		.join('\n')
		.trim();
}

/**
 * The constant wrapper, parameterised only by the slice slug and its source PRD
 * slug. Read verbatim from the work-contract and substituted — never a divergent
 * hardcoded copy. `prd` may be `undefined` when the slice has no `prd:` field.
 */
export function wrapper(
	slug: string,
	prd: string | undefined,
	options: {protocolPath?: string} = {},
): string {
	const protocolPath = resolveClaimProtocolPath(options.protocolPath);
	const protocol = readFileSync(protocolPath, 'utf8');
	const template = extractCanonicalWrapperTemplate(protocol);
	return template.replace(/<slug>/g, slug).replace(/<prd>/g, prd ?? '<prd>');
}

/**
 * The CONTINUE context that turns the fresh-start assembly into a continue-mode
 * one (the `agent-prompt-continue-context` slice). It is OPT-IN state inherited
 * from a PRIOR attempt: present iff the arbiter holds a `work/<slug>` branch
 * AHEAD of main (the `requeue` default kept it) — the SAME condition the
 * `requeue-continue-and-reset` onboarding paths detect via {@link branchAheadOf}.
 * When absent, the assembly stays byte-identical to the fresh-start wrapper.
 */
export interface ContinueContext {
	/**
	 * The arbiter remote name the prior `work/<type>-<slug>` lives on (e.g.
	 * `origin` / `arbiter`). Used only to point the agent at the right diff base
	 * (`<arbiter>/main`) — the block is prose, not a git op.
	 */
	arbiter: string;
	/**
	 * The NAMESPACED work branch the prior attempt's work lives on
	 * (`work/<type>-<slug>`), derived from the resolved `branchRef`. The block
	 * prose names it VERBATIM (the agent's `git diff` pointer must hit the real
	 * branch, not a bare `work/<slug>`).
	 */
	branch: string;
	/**
	 * The needs-attention reason (runner-written: WHY the prior attempt stalled),
	 * read from the item BODY. Empty string when none was recorded.
	 */
	reason: string;
	/**
	 * The requeue handoff note(s) (human-written via `requeue -m`: what to do
	 * about it), read from the item BODY — the accumulated `## Requeue YYYY-MM-DD`
	 * sections, newest last. Empty array when none were threaded.
	 */
	requeueNotes: string[];
}

/** The heading prefix the requeue handoff notes are appended under. */
const REQUEUE_HEADING_PREFIX = '## Requeue';

/**
 * Extract the accumulated requeue handoff notes from an item's BODY: the prose
 * under each `## Requeue YYYY-MM-DD` heading (append-only; written by
 * `requeue -m "<note>"` in `needs-attention.ts`). Returns one trimmed string per
 * section in file order (oldest first, newest last); `[]` when none are present.
 */
export function extractRequeueNotes(content: string): string[] {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const notes: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith(REQUEUE_HEADING_PREFIX)) {
			continue;
		}
		// Collect the prose under this heading until the next `## ` heading or EOF.
		const collected: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			if (/^##\s/.test(lines[j])) {
				break;
			}
			collected.push(lines[j]);
		}
		const note = collected.join('\n').trim();
		if (note !== '') {
			notes.push(note);
		}
	}
	return notes;
}

/**
 * Resolve the CONTINUE context for `slug`, runner-side, REUSING the SAME
 * continue-detection the `requeue-continue-and-reset` claim/start path uses
 * ({@link branchAheadOf}) — never a parallel re-derivation. Returns a
 * {@link ContinueContext} iff the arbiter holds a `work/<slug>` ref AHEAD of
 * main (the prior attempt's kept work); otherwise `undefined` (fresh-start: the
 * common case, a first attempt or a `requeue --reset` that deleted the branch).
 *
 * The reason + handoff note(s) are read from the item BODY (the ledger file the
 * caller already resolved), so they survive the requeue → backlog → claim gap
 * and cross machines. The ref names match the two onboarding paths:
 *   - in-place clone:  branchRef=`<arbiter>/work/<slug>`, mainRef=`<arbiter>/main`
 *   - bare hub mirror: branchRef=`work/<slug>`,           mainRef=`main`
 */
export function resolveContinueContext(options: {
	/** The repo/worktree/mirror the branch refs live in. */
	cwd: string;
	/** The slug being onboarded. */
	slug: string;
	/** The arbiter remote name (for the diff-base pointer in the block). */
	arbiter: string;
	/** The `work/<slug>` ref to test (in-place: `<arbiter>/work/<slug>`). */
	branchRef: string;
	/** The main ref to compare against (in-place: `<arbiter>/main`). */
	mainRef: string;
	/** The resolved slice file content (the item body the notes live in). */
	content: string;
	/** Environment for the read-only git child. */
	env?: NodeJS.ProcessEnv;
}): ContinueContext | undefined {
	if (
		!branchAheadOf(options.cwd, options.branchRef, options.mainRef, options.env)
	) {
		return undefined;
	}
	return {
		arbiter: options.arbiter,
		// Strip any `<arbiter>/` remote prefix off the ref to recover the bare
		// `work/<type>-<slug>` branch name the prose points at.
		branch: stripRemotePrefix(options.branchRef, options.arbiter),
		reason: extractReason(options.content),
		requeueNotes: extractRequeueNotes(options.content),
	};
}

/**
 * Recover the bare `work/<type>-<slug>` branch from a resolved ref: drop a
 * leading `<arbiter>/` (the in-place remote-tracking form `<arbiter>/work/...`);
 * the bare hub-mirror form (`work/...`) is returned as-is.
 */
function stripRemotePrefix(branchRef: string, arbiter: string): string {
	const prefix = `${arbiter}/`;
	return branchRef.startsWith(prefix)
		? branchRef.slice(prefix.length)
		: branchRef;
}

/**
 * Build the CONTINUE block injected ahead of the slice prompt in continue-mode.
 * Pure text: a "you are continuing" framing + a pointer to review the prior diff
 * vs `<arbiter>/main` + the needs-attention reason + the requeue handoff note(s)
 * (read from the item body). Never emitted in fresh-start mode.
 */
export function buildContinueBlock(slug: string, ctx: ContinueContext): string {
	const lines: string[] = [];
	lines.push('## You are CONTINUING prior work on this slice');
	lines.push('');
	lines.push(
		`This is NOT a fresh start. A prior attempt at '${slug}' was requeued, and ` +
			`you have landed on its \`${ctx.branch}\` branch — it ALREADY carries that ` +
			'work. Before you implement anything, REVIEW what the prior attempt did ' +
			`(\`git diff ${ctx.arbiter}/main...${ctx.branch}\`) and BUILD ON what is ` +
			'good — do NOT blindly restart or undo it.',
	);
	if (ctx.reason.trim() !== '') {
		lines.push('');
		lines.push('### Why the prior attempt stalled (needs-attention reason)');
		lines.push('');
		lines.push(ctx.reason.trim());
	}
	if (ctx.requeueNotes.length > 0) {
		lines.push('');
		lines.push('### Handoff note(s) from the requeue');
		lines.push('');
		for (const note of ctx.requeueNotes) {
			lines.push(note.trim());
			lines.push('');
		}
	}
	return lines.join('\n').trim();
}

/**
 * Build the full prompt: the canonical wrapper for `slug` (with its source PRD
 * substituted) followed by the slice's own `## Prompt` body, appended verbatim.
 *
 * In CONTINUE-mode (a {@link ContinueContext} is supplied), a CONTINUE block is
 * injected between the wrapper and the slice prompt — telling the agent it is
 * continuing, where to find the prior diff, why it stalled, and the human's
 * handoff note(s). In FRESH-START mode (no context, the common case) the output
 * is BYTE-IDENTICAL to the canonical wrapper + slice prompt — no CONTINUE block.
 */
export function buildAgentPrompt(
	slug: string,
	prd: string | undefined,
	slicePrompt: string,
	options: {protocolPath?: string; continueContext?: ContinueContext} = {},
): string {
	const head = wrapper(slug, prd, options);
	if (options.continueContext) {
		const block = buildContinueBlock(slug, options.continueContext);
		return `${head}\n\n${block}\n\n${slicePrompt}\n`;
	}
	return `${head}\n\n${slicePrompt}\n`;
}

/** Which work/ folder a slice file was resolved from. */
export type SliceFolder = 'in-progress' | 'backlog';

export interface ResolvedSlice {
	/** The slug of the resolved slice. */
	slug: string;
	/** Absolute path to the slice file that was read. */
	path: string;
	/** The folder the slice was resolved from (in-progress wins over backlog). */
	folder: SliceFolder;
	/** The slice's source PRD slug (frontmatter `prd:`), if any. */
	prd: string | undefined;
	/** The extracted `## Prompt` body. */
	slicePrompt: string;
}

export interface PromptOptions {
	/** Slug to render. If omitted, inferred from a `work/<slug>` branch. */
	slug?: string;
	/** The repo root (defaults to cwd). */
	cwd: string;
	/** Override the path to CLAIM-PROTOCOL.md (tests / unusual layouts). */
	protocolPath?: string;
	/** Environment for the branch-inference git child. */
	env?: NodeJS.ProcessEnv;
}

/** Raised for usage/environment problems (no slug, no slice file, no prompt). */
export class PromptError extends Error {}

/**
 * Resolve a slice's file: prefer `work/in-progress/<slug>.md`, fall back to
 * `work/backlog/<slug>.md`. Returns the parsed PRD + extracted `## Prompt` body.
 * Throws {@link PromptError} when neither file exists or it has no prompt body.
 */
export function resolveSlice(cwd: string, slug: string): ResolvedSlice {
	const order: SliceFolder[] = ['in-progress', 'backlog'];
	for (const folder of order) {
		const path = join(cwd, 'work', folder, `${slug}.md`);
		if (!existsSync(path)) {
			continue;
		}
		const content = readFileSync(path, 'utf8');
		const slicePrompt = extractPromptSection(content);
		if (slicePrompt === undefined) {
			throw new PromptError(
				`slice '${slug}' (work/${folder}/${slug}.md) has no '## Prompt' section`,
			);
		}
		const fm = parseFrontmatter(content);
		return {slug, path, folder, prd: fm.prd, slicePrompt};
	}
	throw new PromptError(
		`no slice '${slug}' found in work/in-progress/ or work/backlog/`,
	);
}

/** If HEAD is a `work/<slug>` branch, return `<slug>`; else `''`. */
export function inferSlugFromBranch(
	cwd: string,
	env?: NodeJS.ProcessEnv,
): string {
	const sym: RunResult = run(
		'git',
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		{env},
	);
	if (sym.status !== 0) {
		return '';
	}
	const match = /^work\/(.+)$/.exec(sym.stdout.trim());
	return match ? match[1] : '';
}

/**
 * The full `agent-runner prompt [<slug>]` rendering: resolve the slug (explicit,
 * else inferred from a `work/<slug>` branch), resolve its slice file
 * (in-progress over backlog), and assemble the canonical wrapper + the slice's
 * `## Prompt`. Pure with respect to the repo (read-only) — the caller writes the
 * result to stdout.
 */
export function renderPrompt(options: PromptOptions): string {
	const slug = options.slug || inferSlugFromBranch(options.cwd, options.env);
	if (!slug) {
		throw new PromptError(
			'missing <slug> and the current branch is not a work/<slug> branch. ' +
				'usage: agent-runner prompt [<slug>]',
		);
	}
	const slice = resolveSlice(options.cwd, slug);
	return buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt, {
		protocolPath: options.protocolPath,
	});
}

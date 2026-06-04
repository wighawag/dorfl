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
	// here = .../packages/agent-runner/{src,dist}; the skill is at the repo root.
	const candidates = [
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
 * Build the full prompt: the canonical wrapper for `slug` (with its source PRD
 * substituted) followed by the slice's own `## Prompt` body, appended verbatim.
 */
export function buildAgentPrompt(
	slug: string,
	prd: string | undefined,
	slicePrompt: string,
	options: {protocolPath?: string} = {},
): string {
	return `${wrapper(slug, prd, options)}\n\n${slicePrompt}\n`;
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

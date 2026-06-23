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
import {parseFrontmatter, type Frontmatter} from './frontmatter.js';
import type {PromptGuidance} from './config.js';
import {
	WORK_ROOT,
	workFolderName,
	workItemPath,
	workFolderRel,
	type TaskResolutionFolder,
} from './work-layout.js';
import {run, type RunResult} from './git.js';
import {branchAheadOf} from './continue-branch.js';
import {isAncestor} from './gc.js';
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
 * Locate one of the runtime-read protocol docs (`CLAIM-PROTOCOL.md`,
 * `REVIEW-PROTOCOL.md`, …) the runner reads at RUNTIME. Resolution order,
 * highest authority first:
 *
 *   1. `override` — explicit, for tests / unusual layouts (short-circuits).
 *   2. `<cwd>/work/protocol/<name>` — the TARGET repo's adopted copy. `setup`
 *      copies the protocol docs verbatim into every repo's `work/protocol/`
 *      (ADR `methodology-and-skills.md` §5, the `work/protocol/` propagation),
 *      so a set-up repo carries the protocol VERSION it adopted; that copy
 *      wins.
 *   3. `dist/protocol/<name>` — a copy VENDORED inside this package (by the
 *      `vendor-protocol` build step). The published-CLI fallback: an installed
 *      CLI has no sibling `skills/` tree, and the target repo may not be set
 *      up yet (no `work/protocol/`), so the package ships its own copy of the
 *      SET of runtime-read protocol docs.
 *   4. the legacy monorepo-relative `skills/setup/protocol/<name>` walk —
 *      DEV-only, kept LAST (it only resolves inside this dev monorepo; an
 *      installed CLI's walks escape into the consumer's filesystem → ENOENT,
 *      which is why it cannot be the primary source).
 *
 * `cwd` is the target repo root (threaded from `renderPrompt`/`do`/`run`/the
 * `render-prompt` CLI). When omitted, the target-repo step is simply skipped.
 * `name` is the doc's BASENAME (e.g. `'CLAIM-PROTOCOL.md'`).
 */
export function resolveProtocolDoc(
	name: string,
	cwd?: string,
	override?: string,
): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	// here = .../packages/agent-runner/{src,dist}.
	const candidates: string[] = [];
	// 2. The target repo's adopted copy (authoritative when present).
	if (cwd) {
		candidates.push(resolve(cwd, WORK_ROOT, workFolderName('protocol'), name));
	}
	// 3. The copy vendored inside this package (published-CLI fallback). From
	//    `src/` (tsx) `dist/` is a sibling; from `dist/` it is the dir itself.
	candidates.push(
		resolve(here, '..', 'dist', 'protocol', name),
		resolve(here, 'protocol', name),
	);
	// 4. The legacy monorepo-relative `skills/setup/protocol/` walks — DEV-only,
	//    LAST. The docs are OWNED by the `setup` skill (`skills/setup/protocol/`).
	candidates.push(
		resolve(here, '..', '..', '..', 'skills', 'setup', 'protocol', name),
		resolve(here, '..', '..', '..', '..', 'skills', 'setup', 'protocol', name),
	);
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
 * The single-pass extractor-post-step for the `promptGuidance` NUDGE namespace.
 * Resolves every `<!-- if promptGuidance.<member> --> … <!-- else --> … <!-- /if -->`
 * conditional fragment in the canonical wrapper template ("Option A" — single
 * wrapper, conditional fragments — see the ADR + this slice's recorded decision):
 * when the named nudge member resolves TRUE the IF-branch text is kept and the
 * markers + ELSE-branch are stripped; when FALSE the ELSE-branch text is kept
 * and the markers + IF-branch are stripped. The markers' own lines (and the
 * newlines that terminate them) are consumed too, so the OFF-path output is
 * BYTE-IDENTICAL to the pre-marker template — the guard the prompt-assembly
 * byte-identity test pins.
 *
 * Pure string transform; runs AFTER `extractCanonicalWrapperTemplate` (a pure
 * verbatim extractor stays a pure verbatim extractor) and BEFORE the
 * `<slug>`/`<prd>` substitution.
 */
export function applyPromptGuidance(
	template: string,
	nudges: {testFirst?: boolean} = {},
): string {
	const values: Record<string, boolean> = {
		testFirst: nudges.testFirst === true,
	};
	return template.replace(
		/<!-- if promptGuidance\.(\w+) -->\n([\s\S]*?)\n<!-- else -->\n([\s\S]*?)\n<!-- \/if -->/g,
		(_match, member: string, ifBranch: string, elseBranch: string) => {
			const on = values[member] === true;
			return on ? ifBranch : elseBranch;
		},
	);
}

/**
 * The constant wrapper, parameterised only by the slice slug, its source PRD
 * slug, and (optionally) the resolved {@link PromptGuidance} nudges. Read
 * verbatim from the work-contract and substituted — never a divergent hardcoded
 * copy. `prd` may be `undefined` when the slice has no `prd:` field. When
 * `promptGuidance` is omitted (or every member resolves false) the output is
 * BYTE-IDENTICAL to today's wrapper (the ELSE-branch of every conditional is
 * the historic text).
 */
export function wrapper(
	slug: string,
	brief: string | undefined,
	options: {
		protocolPath?: string;
		cwd?: string;
		promptGuidance?: {testFirst?: boolean};
	} = {},
): string {
	const protocolPath = resolveProtocolDoc(
		'CLAIM-PROTOCOL.md',
		options.cwd,
		options.protocolPath,
	);
	const protocol = readFileSync(protocolPath, 'utf8');
	const template = extractCanonicalWrapperTemplate(protocol);
	const resolved = applyPromptGuidance(template, options.promptGuidance);
	return resolved
		.replace(/<slug>/g, slug)
		.replace(/<brief>/g, brief ?? '<brief>');
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
	brief: string | undefined,
	taskPrompt: string,
	options: {
		protocolPath?: string;
		cwd?: string;
		continueContext?: ContinueContext;
		promptGuidance?: {testFirst?: boolean};
	} = {},
): string {
	const head = wrapper(slug, brief, options);
	if (options.continueContext) {
		const block = buildContinueBlock(slug, options.continueContext);
		return `${head}\n\n${block}\n\n${taskPrompt}\n`;
	}
	return `${head}\n\n${taskPrompt}\n`;
}

/**
 * Which work/ folder a slice file was resolved from. `done` is reachable ONLY on
 * a CONTINUE and ONLY when the work-branch tip is STRANDED (committed-but-not-on
 * the arbiter) — never on a fresh claim, never for a genuinely-COMPLETE slice
 * (see {@link resolveTask} + {@link ContinueResolutionGate}).
 */
export type TaskFolder = TaskResolutionFolder;

export interface ResolvedTask {
	/** The slug of the resolved slice. */
	slug: string;
	/** Absolute path to the slice file that was read. */
	path: string;
	/** The folder the slice was resolved from (in-progress wins over tasks-todo). */
	folder: TaskFolder;
	/** The slice's source brief slug (frontmatter `brief:`), if any. */
	brief: string | undefined;
	/** The extracted `## Prompt` body. */
	taskPrompt: string;
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
	/**
	 * Resolved {@link PromptGuidance} nudges (the prompt-text knobs the
	 * `promptGuidance` namespace carries; e.g. `testFirst`). Omitted (the
	 * common case) ⇒ every member false ⇒ wrapper byte-identical to today.
	 * The CLI's `prompt` action resolves this from the per-repo config; the
	 * autonomous `do`/`run` paths thread it through `buildAgentPrompt`.
	 */
	promptGuidance?: {testFirst?: boolean};
}

/** Raised for usage/environment problems (no slug, no slice file, no prompt). */
export class PromptError extends Error {}

/**
 * The CONTINUE-only gate that lets {@link resolveTask} reach a task that has
 * already been done-moved into `work/done/` — story 5 of the `ledger-integrity`
 * PRD (defect 3). A continue/re-claim can legitimately land on a branch whose
 * slice was ALREADY moved to `done/` (the green-but-unpushed STRAND state), and
 * onboard must find it; but a `done/` slice is folder-indistinguishable between
 * two states and re-onboarding a genuinely-finished one would RE-RUN it. So
 * `done/` is admitted ONLY behind this gate, which disambiguates by TIP-vs-
 * ARBITER reachability, NEVER folder name alone:
 *
 *   - work-branch tip REACHABLE on `<arbiter>/main` => COMPLETE => NOT admitted
 *     (onboard must not resurrect a finished slice).
 *   - work-branch tip committed-but-NOT-on-the-arbiter => STRANDED => admitted
 *     (the continue is legitimate).
 *
 * The reachability predicate REUSES {@link isAncestor} (the one provably-merged
 * primitive in `gc.ts`, the same `merge-base --is-ancestor <tip> <arbiter>/main`
 * the reaper uses) — no second, divergent reachability implementation. Absent
 * this gate (a fresh claim — `resolveTask` called with no continue gate) the
 * resolution is UNCHANGED: `in-progress` then `backlog`, blind to `done/`.
 */
export interface ContinueResolutionGate {
	/** The repo/worktree/mirror the work-branch + arbiter refs live in. */
	cwd: string;
	/**
	 * The work-branch tip to test for reachability. In-place clone:
	 * `<arbiter>/work/<slug>`; bare hub mirror: `work/<slug>`. The SAME ref the
	 * matching {@link resolveContinueContext} call passes as `branchRef`.
	 */
	branchRef: string;
	/**
	 * The arbiter main ref the tip is tested against. In-place clone:
	 * `<arbiter>/main`; bare hub mirror: `main`. The SAME ref the matching
	 * {@link resolveContinueContext} call passes as `mainRef`.
	 */
	mainRef: string;
	/** Environment for the read-only reachability git child. */
	env?: NodeJS.ProcessEnv;
}

/**
 * True iff the work-branch tip (`gate.branchRef`) is genuinely STRANDED: it
 * resolves to a commit that is NOT reachable on the arbiter main
 * (`gate.mainRef`). REUSES {@link isAncestor} (`gc.ts`) — the one reachability
 * predicate — never a second one. When the branch ref does not resolve (no prior
 * attempt's branch on the arbiter) the slice is NOT treated as a stranded
 * continue (false → `done/` stays unreachable, the safe direction). Read-only.
 */
function isStrandedDoneTip(gate: ContinueResolutionGate): boolean {
	const tip = run(
		'git',
		['rev-parse', '--verify', '--quiet', `${gate.branchRef}^{commit}`],
		gate.cwd,
		{env: gate.env},
	).stdout.trim();
	if (tip === '') {
		return false; // no work-branch tip on the arbiter → not a stranded continue
	}
	// STRANDED ⇔ the tip is NOT an ancestor of the arbiter main (not integrated).
	// REACHABLE (an ancestor) ⇒ COMPLETE ⇒ do NOT re-onboard.
	return !isAncestor(gate.cwd, tip, gate.mainRef, gate.env);
}

/**
 * Resolve a slice's file: prefer `work/in-progress/<slug>.md`, fall back to
 * `work/backlog/<slug>.md`. Returns the parsed PRD + extracted `## Prompt` body.
 * Throws {@link PromptError} when neither file exists or it has no prompt body.
 *
 * On a CONTINUE (a {@link ContinueResolutionGate} is supplied), `work/done/` is
 * added to the resolution AFTER `in-progress`/`backlog` — but ONLY when the gate
 * proves the work-branch tip is STRANDED (committed-but-not-on-the-arbiter). A
 * genuinely-COMPLETE `done/` slice (tip reachable on `<arbiter>/main`) is NEVER
 * resolved, so onboard cannot resurrect a finished slice (defect 3 / story 5).
 * The `in-progress`/`backlog` resolution is UNCHANGED in every case; `done/` is
 * the only addition, and it is gated. With no gate (a fresh claim) the behaviour
 * is byte-identical to the original `['in-progress','tasks-todo']`-only resolution.
 */
export function resolveTask(
	cwd: string,
	slug: string,
	continueGate?: ContinueResolutionGate,
): ResolvedTask {
	const order: TaskFolder[] = ['in-progress', 'tasks-todo'];
	// `done/` is appended ONLY on a continue whose work-branch tip is STRANDED —
	// the tip-vs-arbiter gate (NEVER folder name alone). A complete slice (tip on
	// the arbiter) leaves the order untouched, so onboard never re-runs it.
	if (continueGate && isStrandedDoneTip(continueGate)) {
		order.push('done');
	}
	for (const folder of order) {
		const path = workItemPath(cwd, folder, slug);
		if (!existsSync(path)) {
			continue;
		}
		const content = readFileSync(path, 'utf8');
		const taskPrompt = extractPromptSection(content);
		if (taskPrompt === undefined) {
			throw new PromptError(
				`slice '${slug}' (${workFolderRel(folder)}/${slug}.md) has no '## Prompt' section`,
			);
		}
		const fm = parseFrontmatter(content);
		return {slug, path, folder, brief: fm.brief, taskPrompt};
	}
	const searched = order.map((f) => `${workFolderRel(f)}/`).join(', ');
	throw new PromptError(`no slice '${slug}' found in ${searched}`);
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
/**
 * Resolve the EFFECTIVE `promptGuidance` for an item by walking the precedence
 * chain (highest → lowest): the per-task frontmatter override, the per-brief
 * frontmatter override (only when the task carries a `brief:`), then the
 * already-resolved repo policy. Each nudge member resolves independently — a
 * task's `promptGuidance.testFirst` override never bleeds into a sibling
 * member — mirroring the `humanOnly`/`autoBuild` per-item override shape.
 *
 * A task may carry the override even when it has NO `brief:` (a self-contained
 * chore), by symmetry with `humanOnly` at the item level; `briefFrontmatter`
 * is then simply absent and the chain reads task ⇒ repo.
 */
export function resolveItemPromptGuidance(
	repoResolved: PromptGuidance,
	taskFrontmatter?: Frontmatter,
	briefFrontmatter?: Frontmatter,
): PromptGuidance {
	const taskTestFirst = taskFrontmatter?.promptGuidance.testFirst;
	const briefTestFirst = briefFrontmatter?.promptGuidance.testFirst;
	return {
		testFirst: taskTestFirst ?? briefTestFirst ?? repoResolved.testFirst,
	};
}

/**
 * Locate a brief's file on disk: prefer `work/briefs/ready/<slug>.md` (the
 * auto-slice pool), then fall back to `work/briefs/tasked/<slug>.md` (sliced,
 * resting). Returns `undefined` when neither exists — the caller treats that
 * as "no brief-level override available" and the precedence chain falls
 * through to the repo policy (a missing brief is NOT an error at this seam;
 * the per-item override is OPTIONAL by design).
 */
export function findBriefPath(
	cwd: string,
	briefSlug: string,
): string | undefined {
	const candidates = [
		workItemPath(cwd, 'briefs-ready', briefSlug),
		workItemPath(cwd, 'briefs-tasked', briefSlug),
	];
	for (const path of candidates) {
		if (existsSync(path)) {
			return path;
		}
	}
	return undefined;
}

/**
 * The convenience seam every caller of {@link buildAgentPrompt} reuses to
 * resolve the per-item override: load the task frontmatter from its file +
 * (when the task carries `brief:`) the brief frontmatter, then walk
 * {@link resolveItemPromptGuidance}. Pure-ish (reads at most two files);
 * returns the repo policy verbatim when neither item layer overrides anything.
 */
export function resolvePromptGuidanceForItem(options: {
	cwd: string;
	repoResolved: PromptGuidance;
	taskContent: string;
}): PromptGuidance {
	const taskFm = parseFrontmatter(options.taskContent);
	let briefFm: Frontmatter | undefined;
	if (taskFm.brief !== undefined) {
		const briefPath = findBriefPath(options.cwd, taskFm.brief);
		if (briefPath !== undefined) {
			briefFm = parseFrontmatter(readFileSync(briefPath, 'utf8'));
		}
	}
	return resolveItemPromptGuidance(options.repoResolved, taskFm, briefFm);
}

export function renderPrompt(options: PromptOptions): string {
	const slug = options.slug || inferSlugFromBranch(options.cwd, options.env);
	if (!slug) {
		throw new PromptError(
			'missing <slug> and the current branch is not a work/<slug> branch. ' +
				'usage: agent-runner prompt [<slug>]',
		);
	}
	const task = resolveTask(options.cwd, slug);
	// Per-item override layer: a task or brief may pin `promptGuidance.testFirst`
	// in its frontmatter, superseding the resolved repo policy for THIS item.
	// We ALWAYS walk the resolver (even when no repo policy was threaded), so a
	// task can opt IN to the strengthened nudge even on a repo whose default is
	// off (and vice-versa) — the per-item override is the escape hatch.
	const resolvedGuidance = resolvePromptGuidanceForItem({
		cwd: options.cwd,
		repoResolved: {testFirst: options.promptGuidance?.testFirst === true},
		taskContent: readFileSync(task.path, 'utf8'),
	});
	return buildAgentPrompt(task.slug, task.brief, task.taskPrompt, {
		protocolPath: options.protocolPath,
		cwd: options.cwd,
		promptGuidance: resolvedGuidance,
	});
}

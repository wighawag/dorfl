import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';

/**
 * The **§3a slug-namespace resolver** (`docs/adr/command-surface-and-
 * journeys.md` §3a). A PRD and a slice can share a slug (e.g. PRD `auto-slice`),
 * and `do` spans BOTH namespaces (build a slice OR slice a PRD), so a bare slug
 * is ambiguous. This module is the pure resolver that turns a CLI slug argument
 * into a resolved target, plus the guard the TASK-ONLY commands use to reject a
 * `brief:` argument.
 *
 * | input            | resolves to     | on collision (a task AND a brief share `<slug>`) |
 * | ---------------- | --------------- | ----------------------------------------------- |
 * | `<slug>` (bare)  | the **task**    | **ERROR** — "use task:<slug> or brief:<slug>"   |
 * | `task:<slug>`    | the task        | always unambiguous                              |
 * | `brief:<slug>`   | the brief       | always unambiguous                              |
 *
 * The two load-bearing rules:
 *
 *   - **Bare `<slug>` is human convenience ONLY.** It resolves to the slice, but
 *     ONLY after a cheap cross-namespace existence check confirms NO PRD shares
 *     the slug; on a collision it ERRORS loudly (it never silently guesses). CI /
 *     automation MUST use explicit prefixes (collision-proof across time).
 *   - **Task-only commands** (`claim`, `start`, `resume`, `complete`, `prompt`,
 *     `requeue`, `work-on`) accept bare (= task) + `task:` and **reject `brief:`**
 *     with a clear "operates on tasks, not briefs" error.
 *
 * It is PURE: no git, no mutation, no side effects beyond the two cheap EXISTENCE
 * reads (slice through the existing read seam; PRD through the seam's new
 * `resolvePrdExistence` PRD reader — the single shared PRD read path the later
 * autoslice / `do prd:` work reuses).
 *
 * This mirrors the field-level namespace split the contract already makes (task
 * `blockedBy` resolves against tasks; brief `briefAfter` against briefs); the
 * `task:`/`brief:` prefixes are the command-line form of that one rule.
 */

/**
 * The namespaces a slug can name. `task`/`brief` are the original §3a pair that
 * `do` spans (renamed from `slice`/`prd` in the hard cutover); `observation` is
 * the NEW namespace the `advance` verb adds (PRD `advance-loop`, slice
 * `advance-verb-resolver`) so `advance obs:<slug>` can name an observation to
 * triage. The `do`-family resolvers (`resolveSlug`, `resolveSliceOnlyArg`)
 * deliberately do NOT span `observation` — only the `advance` resolver does (see
 * {@link resolveAdvanceArg}).
 */
export type SlugNamespace = 'task' | 'brief' | 'observation';

/**
 * The PRODUCER axis (ORTHOGONAL to {@link SlugNamespace}): WHICH lifecycle
 * created the branch, when that matters for collision isolation. `'intake'` is
 * the only producer today — an `intake N` run that CREATES a brand-new backlog
 * item (`work/backlog/<slug>.md`) or PRD (`work/prd/<slug>.md`). Its branch is a
 * short-lived "create the item" branch, a SEPARATE lifecycle from the later
 * claim→build→complete of `do slice:<slug>` — so it gets its own branch ref and
 * never reuses (or is reused by) the build branch for the same slug. Absent for
 * the build/slicing paths (the common case), which carry no producer prefix.
 */
export type BranchProducer = 'intake';

/**
 * The **ONE** construction of the work-BRANCH ref from the namespaced identity.
 * The branch ref is the last identity to join the `<type>-<slug>` scheme the
 * advance sidecar filename (`work/questions/<type>-<slug>.md`) and the
 * lock entry already use — so a brief `<slug>` and a task `<slug>`
 * sharing a slug NEVER collide on the arbiter branch (the structural bug this
 * fixes: `intake`, `do task:<slug>`, and `do brief:<slug>` all built on the SAME
 * un-namespaced `work/<slug>` branch).
 *
 * Spelling: `work/<type>-<slug>` (i.e. `work/task-<slug>`, `work/brief-<slug>`),
 * matching the lock-entry + sidecar-filename `<type>-<slug>` form EXACTLY. The
 * optional {@link BranchProducer} prefixes it (`work/<producer>-<type>-<slug>`,
 * e.g. `work/intake-task-<slug>`, `work/intake-brief-<slug>`) so a branch that
 * CREATES an item (intake) never collides with the branch that later BUILDS the
 * same-slug task. One consistent rule, not a second derivation. EVERY site
 * that builds or reads a work-branch ref MUST call this (or
 * {@link parseWorkBranchRef}); none may hand-build `work/${slug}`.
 */
export function workBranchRef(
	namespace: SlugNamespace,
	slug: string,
	opts?: {producer?: BranchProducer},
): string {
	const producer = opts?.producer;
	return producer === undefined
		? `work/${namespace}-${slug}`
		: `work/${producer}-${namespace}-${slug}`;
}

/**
 * The inverse of {@link workBranchRef}: parse a namespaced work-branch ref back
 * into its `{producer?, namespace, slug}`. Returns `undefined` for any ref that
 * is NOT a `work/[<producer>-]<type>-<slug>` branch (e.g. `main`, a detached
 * HEAD, or — after the clean breaking cutover — a pre-rename `work/slice-<slug>`
 * / `work/prd-<slug>` ref or an un-namespaced `work/<slug>`). This is how
 * `complete`/`integration` recover the type carried IN the branch name they are
 * already standing on, rather than re-deriving it inconsistently. The regex
 * anchors the optional producer prefix BEFORE the type alternation, so
 * `work/intake-task-foo` resolves to
 * `{producer:'intake', namespace:'task', slug:'foo'}` (the `slug` never
 * swallows the `intake-`/`task-` prefixes). The old `slice`/`prd` types are NOT
 * in the alternation, so a pre-rename `work/slice-foo` ref returns `undefined`
 * (the clean-break stance: no migration-window alias).
 */
export function parseWorkBranchRef(
	branch: string,
):
	| {producer?: BranchProducer; namespace: SlugNamespace; slug: string}
	| undefined {
	const match = /^work\/(?:(intake)-)?(task|brief)-(.+)$/.exec(branch);
	if (!match) {
		return undefined;
	}
	const producer = match[1] as BranchProducer | undefined;
	const result: {
		producer?: BranchProducer;
		namespace: SlugNamespace;
		slug: string;
	} = {namespace: match[2] as SlugNamespace, slug: match[3]};
	if (producer !== undefined) {
		result.producer = producer;
	}
	return result;
}

/** A slug argument's parsed namespace + bare slug (before any existence check). */
export interface ParsedSlugArg {
	/**
	 * `'task'` / `'brief'` when an explicit prefix was given; `undefined` for a
	 * bare slug (the namespace is then resolved by the cross-namespace check).
	 */
	explicit: SlugNamespace | undefined;
	/** The bare slug with any `task:`/`brief:` prefix stripped. */
	slug: string;
}

/** A fully-resolved slug target: which namespace it names + the bare slug. */
export interface ResolvedSlug {
	namespace: SlugNamespace;
	slug: string;
	/** Whether the caller wrote an explicit `task:`/`brief:` prefix. */
	explicit: boolean;
}

/** The explicit-prefix forms the resolver understands. */
const TASK_PREFIX = 'task:';
const BRIEF_PREFIX = 'brief:';
/**
 * The observation namespace's prefixes: the short `obs:` CLI alias and the
 * canonical `observation:` long form both parse to the `observation` namespace.
 * Only the `advance` resolver acts on this namespace; `do` rejects it.
 */
const OBS_PREFIX = 'obs:';
const OBSERVATION_PREFIX = 'observation:';

/**
 * Raised when a slug argument cannot be resolved: an ambiguous bare slug
 * (collision across namespaces), or a `brief:` argument handed to a task-only
 * command. Carries a clear, human-resolvable message.
 */
export class SlugResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SlugResolutionError';
	}
}

/**
 * Split a raw CLI slug argument into its explicit namespace (if any) + the bare
 * slug. PURE string work, no existence check: `task:foo` → explicit task,
 * `brief:foo` → explicit brief, `foo` → bare (`explicit: undefined`). The prefix
 * match is case-sensitive and exact (`task:`/`brief:`); a slug like `tasked` is
 * NOT a prefix and stays bare.
 */
export function parseSlugArg(arg: string): ParsedSlugArg {
	if (arg.startsWith(TASK_PREFIX)) {
		return {explicit: 'task', slug: arg.slice(TASK_PREFIX.length)};
	}
	if (arg.startsWith(BRIEF_PREFIX)) {
		return {explicit: 'brief', slug: arg.slice(BRIEF_PREFIX.length)};
	}
	if (arg.startsWith(OBSERVATION_PREFIX)) {
		return {
			explicit: 'observation',
			slug: arg.slice(OBSERVATION_PREFIX.length),
		};
	}
	if (arg.startsWith(OBS_PREFIX)) {
		return {explicit: 'observation', slug: arg.slice(OBS_PREFIX.length)};
	}
	return {explicit: undefined, slug: arg};
}

/** What the resolver needs to perform the existence checks. */
export interface ResolveSlugInput {
	/** The raw CLI slug argument (bare, `task:<slug>`, or `brief:<slug>`). */
	arg: string;
	/** The repo working-tree root whose `work/` namespaces to read. */
	repoPath: string;
	/**
	 * The read seam to resolve existence through (task via `resolveLocalState`,
	 * brief via `resolvePrdExistence`). Defaults to the active {@link ledgerRead};
	 * injectable for tests.
	 */
	read?: LedgerReadStrategy;
}

/** Does a TASK named `slug` exist (backlog or in-progress) in this repo? */
function taskExists(
	read: LedgerReadStrategy,
	repoPath: string,
	slug: string,
): boolean {
	// The task side resolves THROUGH the existing read seam — its local-tree
	// method already parses the task-pool slugs (frontmatter, falling back
	// to filename). An in-progress task is ALSO a task (a claimed one); the
	// local state's backlog covers the up-for-grabs case, which is what a bare
	// `<slug>` collision check needs.
	const state = read.resolveLocalState({repoPath});
	return state.todo.some((item) => item.slug === slug);
}

/** Does a BRIEF named `slug` exist (ready or being sliced) in this repo? */
function briefExists(
	read: LedgerReadStrategy,
	repoPath: string,
	slug: string,
): boolean {
	return read.resolveBriefExistence({repoPath, slug}).exists;
}

/**
 * Resolve a raw slug argument (`do`'s cross-namespace path) into its namespace +
 * bare slug, per ADR §3a:
 *
 *   - `task:<slug>`  → `{namespace: 'task'}`  — always unambiguous (no check).
 *   - `brief:<slug>` → `{namespace: 'brief'}` — always unambiguous (no check).
 *   - `<slug>` (bare) → the **task**, but ONLY after confirming no brief shares the
 *     slug. On a collision (both a task AND a brief named `<slug>` exist) it throws
 *     {@link SlugResolutionError} — loud, immediate, human-resolvable. It NEVER
 *     silently guesses.
 *
 * Explicit prefixes skip the existence check entirely (they are collision-proof
 * by construction); only the bare path pays the cheap cross-namespace read.
 */
export function resolveSlug(input: ResolveSlugInput): ResolvedSlug {
	const read = input.read ?? ledgerRead;
	const parsed = parseSlugArg(input.arg);

	if (parsed.explicit === 'observation') {
		// `do` spans the task/brief namespaces ONLY (build a task OR slice a brief).
		// The `observation` namespace is `advance`'s alone (triage). Reject it here
		// rather than let a `do obs:<slug>` resolve into a namespace `do` cannot act
		// on — point the human at the verb that owns it.
		throw new SlugResolutionError(
			`'${input.arg}' names an observation, which \`do\` does not act on. ` +
				`Use \`advance obs:${parsed.slug}\` to triage it.`,
		);
	}
	if (parsed.explicit !== undefined) {
		// Explicit prefix: unambiguous by construction. No existence check.
		return {namespace: parsed.explicit, slug: parsed.slug, explicit: true};
	}

	// Bare slug: resolve to the task, but ONLY after the cross-namespace check.
	// A task/brief collision is a loud ERROR — never a silent guess.
	if (briefExists(read, input.repoPath, parsed.slug)) {
		throw new SlugResolutionError(
			`'${parsed.slug}' is ambiguous: both a task and a brief share that slug. ` +
				`Use \`task:${parsed.slug}\` or \`brief:${parsed.slug}\` to disambiguate.`,
		);
	}
	return {namespace: 'task', slug: parsed.slug, explicit: false};
}

/**
 * Resolve a slug argument for the `advance` verb (PRD `advance-loop`, slice
 * `advance-verb-resolver`). `advance` is the SIBLING top-level verb (NOT a `do`
 * subcommand) that reuses this SAME shared `prefix:arg` resolver, EXTENDED with
 * the `observation` namespace `do` does not span:
 *
 *   - `task:<slug>`        → `{namespace: 'task'}`        — unambiguous (no check).
 *   - `brief:<slug>`       → `{namespace: 'brief'}`       — unambiguous (no check).
 *   - `obs:<slug>` /
 *     `observation:<slug>`  → `{namespace: 'observation'}` — unambiguous (no check).
 *   - `<slug>` (bare)      → the **task**, but ONLY after the SAME cheap
 *     cross-namespace check `do` makes (no brief shares the slug); on a task/brief
 *     collision it throws {@link SlugResolutionError}, never silently guessing.
 *
 * The bare-slug cross-check is intentionally IDENTICAL to {@link resolveSlug}'s
 * (bare = task, error on a task/brief collision) — the "bare slug = task"
 * ergonomic is preserved exactly as `do` has it. An observation is NEVER reached
 * by a bare slug; it must be named explicitly (`obs:<slug>`), because the bare
 * path stays the task/brief two-namespace check (an observation sharing a slug
 * does not make a bare slug ambiguous — a human typing a bare slug means the
 * task, as everywhere else).
 */
export function resolveAdvanceArg(input: ResolveSlugInput): ResolvedSlug {
	const read = input.read ?? ledgerRead;
	const parsed = parseSlugArg(input.arg);

	if (parsed.explicit !== undefined) {
		// Explicit prefix (task / brief / observation): unambiguous by construction.
		return {namespace: parsed.explicit, slug: parsed.slug, explicit: true};
	}

	// Bare slug: the SAME task/brief cross-namespace check `do` makes — bare = task,
	// a task/brief collision is a loud ERROR, never a silent guess.
	if (briefExists(read, input.repoPath, parsed.slug)) {
		throw new SlugResolutionError(
			`'${parsed.slug}' is ambiguous: both a task and a brief share that slug. ` +
				`Use \`task:${parsed.slug}\` or \`brief:${parsed.slug}\` to disambiguate.`,
		);
	}
	return {namespace: 'task', slug: parsed.slug, explicit: false};
}

/**
 * Resolve a slug argument for a TASK-ONLY command (`claim`, `start`, `resume`,
 * `complete`, `prompt`, `requeue`, `work-on`). These operate on tasks, not briefs,
 * so:
 *
 *   - `brief:<slug>` is REJECTED with a clear "operates on tasks, not briefs" error.
 *   - `task:<slug>` is accepted (the explicit alias) → the bare slug.
 *   - `<slug>` (bare) is accepted (= the task). A task-only command does NOT
 *     need the cross-namespace collision check: a bare slug here ALWAYS means the
 *     task (there is no brief ambiguity, because the brief namespace is rejected
 *     outright), so it resolves straight to the task slug.
 *
 * Returns the bare task slug to feed the existing task machinery (claim CAS,
 * start, …). PURE: it touches no files (no existence read needed — `brief:` is
 * rejected on the prefix alone, bare/`task:` resolve to the task slug).
 */
export function resolveTaskOnlyArg(arg: string): string {
	const parsed = parseSlugArg(arg);
	if (parsed.explicit === 'brief') {
		throw new SlugResolutionError(
			`this command operates on tasks, not briefs — '${arg}' names a brief. ` +
				`Drop the \`brief:\` prefix to act on the task, or use \`do ${arg}\` ` +
				`to slice the brief.`,
		);
	}
	if (parsed.explicit === 'observation') {
		throw new SlugResolutionError(
			`this command operates on tasks, not observations — '${arg}' names an ` +
				`observation. Use \`advance obs:${parsed.slug}\` to triage it.`,
		);
	}
	// Bare or `task:` → the task slug. (A bare slug on a task-only command is
	// unambiguously the task; the brief namespace is unreachable here.)
	return parsed.slug;
}

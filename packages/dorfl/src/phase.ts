/**
 * The **CI phase mode** (spec `ci-agent-job-without-write-token`, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-phase-mode-and-guards`).
 *
 * In GitHub Actions every CI item runs as three jobs, and the SAME dorfl verb
 * (`intake`, `advance`; `do` for parity) runs once per job with a hidden
 * `--phase`:
 *
 *  - **`lock`**: the write token, NO agent, NO repository code. Takes the lock
 *    (and the other pre-agent writes) and emits trusted facts.
 *  - **`agent`**: a read-only token (`persist-credentials: false`). Runs the
 *    agents, the gate and every local commit, and RECORDS the first write
 *    instead of performing it (see `phase-recorder.ts`).
 *  - **`apply`**: the write token, NO agent, NO repository code. Performs the
 *    recorded writes from the agent job's handoff, treated as hostile.
 *
 * Absent `--phase` is today's single process, byte for byte: the active phase
 * is `undefined` and every guard below is a no-op.
 *
 * The active phase is PROCESS-GLOBAL on purpose: a phase run is a one-shot CI
 * process, and the chokepoints it must guard (`agentLaunchEnv`, the harness
 * adapters, `runVerify`, `runPrepare`, the write seams) are reached from deep
 * inside pipelines that do not carry a context. The same value is ALSO threaded
 * through the run context (`AdvanceContext.phase`, `DoOptions.phase`,
 * `PerformIntakeOptions.phase`) so the pipelines can branch on it; the global
 * is what the guards trust.
 */

/** One of the three CI jobs a dorfl verb runs as (see the module comment). */
export type Phase = 'lock' | 'agent' | 'apply';

/** Every {@link Phase}, in pipeline order. */
export const PHASES: readonly Phase[] = ['lock', 'agent', 'apply'];

/**
 * A `--phase` value that is not allowed: an unknown phase name, or any phase
 * outside GitHub Actions. A usage error, raised before anything runs.
 */
export class PhaseUsageError extends Error {
	override readonly name = 'PhaseUsageError';
}

/**
 * Parse and admit a `--phase` value. It must be one of {@link PHASES}, and it is
 * only allowed when `GITHUB_ACTIONS=true` in `env`, so a phase cannot change
 * laptop behaviour by accident. `allowOutsideActions` is the explicit TEST
 * override (never wired to a flag, an env var or config).
 */
export function parsePhase(
	raw: string,
	options: {env?: NodeJS.ProcessEnv; allowOutsideActions?: boolean} = {},
): Phase {
	const value = raw.trim();
	if (!(PHASES as readonly string[]).includes(value)) {
		throw new PhaseUsageError(
			`--phase must be one of ${PHASES.join(', ')} (got '${raw}').`,
		);
	}
	const env = options.env ?? process.env;
	if (env.GITHUB_ACTIONS !== 'true' && options.allowOutsideActions !== true) {
		throw new PhaseUsageError(
			'--phase is CI-only: it splits one item into the lock, agent and apply ' +
				'jobs of a GitHub Actions workflow and requires GITHUB_ACTIONS=true. ' +
				'Run the verb without --phase for the normal single-process behaviour.',
		);
	}
	return value as Phase;
}

let current: Phase | undefined;

/** The phase this process runs as, or `undefined` (no `--phase`: today's behaviour). */
export function activePhase(): Phase | undefined {
	return current;
}

/**
 * Make `phase` the active phase and return a function restoring the previous
 * one. The CLI enters the phase once for the whole (one-shot) process; the
 * phase drivers and tests scope it with the returned restore.
 */
export function enterPhase(phase: Phase | undefined): () => void {
	const previous = current;
	current = phase;
	return () => {
		current = previous;
	};
}

/** What a {@link PhaseGuardError} refused to do. */
export type GuardedOperation =
	| 'agent-launch-env'
	| 'harness-launch'
	| 'verify'
	| 'prepare';

/**
 * A phase guard fired: dorfl tried to launch an agent or run repository code in
 * the `lock` or `apply` phase, whose job holds the write token. Always a dorfl
 * BUG (the pipeline split is wrong), never a user error; defence in depth that
 * holds whatever the workflow shape.
 */
export class PhaseGuardError extends Error {
	override readonly name = 'PhaseGuardError';
	constructor(
		readonly phase: Phase,
		readonly operation: GuardedOperation,
	) {
		super(
			`phase guard: '${operation}' is not allowed in the ${phase} phase ` +
				'(the lock and apply jobs hold the write token, so they never launch ' +
				'an agent or run repository code). This is a dorfl bug in the phase split.',
		);
	}
}

/**
 * Throw a {@link PhaseGuardError} when the active phase is `lock` or `apply`.
 * Called at every chokepoint that launches an agent or runs repository code:
 * `agentLaunchEnv`, each harness adapter's launch, `runVerify` and
 * `runPrepare`. A no-op without a phase and in the `agent` phase.
 */
export function assertAgentOrRepoCodeAllowed(
	operation: GuardedOperation,
): void {
	const phase = current;
	if (phase === 'lock' || phase === 'apply') {
		throw new PhaseGuardError(phase, operation);
	}
}

/**
 * Every CLI verb that can launch an agent (autonomous or interactive) or run
 * repository code (`prepare` / `verify`). A CI job that runs one of these must
 * be the agent job (read-only token, no persisted credential) or pass
 * `--phase lock|apply`. The workflow guard (task `ci-split-generate-workflows`)
 * and the single-job warning (task `ci-split-warn-single-job-workflows`) read
 * this set; `phase-verbs.test.ts` fails when a CLI verb is in neither this set
 * nor {@link NON_AGENT_VERBS}.
 */
export const AGENT_SPAWNING_VERBS: ReadonlySet<string> = new Set([
	'run',
	'verify',
	'start',
	'resume',
	'work-on',
	'complete',
	'do',
	'advance',
	'intake',
]);

/**
 * Every CLI verb that neither launches an agent nor runs repository code (it
 * reads, or writes refs / the ledger / provider state only). The explicit
 * complement of {@link AGENT_SPAWNING_VERBS}, so a new verb must be classified.
 */
export const NON_AGENT_VERBS: ReadonlySet<string> = new Set([
	'config',
	'scan',
	'claim',
	'prompt',
	'gc',
	'sync',
	'prd-to-spec',
	'status',
	'requeue',
	'promote',
	'release-lock',
	'migrate-stuck-locks',
	'drop',
	'close-merged-issues',
	'remote',
	'install-ci',
	'skills',
]);

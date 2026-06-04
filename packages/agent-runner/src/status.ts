import {discoverJobs, type GcJob} from './gc.js';
import {NullHarness, type Harness} from './harness.js';
import {type JobState} from './workspace.js';
import {
	readNeedsAttentionItems,
	type NeedsAttentionItem,
} from './needs-attention.js';

/**
 * `agent-runner status` — the **operational dashboard of jobs** (ADR §4/§5/§12
 * in `docs/adr/execution-substrate-decisions.md`). Split out of
 * `agent-workspaces` so the substrate stays thin; this module owns the view.
 *
 * It lists the jobs under `<workspacesDir>/work/*` from their
 * `.agent-runner-job.json` records + worktree state, grouped by state:
 *
 *   - **active** — `running` AND the harness reports the job still alive.
 *   - **failed / retained** — everything that wants a human's eye: a job the
 *     `needs-attention` mechanism flagged (with its reason, ADR §12), a `done`
 *     job whose worktree was never reaped (awaiting cleanup), or a `running`
 *     job whose harness reports it DEAD (crashed — the runner died mid-flight).
 *
 * **Liveness comes from the harness seam (PID / session), NOT filesystem mtime**
 * (ADR §5): a live agent can think for minutes without writing files, so mtime
 * would mistake a thinking agent for a dead one. The harness answers liveness
 * from the real signal.
 *
 * It is strictly **read-only**: it inspects records/worktrees; it never claims,
 * runs, moves, or deletes (deletion is `gc`; the needs-attention move is the
 * runner's). It reuses the `gc` `discoverJobs` primitive to enumerate jobs (it
 * does NOT re-implement the work-area layout).
 *
 * Distinct from `scan`: `scan` answers "what work is in the *backlog* and who
 * can take it"; `status` answers "what is *running / stuck / awaiting cleanup*
 * right now". The retained-worktree + needs-attention items are the "look here"
 * set.
 */

/** One job as the operational dashboard sees it (a record + its liveness). */
export interface JobStatus {
	/** The work slug being processed. */
	slug: string;
	/** The encoded repo key the job's hub mirror was cut from. */
	repo: string;
	/** The work branch checked out in the worktree (`work/<slug>`). */
	branch: string;
	/** ISO timestamp the job worktree was created. */
	startedAt: string;
	/** The persisted lifecycle state. */
	state: JobState;
	/** Liveness FROM THE HARNESS SEAM (PID/session), never mtime (ADR §5). */
	alive: boolean;
	/**
	 * Why the job is stuck (ADR §12), when known — surfaced for the
	 * failed/retained group. Present for `needs-attention` jobs that recorded a
	 * reason; absent otherwise.
	 */
	reason?: string;
	/** Absolute path to the job worktree (for the human to look). */
	dir: string;
}

/** One repo's `work/needs-attention/` folder, surfaced for the dashboard. */
export interface RepoNeedsAttention {
	/** The repo path whose `work/needs-attention/` was read. */
	repoPath: string;
	/** The stuck items (slug + recorded reason) in that folder. */
	items: NeedsAttentionItem[];
}

/** The operational groups `status` reports. */
export interface StatusReport {
	/** Running jobs the harness reports still alive. */
	active: JobStatus[];
	/** Stuck (needs-attention), crashed (running-but-dead), or un-reaped (done) jobs. */
	attention: JobStatus[];
	/**
	 * The folder-native needs-attention surface (ADR §12): each participating
	 * repo's `work/needs-attention/<slug>.md` items with their recorded reason.
	 * This is the durable "look here" set in the repo's `work/` tree (distinct from
	 * the transient job worktrees above). Empty when no `repoRoots` were given.
	 * Optional in the type so the older job-only literals stay valid; `status()`
	 * always populates it (possibly empty).
	 */
	needsAttention?: RepoNeedsAttention[];
}

export interface StatusOptions {
	/** The execution working area to inspect (config `workspacesDir`). */
	workspacesDir: string;
	/**
	 * The harness used to answer liveness (PID/session — never mtime). Defaults
	 * to the null adapter; the `pi` adapter (and tests' stubs) plug in here.
	 */
	harness?: Harness;
	/**
	 * Participating repo paths whose `work/needs-attention/` folders to surface
	 * (ADR §12). The CLI wires these from `detectRepos(config)`. Omitted ⇒ the
	 * folder-native surface is skipped (only the job worktrees are reported).
	 */
	repoRoots?: string[];
}

/**
 * Build the operational status of every job under `<workspacesDir>/work/*`
 * (ADR §4/§5/§12). READ-ONLY: enumerates job records via the `gc` `discoverJobs`
 * primitive, asks the harness for liveness (NOT mtime), and groups each job as
 * **active** (running + alive) or **failed/retained** (needs-attention, a
 * crashed running-but-dead job, or a done-but-un-reaped one). Mutates nothing —
 * no claim/run/move/delete.
 */
export function status(options: StatusOptions): StatusReport {
	const harness = options.harness ?? new NullHarness();
	const active: JobStatus[] = [];
	const attention: JobStatus[] = [];

	for (const job of discoverJobs(options.workspacesDir)) {
		const view = toJobStatus(job, harness);
		// Active iff the runner believes the job is in flight (`running`) AND the
		// harness confirms it is still alive. Everything else is "look here":
		//   - needs-attention: the runner flagged it (gate red, conflict, …)
		//   - done: landed but the worktree wasn't reaped (awaiting cleanup)
		//   - running but NOT alive: the process died mid-flight (crashed)
		if (view.state === 'running' && view.alive) {
			active.push(view);
		} else {
			attention.push(view);
		}
	}

	active.sort(bySlug);
	attention.sort(bySlug);

	const needsAttention: RepoNeedsAttention[] = [];
	for (const repoPath of options.repoRoots ?? []) {
		const items = readNeedsAttentionItems(repoPath);
		if (items.length > 0) {
			needsAttention.push({repoPath, items});
		}
	}
	needsAttention.sort((a, b) => a.repoPath.localeCompare(b.repoPath));

	return {active, attention, needsAttention};
}

function bySlug(a: JobStatus, b: JobStatus): number {
	return a.slug.localeCompare(b.slug);
}

/** Project a discovered job + its harness liveness into a `JobStatus`. */
function toJobStatus(job: GcJob, harness: Harness): JobStatus {
	const record = job.record;
	const alive = record !== undefined ? harness.isAlive(record.harness) : false;
	return {
		slug: job.slug,
		repo: record?.repoKey ?? '(unknown)',
		branch: job.branch,
		startedAt: record?.startedAt ?? '(unknown)',
		state: record?.state ?? 'running',
		alive,
		reason: record?.reason,
		dir: job.dir,
	};
}

/**
 * Render the operational status for the terminal: an **Active jobs** section and
 * a **Failed / retained jobs** section, each line carrying slug, repo, branch,
 * and started-at — plus, for stuck jobs, the recorded reason, and for a
 * running-but-dead job a `(crashed — no longer alive)` marker.
 *
 * Deliberately framed in terms of **jobs** (running / stuck / awaiting cleanup),
 * NOT the backlog *queue* — that is what keeps it visibly distinct from `scan`.
 */
export function formatStatus(report: StatusReport): string {
	const lines: string[] = [];

	const needsAttention = report.needsAttention ?? [];
	const naCount = needsAttention.reduce((sum, r) => sum + r.items.length, 0);
	if (
		report.active.length === 0 &&
		report.attention.length === 0 &&
		naCount === 0
	) {
		return 'No jobs running or retained (the work area is empty).';
	}

	lines.push('Active jobs (running):');
	if (report.active.length === 0) {
		lines.push('  (none)');
	} else {
		for (const job of report.active) {
			lines.push(formatJobLine(job));
		}
	}
	lines.push('');

	lines.push('Failed / retained jobs (look here):');
	if (report.attention.length === 0) {
		lines.push('  (none)');
	} else {
		for (const job of report.attention) {
			lines.push(formatJobLine(job));
		}
	}

	// The folder-native needs-attention surface (ADR §12): items the runner
	// bounced from in-progress/done to work/needs-attention/, each with its reason.
	if (naCount > 0) {
		lines.push('');
		lines.push('Needs attention (work/needs-attention/ — a human must look):');
		for (const repo of needsAttention) {
			lines.push(`  ${repo.repoPath}`);
			for (const item of repo.items) {
				const reason =
					item.reason !== '' ? item.reason : '(no reason recorded)';
				lines.push(`    ${item.slug}`);
				lines.push(`      reason: ${reason}`);
			}
		}
	}

	lines.push('');
	lines.push(
		`Summary: ${report.active.length} active, ${report.attention.length} failed/retained job(s)` +
			(naCount > 0 ? `, ${naCount} needs-attention item(s).` : '.'),
	);

	return lines.join('\n');
}

/** One `slug  repo  branch  started-at  [marker]` job line, with reason below. */
function formatJobLine(job: JobStatus): string {
	const marker = jobMarker(job);
	const head = `  ${job.slug}   ${job.repo}   ${job.branch}   started ${job.startedAt}${marker}`;
	if (job.reason !== undefined && job.reason !== '') {
		return `${head}\n      reason: ${job.reason}`;
	}
	return head;
}

/**
 * A trailing marker that explains WHY a non-active job is in the look-here group:
 * a `running` job the harness reports dead is a **crashed** runner; a `done` job
 * is **awaiting cleanup** (`gc` will reap it); a `needs-attention` job is
 * **stuck** (its reason is rendered separately).
 */
function jobMarker(job: JobStatus): string {
	if (job.state === 'running' && !job.alive) {
		return '   (crashed — no longer alive)';
	}
	if (job.state === 'done') {
		return '   (done — awaiting cleanup)';
	}
	if (job.state === 'needs-attention') {
		return '   (needs attention)';
	}
	return '';
}

import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseFrontmatter, setNeedsAnswersMarker} from './frontmatter.js';
import {isEntryAnswered, parseSidecar, sidecarPathFor} from './sidecar.js';
import {workItemPath, workItemRel} from './work-layout.js';

/** What {@link clearOwnQuestionResidueOnLand} did to the working tree. */
export interface LandQuestionResidueResult {
	/**
	 * Repo-relative paths this pass CHANGED in the working tree (the done record
	 * whose `needsAnswers` it cleared, the sidecar it deleted). Empty ⇒ the tree is
	 * byte-for-byte untouched (the normal land).
	 */
	changed: string[];
	/** True when the done record's `needsAnswers: true` was rewritten to `false`. */
	unflagged: boolean;
	/** True when the item's own unanswered question sidecar was deleted. */
	drainedSidecar: boolean;
	/**
	 * True when the item's sidecar carries a human ANSWER (or could not be parsed)
	 * and was therefore left alone, together with the flag.
	 */
	held: boolean;
}

/**
 * CLEAR a landing task's OWN stale question state in the WORKING TREE, so it
 * rides the land's completion commit instead of surviving onto `main` (task
 * `a-recovered-task-lands-without-stale-question-state`).
 *
 * THE DEFECT. A task surfaced to needs-attention (`surfaceStuckToNeedsAttention`
 * writes `needsAnswers: true` on the body AND `work/questions/task-<slug>.md` in
 * one commit on `main`) and then RECOVERED (a re-dispatch, a requeue continue, a
 * stranded-branch finish) carried both halves straight through its done-move:
 * the `git mv ... → tasks/done/` kept the flag, and nothing deleted the sidecar.
 * The claim-time reconcile (`reconcileTerminalQuestionResidue`) drained them only
 * on the NEXT claim, so the ledger was wrong in between, and stayed wrong when no
 * claim followed.
 *
 * WHY THE LAND and not a later sweep: the done-move is the moment the residue
 * becomes residue, and the land already owns a commit that touches exactly this
 * item. Folding the clean-up into it leaves no window at all.
 *
 * SAME SEMANTICS as the claim-time drain for a `completed` terminal, so the two
 * never disagree about what "stale" means:
 *   - the flag is set to `needsAnswers: false` via the SAME
 *     {@link setNeedsAnswersMarker} writer, and only when it parses back as
 *     `false` (a body the writer cannot annotate is left alone rather than
 *     written as something we cannot vouch for);
 *   - a sidecar carrying ANY answered entry is never deleted, and the item's flag
 *     is then left alone too (a human's unapplied answer is data the tool did not
 *     author; the answered-merge apply rung owns that sidecar). An unparseable
 *     sidecar is held the same way (every uncertainty resolves to leaving state
 *     alone).
 *
 * Only ever touches the landing task's own two paths, and only when its done
 * record exists in the tree. A normal land (no flag, no sidecar) changes nothing.
 * Best-effort: never throws; a fault leaves the tree as it was.
 */
export function clearOwnQuestionResidueOnLand(params: {
	cwd: string;
	slug: string;
	note?: (message: string) => void;
}): LandQuestionResidueResult {
	const {cwd, slug} = params;
	const note = params.note ?? (() => {});
	const result: LandQuestionResidueResult = {
		changed: [],
		unflagged: false,
		drainedSidecar: false,
		held: false,
	};
	const donePath = workItemPath(cwd, 'done', slug);
	if (!existsSync(donePath)) {
		return result; // not a task done-move (a lifecycle / degenerate shape).
	}
	const sidecarRel = sidecarPathFor(`task:${slug}`);
	const sidecarAbs = join(cwd, sidecarRel);
	try {
		if (existsSync(sidecarAbs)) {
			let answered: boolean;
			try {
				answered = parseSidecar(readFileSync(sidecarAbs, 'utf8')).entries.some(
					(e) => isEntryAnswered(e),
				);
			} catch {
				answered = true; // unparseable: hold, never delete what we cannot read.
			}
			if (answered) {
				result.held = true;
				note(
					`Left ${sidecarRel} and the needsAnswers flag of '${slug}' in place: ` +
						'the sidecar carries an answer (or could not be read), which the ' +
						'land never discards.',
				);
				return result;
			}
			rmSync(sidecarAbs, {force: true});
			result.drainedSidecar = true;
			result.changed.push(sidecarRel);
		}
		const body = readFileSync(donePath, 'utf8');
		if (parseFrontmatter(body).needsAnswers === true) {
			const cleared = setNeedsAnswersMarker(body, false);
			if (parseFrontmatter(cleared).needsAnswers === false) {
				writeFileSync(donePath, cleared);
				result.unflagged = true;
				result.changed.push(workItemRel('done', `${slug}.md`));
			}
		}
	} catch {
		// Best-effort: never fail a green land over question-state hygiene.
	}
	if (result.changed.length > 0) {
		note(
			`Cleared the stale question state of '${slug}' in its land ` +
				`(${result.changed.join(', ')}): the task is done, so its ` +
				'needs-attention question is moot.',
		);
	}
	return result;
}

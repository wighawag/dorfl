/**
 * A FILE-BACKED stub issue provider for the intake phase tests (task
 * `ci-split-intake`). The issue, its thread and its labels live in one JSON file,
 * so the lock, agent and apply phases (in one process or in three) all see the
 * same GitHub stand-in. Every call is appended to the file's `calls` log (reads
 * and writes), so a test can assert which phase did what.
 */

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import type {
	Issue,
	IssueComment,
	IssueProvider,
} from '../../src/issue-provider.js';

/** One recorded provider call. */
export interface IssueCall {
	method: string;
	label?: string;
	body?: string;
	comment?: string;
	reason?: string;
}

/** The stand-in's whole state. */
export interface IssueState {
	issue: Issue;
	comments: IssueComment[];
	labels: string[];
	closed?: boolean;
	calls: IssueCall[];
	/** Every comment id the next `postIssueComment` / `closeIssue` assigns from. */
	nextId?: number;
}

/** The provider methods that change the issue (the "writes"). */
export const ISSUE_WRITE_METHODS = [
	'postIssueComment',
	'closeIssue',
	'addLabel',
	'removeLabel',
];

export function writeIssueState(path: string, state: IssueState): void {
	writeFileSync(path, JSON.stringify(state, null, 2));
}

export function readIssueState(path: string): IssueState {
	return JSON.parse(readFileSync(path, 'utf8')) as IssueState;
}

/** Seed the state file for issue `issue.number` (no labels, no calls). */
export function seedIssueState(
	path: string,
	issue: Issue,
	comments: IssueComment[] = [],
): void {
	writeIssueState(path, {issue, comments, labels: [], calls: [], nextId: 900});
}

/** Append a comment to the thread directly (a human commenting). */
export function addThreadComment(path: string, comment: IssueComment): void {
	const state = readIssueState(path);
	state.comments.push(comment);
	writeIssueState(path, state);
}

/** The recorded calls that WRITE to the issue. */
export function issueWrites(path: string): IssueCall[] {
	if (!existsSync(path)) return [];
	return readIssueState(path).calls.filter((c) =>
		ISSUE_WRITE_METHODS.includes(c.method),
	);
}

export function fileIssueProvider(path: string): IssueProvider {
	const update = <T>(fn: (state: IssueState) => T): T => {
		const state = readIssueState(path);
		const out = fn(state);
		writeIssueState(path, state);
		return out;
	};
	const newId = (state: IssueState): string => {
		const id = state.nextId ?? 900;
		state.nextId = id + 1;
		return `IC_kwstub${id}`;
	};
	return {
		name: 'stub',
		async getIssue() {
			return update((s) => {
				s.calls.push({method: 'getIssue'});
				return {...s.issue};
			});
		},
		async listComments() {
			return update((s) => {
				s.calls.push({method: 'listComments'});
				return s.comments.map((c) => ({...c}));
			});
		},
		async postIssueComment(input) {
			return update((s) => {
				s.calls.push({method: 'postIssueComment', body: input.body});
				s.comments.push({id: newId(s), author: 'dorfl-bot', body: input.body});
				return {posted: true, instruction: 'posted'};
			});
		},
		async closeIssue(input) {
			return update((s) => {
				s.calls.push({
					method: 'closeIssue',
					comment: input.comment,
					reason: input.reason,
				});
				if (input.comment !== undefined) {
					s.comments.push({
						id: newId(s),
						author: 'dorfl-bot',
						body: input.comment,
					});
				}
				s.closed = true;
				return {closed: true, instruction: 'closed'};
			});
		},
		async getLabels() {
			return update((s) => {
				s.calls.push({method: 'getLabels'});
				return {
					outcome: 'ok' as const,
					supported: true,
					labels: [...s.labels],
					instruction: 'read labels',
				};
			});
		},
		async addLabel({label}) {
			return update((s) => {
				s.calls.push({method: 'addLabel', label});
				if (!s.labels.includes(label)) s.labels.push(label);
				return {
					outcome: 'applied' as const,
					applied: true,
					instruction: `added ${label}`,
				};
			});
		},
		async removeLabel({label}) {
			return update((s) => {
				s.calls.push({method: 'removeLabel', label});
				s.labels = s.labels.filter((l) => l !== label);
				return {
					outcome: 'applied' as const,
					applied: true,
					instruction: `removed ${label}`,
				};
			});
		},
	};
}

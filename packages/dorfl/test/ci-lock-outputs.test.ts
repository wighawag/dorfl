import {describe, it, expect} from 'vitest';
import {
	LockOutputRefused,
	serializeLockOutputs,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {handoffName} from '../src/ci-handoff-format.js';

/**
 * The lock job's outputs are the apply job's trusted channel, so they may carry
 * only shas, enums, booleans, bounded integers and dorfl-derived names: free
 * text (an issue title) is refused, never escaped.
 */

const SHA = 'a'.repeat(40);
const ISSUE_TITLE = 'Fix: the "login" page\nbaseSha=' + 'b'.repeat(40);

describe('serializeLockOutputs', () => {
	it('emits every fact as key=value lines in a fixed order', () => {
		const out = serializeLockOutputs({
			seenCommentIds: [101, 2002],
			acquired: true,
			needsAgent: false,
			rung: 'build-task',
			baseSha: SHA,
			lockSha: 'c'.repeat(64),
			continueTip: SHA,
			handoffName: handoffName('issue:12', 2),
			agentTimeoutMinutes: 90,
			originTrust: 'untrusted',
			documentMode: 'propose',
		});
		expect(out).toBe(
			[
				'acquired=true',
				'needsAgent=false',
				'rung=build-task',
				`baseSha=${SHA}`,
				`lockSha=${'c'.repeat(64)}`,
				`continueTip=${SHA}`,
				'handoffName=dorfl-handoff-issue-12-attempt-2',
				'agentTimeoutMinutes=90',
				'originTrust=untrusted',
				'documentMode=propose',
				'seenCommentIds=101,2002',
				'',
			].join('\n'),
		);
		expect(serializeLockOutputs({acquired: false})).toBe('acquired=false\n');
	});

	it('refuses free text: an issue title in any output', () => {
		const keys: Array<keyof LockOutputs> = [
			'rung',
			'baseSha',
			'lockSha',
			'continueTip',
			'handoffName',
			'originTrust',
			'documentMode',
			'acquired',
			'agentTimeoutMinutes',
		];
		for (const key of keys) {
			expect(
				() =>
					serializeLockOutputs({
						[key]: ISSUE_TITLE,
					} as unknown as LockOutputs),
				key,
			).toThrow(LockOutputRefused);
		}
		expect(() =>
			serializeLockOutputs({
				seenCommentIds: [ISSUE_TITLE] as unknown as number[],
			}),
		).toThrow(LockOutputRefused);
	});

	it('refuses an unknown key', () => {
		expect(() =>
			serializeLockOutputs({
				issueTitle: 'hello',
			} as unknown as LockOutputs),
		).toThrow(LockOutputRefused);
	});

	it('refuses out-of-range integers and malformed shas', () => {
		for (const facts of [
			{agentTimeoutMinutes: 0},
			{agentTimeoutMinutes: 7201},
			{agentTimeoutMinutes: 1.5},
			{baseSha: 'A'.repeat(40)},
			{baseSha: SHA.slice(1)},
			{seenCommentIds: [0]},
			{seenCommentIds: [-3]},
			{handoffName: 'dorfl-handoff-task-x'},
		] as LockOutputs[]) {
			expect(() => serializeLockOutputs(facts)).toThrow(LockOutputRefused);
		}
	});
});

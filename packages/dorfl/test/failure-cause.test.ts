import {describe, it, expect} from 'vitest';
import {
	classifyFailureCause,
	failureCauseLabel,
	type FailureCause,
} from '../src/failure-cause.js';

/**
 * `failure-cause-classification-model-vs-git-vs-agent` — the BEST-EFFORT +
 * CONSERVATIVE classifier of a stuck item's failure CAUSE (pure logic, no git).
 * The cross-path-convergence + routing wiring lives in `do.test.ts` /
 * `run.test.ts` (real git). Here we pin the classification itself: each NEW cause
 * is recognised, the conservative default holds, and the labels are stable.
 */

describe('classifyFailureCause — the failure-CAUSE taxonomy', () => {
	it('a thrown CORE wiring/config error (review on, no reviewGate) → config-error', () => {
		// The exact phrasing `integration-core.ts` throws.
		const message =
			'review is on but no review gate is configured — cannot run Gate 2 for ' +
			"'feat' (this is a wiring bug; the gate must not be skipped).";
		expect(classifyFailureCause(message)).toBe('config-error');
	});

	it('config-error is recognised by either stable signature phrase', () => {
		expect(classifyFailureCause('this is a wiring bug somewhere')).toBe(
			'config-error',
		);
		expect(
			classifyFailureCause('no review gate is configured for this run'),
		).toBe('config-error');
	});

	it('a harness-surfaced model/connection outage (post-retry) → transient-infra', () => {
		// The kinds of message a harness surfaces ONCE its own retries are exhausted,
		// or a git/provider outage — distinct from the agent producing bad output.
		const transient = [
			'connection error: ECONNREFUSED 127.0.0.1:443',
			'request to model endpoint timed out after 4 retries',
			'the model endpoint is overloaded (503 Service Unavailable)',
			'fatal: unable to connect to github.com: ETIMEDOUT',
			'getaddrinfo ENOTFOUND api.provider.example',
			'rate-limit exceeded (429), retries exhausted',
			'network is unreachable',
		];
		for (const message of transient) {
			expect(classifyFailureCause(message)).toBe('transient-infra');
		}
	});

	it('a config-error signature WINS over a transient signature (most specific first)', () => {
		// A message that mentions both a wiring bug AND a timeout is a config error —
		// the wiring is the actionable cause, not the (incidental) network word.
		const message = 'wiring bug: the gate timed out because it was never wired';
		expect(classifyFailureCause(message)).toBe('config-error');
	});

	it('CONSERVATIVE DEFAULT: an unrecognised cause stays the generic agent-failed', () => {
		// An agent that ran but produced bad/empty output, or any cause the classifier
		// cannot confidently name, must NOT be force-labelled a specific cause.
		const generic = [
			'the agent failed to build feat.',
			'the agent did nothing',
			'agent exploded',
			'TypeError: cannot read property x of undefined',
			'',
		];
		for (const message of generic) {
			expect(classifyFailureCause(message)).toBe('agent-failed');
		}
	});

	it('undefined / whitespace detail → agent-failed (the safe default)', () => {
		expect(classifyFailureCause(undefined)).toBe('agent-failed');
		expect(classifyFailureCause('   \n  ')).toBe('agent-failed');
	});
});

describe('failureCauseLabel — legible reason prefixes (no second naming scheme)', () => {
	it('the generic agent-failed keeps the historical "agent failed" prefix', () => {
		// So existing reason prose / tests that match /agent failed/ are unchanged.
		expect(failureCauseLabel('agent-failed')).toBe('agent failed');
	});

	it('the NEW causes carry a distinct, legible label', () => {
		expect(failureCauseLabel('transient-infra')).toBe('transient infra');
		expect(failureCauseLabel('config-error')).toBe('config error');
	});

	it('every cause has a label (exhaustive)', () => {
		const causes: FailureCause[] = [
			'transient-infra',
			'config-error',
			'agent-failed',
		];
		for (const cause of causes) {
			expect(failureCauseLabel(cause).length).toBeGreaterThan(0);
		}
	});
});

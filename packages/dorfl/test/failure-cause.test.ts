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

	it('a MALFORMED/UNPARSEABLE Gate-2 verdict → transient-infra (not gate-failed/config-error/agent-failed)', () => {
		// A malformed JSON verdict from the review agent is the stochastic gate output
		// misbehaving — the WORK + wiring are fine, so RE-RUNNING the same work is the
		// natural recovery. Matches both `parseReviewVerdict` throw phrasings + the
		// core's wrapper phrase.
		const parseFailures = [
			"review verdict was not valid JSON: Expected ',' or '}' after property value",
			'PR/code review (Gate 2) ran but its verdict could not be parsed: oops',
			'review agent produced no parseable {verdict, findings} result',
		];
		for (const message of parseFailures) {
			expect(classifyFailureCause(message)).toBe('transient-infra');
		}
	});

	it('the EXISTING config-error wiring signature still wins (no regression from the new parse signature)', () => {
		// The genuine wiring error (review on, no gate) must STILL classify config-error,
		// not be captured by the new parse-failure transient-infra signature.
		const message =
			'review is on but no review gate is configured — cannot run Gate 2 for ' +
			"'feat' (this is a wiring bug; the gate must not be skipped).";
		expect(classifyFailureCause(message)).toBe('config-error');
	});

	it('a config-error signature WINS over a transient signature (most specific first)', () => {
		// A message that mentions both a wiring bug AND a timeout is a config error —
		// the wiring is the actionable cause, not the (incidental) network word.
		const message = 'wiring bug: the gate timed out because it was never wired';
		expect(classifyFailureCause(message)).toBe('config-error');
	});

	it('a harness-surfaced credential-expiry / 401 authentication_required → needs-reauth', () => {
		// The EXACT 401 body observed on a CI `advance` run (see the source PRD /
		// discharged observation). This must classify as `needs-reauth`, NOT
		// `transient-infra` (retry cannot help) and NOT `agent-failed` (the WORK is
		// fine — the credential expired).
		const observed =
			'401 {"error":{"type":"authentication_required","message":"OAuth ' +
			'refresh token expired or revoked. Run: node scripts/oauth-login.js"}}';
		expect(classifyFailureCause(observed)).toBe('needs-reauth');

		const variants = [
			'{"error":{"type":"authentication_required"}}',
			'OAuth refresh token expired or revoked',
			'OAuth token revoked',
			'refresh token invalid',
			'HTTP 401: token has expired, please re-authenticate',
			'unauthorized (401): auth credential missing',
		];
		for (const message of variants) {
			expect(classifyFailureCause(message)).toBe('needs-reauth');
		}
	});

	it('needs-reauth WINS over transient-infra (retry cannot fix credential expiry)', () => {
		// A 401 body may co-mention words that look transient ("unavailable", 5xx
		// noise from the same log line). The credential-expiry classification must
		// still WIN so the routing layer sends the item to the needs-reauth surface,
		// not to the retry-with-backoff transient-infra path.
		const message =
			'authentication_required: OAuth refresh token expired — the model ' +
			'endpoint is also overloaded (503)';
		expect(classifyFailureCause(message)).toBe('needs-reauth');
	});

	it('a plain 401 without auth/token/credential words stays agent-failed (conservative)', () => {
		// The 401 guard is tight enough not to false-positive on unrelated 401s from
		// tool code that don't mention auth semantics.
		expect(classifyFailureCause('server returned 401 for /health')).toBe(
			'agent-failed',
		);
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
		expect(failureCauseLabel('needs-reauth')).toBe(
			'needs re-auth (credential expired)',
		);
	});

	it('every cause has a label (exhaustive)', () => {
		const causes: FailureCause[] = [
			'transient-infra',
			'needs-reauth',
			'config-error',
			'agent-failed',
		];
		for (const cause of causes) {
			expect(failureCauseLabel(cause).length).toBeGreaterThan(0);
		}
	});
});

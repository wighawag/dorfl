import {describe, it, expect} from 'vitest';
import {placementFolder, resolvePlacement} from '../src/placement.js';

/**
 * Unit tests for the SHARED staging/pool placement resolver (task
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Pure
 * function, so plain table-driven assertions are enough; the integration tests
 * (`placement-precedence.test.ts`) drive each rung end-to-end through the
 * actual tasking path.
 *
 * The four PRECEDENCE rungs (highest wins):
 *
 *   explicit operator flag  >  untrusted-origin \u21d2 staging  >  configured
 *     default  >  built-in (staging)
 *
 * Mirrors the existing untrusted-origin BUILD-propose rule in
 * `integration-core.ts` (a positional twin: that rule resolves MODE; this one
 * resolves POSITION). Same trust signal (`originTrust:`), same
 * "explicit-operator beats the force" shape.
 */

describe('placement.resolvePlacement: precedence chain', () => {
	const ROWS: Array<{
		name: string;
		explicit?: 'staging' | 'pool';
		originTrust?: 'trusted' | 'untrusted';
		configuredDefault?: 'staging' | 'pool';
		expectedChoice: 'staging' | 'pool';
		expectedReason:
			| 'explicit'
			| 'untrusted-origin'
			| 'configured-default'
			| 'built-in';
	}> = [
		// Rung 4 (lowest): nothing set \u21d2 the built-in floor (staging) wins.
		{
			name: 'no inputs \u21d2 built-in floor (staging)',
			expectedChoice: 'staging',
			expectedReason: 'built-in',
		},
		// Rung 3: configured default wins when nothing higher overrides.
		{
			name: 'configured default pool, trusted origin \u21d2 pool (configured)',
			originTrust: 'trusted',
			configuredDefault: 'pool',
			expectedChoice: 'pool',
			expectedReason: 'configured-default',
		},
		{
			name: 'configured default staging, trusted origin \u21d2 staging (configured)',
			originTrust: 'trusted',
			configuredDefault: 'staging',
			expectedChoice: 'staging',
			expectedReason: 'configured-default',
		},
		{
			name: 'unset origin (= trusted), configured pool \u21d2 pool (configured)',
			configuredDefault: 'pool',
			expectedChoice: 'pool',
			expectedReason: 'configured-default',
		},
		// Rung 2: untrusted-origin forces STAGING even with a `pool` default.
		{
			name: 'untrusted origin + configured pool \u21d2 staging (untrusted force)',
			originTrust: 'untrusted',
			configuredDefault: 'pool',
			expectedChoice: 'staging',
			expectedReason: 'untrusted-origin',
		},
		{
			name: 'untrusted origin + configured staging \u21d2 staging (untrusted force still names the rung that DECIDED)',
			originTrust: 'untrusted',
			configuredDefault: 'staging',
			expectedChoice: 'staging',
			// The untrusted-origin rung fires BEFORE configured-default, so the
			// reason names "untrusted-origin" even though configured-default would
			// have arrived at the same choice. That is the honest reading of the
			// precedence chain (the higher rung is the one that decided).
			expectedReason: 'untrusted-origin',
		},
		// Rung 1 (top): explicit operator flag wins over everything, including
		// the untrusted-origin force (the positional analogue of `explicitMerge`
		// overriding `untrusted-origin \u21d2 propose` in `integration-core.ts`).
		{
			name: 'explicit pool + untrusted origin \u21d2 pool (explicit beats untrusted force)',
			explicit: 'pool',
			originTrust: 'untrusted',
			configuredDefault: 'staging',
			expectedChoice: 'pool',
			expectedReason: 'explicit',
		},
		{
			name: 'explicit staging + trusted origin + configured pool \u21d2 staging (explicit beats configured)',
			explicit: 'staging',
			originTrust: 'trusted',
			configuredDefault: 'pool',
			expectedChoice: 'staging',
			expectedReason: 'explicit',
		},
	];

	for (const row of ROWS) {
		it(row.name, () => {
			const result = resolvePlacement({
				explicit: row.explicit,
				originTrust: row.originTrust,
				configuredDefault: row.configuredDefault,
			});
			expect(result.choice).toBe(row.expectedChoice);
			expect(result.reason).toBe(row.expectedReason);
		});
	}
});

describe("placement.placementFolder: maps the side onto a lifecycle's slots", () => {
	const TASK_SLOTS = {staging: 'pre-backlog', pool: 'backlog'};
	// The prd-placement caller passes its own staging/pool slots (the same
	// lifecycle-generic resolver serves both regimes); modelled here with the
	// current prd fixture words `{staging: 'pre-prd', pool: 'prd'}`. These
	// are illustrative slot strings the resolver echoes back, not on-disk names
	// (the real caller threads `prds/proposed`/`prds/ready` via `work-layout`).
	const PRD_SLOTS = {staging: 'pre-prd', pool: 'prd'};

	it('task slots: staging \u2192 pre-backlog, pool \u2192 backlog', () => {
		expect(placementFolder(TASK_SLOTS, 'staging')).toBe('pre-backlog');
		expect(placementFolder(TASK_SLOTS, 'pool')).toBe('backlog');
	});

	it('prd slots (the prd-placement caller): staging \u2192 pre-prd, pool \u2192 prd', () => {
		// The prd-placement caller REUSES this exact resolver with its own slots;
		// this asserts the lifecycle-generic seam holds (the same function serves
		// both).
		expect(placementFolder(PRD_SLOTS, 'staging')).toBe('pre-prd');
		expect(placementFolder(PRD_SLOTS, 'pool')).toBe('prd');
	});
});

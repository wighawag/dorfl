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
 * The PRECEDENCE rungs (highest wins), after the untrusted-forces-staging rung
 * was RETIRED (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`):
 *
 *   explicit operator flag  >  configured default  >  built-in (staging)
 *
 * Author-trust is NO LONGER a rung here: the resolver is a pure precedence over
 * caller-supplied inputs. The trusted-vs-untrusted destination is selected BY
 * THE CALLER (it reads the `originTrust:` stamp and passes the matching
 * `untrusted*LandIn` / `*LandIn` default as `configuredDefault`), so the two
 * call-site tests (`placement-precedence.test.ts` for the tasker,
 * `intake-untrusted-spec-placement.test.ts` for intake) exercise the
 * stamp ⇒ which-default selection.
 */

describe('placement.resolvePlacement: precedence chain', () => {
	const ROWS: Array<{
		name: string;
		explicit?: 'staging' | 'pool';
		configuredDefault?: 'staging' | 'pool';
		expectedChoice: 'staging' | 'pool';
		expectedReason: 'explicit' | 'configured-default' | 'built-in';
	}> = [
		// Rung 3 (lowest): nothing set \u21d2 the built-in floor (staging) wins.
		{
			name: 'no inputs \u21d2 built-in floor (staging)',
			expectedChoice: 'staging',
			expectedReason: 'built-in',
		},
		// Rung 2: configured default wins when nothing higher overrides. The
		// caller already selected the trusted-vs-untrusted default from the stamp;
		// this resolver just consumes it — so a `pool` default is honoured
		// REGARDLESS of author-trust (that was impossible under the old rung).
		{
			name: 'configured pool \u21d2 pool (configured)',
			configuredDefault: 'pool',
			expectedChoice: 'pool',
			expectedReason: 'configured-default',
		},
		{
			name: 'configured staging \u21d2 staging (configured)',
			configuredDefault: 'staging',
			expectedChoice: 'staging',
			expectedReason: 'configured-default',
		},
		// The untrusted destination is JUST a configured default now: the caller
		// resolved `untrusted*LandIn` to a `pool` side and passed it in; the
		// resolver returns `pool`/`configured-default`, NOT a trust rung. This is
		// the "untrusted lands in `ready`" case the old hard rung could not express.
		{
			name: 'caller-selected untrusted default of pool \u21d2 pool (configured; no trust rung)',
			configuredDefault: 'pool',
			expectedChoice: 'pool',
			expectedReason: 'configured-default',
		},
		// Rung 1 (top): explicit operator flag wins over the configured default
		// (the positional analogue of `explicitMerge` in `integration-core.ts`).
		{
			name: 'explicit pool + configured staging \u21d2 pool (explicit beats configured)',
			explicit: 'pool',
			configuredDefault: 'staging',
			expectedChoice: 'pool',
			expectedReason: 'explicit',
		},
		{
			name: 'explicit staging + configured pool \u21d2 staging (explicit beats configured)',
			explicit: 'staging',
			configuredDefault: 'pool',
			expectedChoice: 'staging',
			expectedReason: 'explicit',
		},
	];

	for (const row of ROWS) {
		it(row.name, () => {
			const result = resolvePlacement({
				explicit: row.explicit,
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

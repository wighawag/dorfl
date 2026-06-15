import {describe, it, expect} from 'vitest';
import {
	resolveIntakeIntegrationModes,
	type IntakeIntegrationModes,
} from '../src/intake.js';

/**
 * `intake-per-outcome-integration-modes` (PRD `issue-intake`, US #9): the PURE
 * per-outcome integration mode resolution. Because `intake` decides the artifact
 * TYPE (slice vs PRD) at RUNTIME, a single `--merge`/`--propose` cannot express a
 * type-conditional policy ("merge a PRD but propose a slice") — hence the four
 * GRANULAR flags layered over the two AGGREGATES. This is the unit-test target: a
 * resolution TABLE over the flag set → both per-type modes.
 *
 * The canonical rule (the source of truth: `work/prd-sliced/issue-intake.md`):
 * - granular: `--merge-prd`/`--propose-prd` (PRD), `--merge-slice`/`--propose-slice`
 *   (slice);
 * - aggregates: `--merge` = both-merge, `--propose` = both-propose;
 * - GRANULAR OVERRIDES AGGREGATE;
 * - same type + both modes ⇒ usage ERROR;
 * - unset ⇒ propose for BOTH (default; matches `do`).
 *
 * The resolver COMPOSES `complete.ts`'s `resolveIntegrationMode`
 * (`integrationFromFlags`) for the aggregate axis (reusing its mutual exclusion +
 * error message) and layers the per-type + override rules on top — NOT a forked
 * second resolver.
 */

const both = (
	mode: IntakeIntegrationModes['slice'],
): IntakeIntegrationModes => ({
	slice: mode,
	prd: mode,
});

describe('resolveIntakeIntegrationModes — the per-outcome resolution table', () => {
	it('unset ⇒ propose for BOTH types (the conservative default; matches `do`)', () => {
		expect(resolveIntakeIntegrationModes({})).toEqual(both('propose'));
	});

	it('--merge (aggregate) ⇒ merge BOTH types', () => {
		expect(resolveIntakeIntegrationModes({merge: true})).toEqual(both('merge'));
	});

	it('--propose (aggregate) ⇒ propose BOTH types', () => {
		expect(resolveIntakeIntegrationModes({propose: true})).toEqual(
			both('propose'),
		);
	});

	it('--merge-prd routes per type: merges a PRD, leaves a slice at the default', () => {
		expect(resolveIntakeIntegrationModes({mergePrd: true})).toEqual({
			prd: 'merge',
			slice: 'propose',
		});
	});

	it('--merge-slice routes per type: merges a slice, leaves a PRD at the default', () => {
		expect(resolveIntakeIntegrationModes({mergeSlice: true})).toEqual({
			prd: 'propose',
			slice: 'merge',
		});
	});

	it('--propose-prd over the default propose is still propose for the PRD', () => {
		expect(resolveIntakeIntegrationModes({proposePrd: true})).toEqual(
			both('propose'),
		);
	});

	it('GRANULAR OVERRIDES AGGREGATE: --merge --propose-slice ⇒ PRD merge, slice propose', () => {
		expect(
			resolveIntakeIntegrationModes({merge: true, proposeSlice: true}),
		).toEqual({prd: 'merge', slice: 'propose'});
	});

	it('GRANULAR OVERRIDES AGGREGATE: --propose --merge-prd ⇒ PRD merge, slice propose', () => {
		expect(
			resolveIntakeIntegrationModes({propose: true, mergePrd: true}),
		).toEqual({prd: 'merge', slice: 'propose'});
	});

	it('both granular flags override the aggregate on BOTH axes', () => {
		expect(
			resolveIntakeIntegrationModes({
				merge: true,
				proposePrd: true,
				proposeSlice: true,
			}),
		).toEqual(both('propose'));
	});

	it('same-type-both on the PRD axis (--merge-prd --propose-prd) is a usage ERROR', () => {
		expect(() =>
			resolveIntakeIntegrationModes({mergePrd: true, proposePrd: true}),
		).toThrow(/--merge-prd and --propose-prd are mutually exclusive/i);
	});

	it('same-type-both on the SLICE axis (--merge-slice --propose-slice) is a usage ERROR', () => {
		expect(() =>
			resolveIntakeIntegrationModes({mergeSlice: true, proposeSlice: true}),
		).toThrow(/--merge-slice and --propose-slice are mutually exclusive/i);
	});

	it('the AGGREGATE axis reuses the existing mutual-exclusion (--merge --propose) error', () => {
		expect(() =>
			resolveIntakeIntegrationModes({merge: true, propose: true}),
		).toThrow(/--merge and --propose are mutually exclusive/i);
	});

	it('an UNSET type falls back to the supplied default mode (the per-repo/global config seam)', () => {
		// The CLI passes the per-repo/global config-resolved mode as the fallback so
		// the precedence chain (flag > per-repo > global > default) is preserved.
		expect(resolveIntakeIntegrationModes({}, 'merge')).toEqual(both('merge'));
		// A granular flag still overrides that config default for its own type.
		expect(
			resolveIntakeIntegrationModes({proposeSlice: true}, 'merge'),
		).toEqual({
			prd: 'merge',
			slice: 'propose',
		});
		// An aggregate flag also wins over the config default.
		expect(resolveIntakeIntegrationModes({propose: true}, 'merge')).toEqual(
			both('propose'),
		);
	});

	// `per-transition-integration-mode-slicing-vs-build`: the NEW `slicingIntegration`
	// key is a DIFFERENT resolver (per-LIFECYCLE-TRANSITION, inside the trust
	// boundary), NOT intake's per-EMITTED-TYPE `{slice, prd}` (front door,
	// author-trust). intake's resolver takes a FLAT `IntegrationMode` default (the
	// CLI passes `config.integration`, never `config.slicingIntegration`), so it is
	// structurally independent of the new key.
	it('the intake default is the FLAT `integration` (the CLI passes `config.integration`); it never consults `slicingIntegration`', () => {
		// The fallback the CLI supplies is `config.integration`. A repo that ALSO sets
		// `slicingIntegration:'merge'` must NOT change intake's resolution — the only
		// default intake sees is the `integration` value handed in here.
		expect(resolveIntakeIntegrationModes({}, 'propose')).toEqual(
			both('propose'),
		);
		expect(resolveIntakeIntegrationModes({}, 'merge')).toEqual(both('merge'));
	});
});

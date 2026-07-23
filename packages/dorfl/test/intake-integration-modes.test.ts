import {describe, it, expect} from 'vitest';
import {
	resolveIntakeIntegrationModes,
	type IntakeIntegrationModes,
} from '../src/intake.js';

/**
 * `intake-per-outcome-integration-modes` (PRD `issue-intake`, US #9): the PURE
 * per-outcome integration mode resolution. Because `intake` decides the artifact
 * TYPE (task vs prd) at RUNTIME, a single `--merge`/`--propose` cannot express a
 * type-conditional policy ("merge a prd but propose a task") — hence the four
 * GRANULAR flags layered over the two AGGREGATES. This is the unit-test target: a
 * resolution TABLE over the flag set → both per-type modes.
 *
 * The canonical rule (the source of truth: `work/prds/tasked/issue-intake.md`):
 * - granular: `--merge-spec`/`--propose-spec` (prd), `--merge-task`/`--propose-task`
 *   (task);
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
	mode: IntakeIntegrationModes['task'],
): IntakeIntegrationModes => ({
	task: mode,
	// prd → spec cutover: the OUTPUT mode key is `spec` (canonical); the INPUT flag
	// fields (`mergeSpec`/`proposeSpec`) carry the same `spec` spelling because they
	// map onto the `--merge-spec`/`--propose-spec` CLI flags (renamed in batch 4f).
	spec: mode,
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

	it('--merge-spec routes per type: merges a prd, leaves a task at the default', () => {
		expect(resolveIntakeIntegrationModes({mergeSpec: true})).toEqual({
			spec: 'merge',
			task: 'propose',
		});
	});

	it('--merge-task routes per type: merges a task, leaves a prd at the default', () => {
		expect(resolveIntakeIntegrationModes({mergeTask: true})).toEqual({
			spec: 'propose',
			task: 'merge',
		});
	});

	it('--propose-spec over the default propose is still propose for the prd', () => {
		expect(resolveIntakeIntegrationModes({proposeSpec: true})).toEqual(
			both('propose'),
		);
	});

	it('GRANULAR OVERRIDES AGGREGATE: --merge --propose-task ⇒ prd merge, task propose', () => {
		expect(
			resolveIntakeIntegrationModes({merge: true, proposeTask: true}),
		).toEqual({spec: 'merge', task: 'propose'});
	});

	it('GRANULAR OVERRIDES AGGREGATE: --propose --merge-spec ⇒ prd merge, task propose', () => {
		expect(
			resolveIntakeIntegrationModes({propose: true, mergeSpec: true}),
		).toEqual({spec: 'merge', task: 'propose'});
	});

	it('both granular flags override the aggregate on BOTH axes', () => {
		expect(
			resolveIntakeIntegrationModes({
				merge: true,
				proposeSpec: true,
				proposeTask: true,
			}),
		).toEqual(both('propose'));
	});

	it('same-type-both on the PRD axis (--merge-spec --propose-spec) is a usage ERROR', () => {
		expect(() =>
			resolveIntakeIntegrationModes({mergeSpec: true, proposeSpec: true}),
		).toThrow(/--merge-spec and --propose-spec are mutually exclusive/i);
	});

	it('same-type-both on the TASK axis (--merge-task --propose-task) is a usage ERROR', () => {
		expect(() =>
			resolveIntakeIntegrationModes({mergeTask: true, proposeTask: true}),
		).toThrow(/--merge-task and --propose-task are mutually exclusive/i);
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
		expect(resolveIntakeIntegrationModes({proposeTask: true}, 'merge')).toEqual(
			{
				spec: 'merge',
				task: 'propose',
			},
		);
		// An aggregate flag also wins over the config default.
		expect(resolveIntakeIntegrationModes({propose: true}, 'merge')).toEqual(
			both('propose'),
		);
	});

	// `intake-integration-knob-and-specs-land-in-proposed-rename`: the intake
	// DOCUMENT mode default the CLI supplies here is now `intakeIntegration ??
	// integration` (the per-INTAKE-TRANSITION knob), NOT the tasking transition's
	// `taskingIntegration`. This resolver takes a FLAT `IntegrationMode` default, so
	// it stays structurally independent of BOTH per-transition keys — the CLI
	// chooses WHICH resolved mode to hand in (cli.ts: `config.intakeIntegration ??
	// config.integration`). The explicit `--merge-*`/`--propose-*` flags still win
	// over the default (operator-present, top of precedence — asserted above).
	it('the intake default is a FLAT mode handed in by the CLI (now `intakeIntegration ?? integration`); the resolver never consults `taskingIntegration`', () => {
		// The fallback the CLI supplies is `config.intakeIntegration ??
		// config.integration`. Whatever single mode is handed in, an UNSET type
		// resolves to it; a repo's `taskingIntegration` is a DIFFERENT transition and
		// never reaches this resolver.
		expect(resolveIntakeIntegrationModes({}, 'propose')).toEqual(
			both('propose'),
		);
		expect(resolveIntakeIntegrationModes({}, 'merge')).toEqual(both('merge'));
		// The operator-present override still tops the config default: an explicit
		// --propose-task wins over an intakeIntegration:merge default for the task.
		expect(resolveIntakeIntegrationModes({proposeTask: true}, 'merge')).toEqual(
			{
				spec: 'merge',
				task: 'propose',
			},
		);
	});
});

/**
 * The BUILD/SLICE TICK capability emitter (PRD `runner-in-ci`, slice
 * `install-ci-build-slice-tick-workflow`; capabilities A auto-build + B
 * auto-slice). A SELF-REGISTERING module: it calls {@link registerCapability} at
 * import time, so {@link loadCapabilityRegistry} picks it up WITHOUT any edit to a
 * shared central list/switch (the file-orthogonality contract — this slice and the
 * sibling capability slices stay mergeable in parallel).
 *
 * The workflow shape + its structural validator live in
 * `build-slice-tick-template.ts`; this file is the thin registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	BUILD_SLICE_TICK_CAPABILITY_ID,
	BUILD_SLICE_TICK_CAPABILITY_LABEL,
	BUILD_SLICE_TICK_WORKFLOW_PATH,
	generateBuildSliceTickWorkflow,
} from '../build-slice-tick-template.js';

registerCapability({
	id: BUILD_SLICE_TICK_CAPABILITY_ID,
	label: BUILD_SLICE_TICK_CAPABILITY_LABEL,
	emit(config) {
		return [
			{
				path: BUILD_SLICE_TICK_WORKFLOW_PATH,
				content: generateBuildSliceTickWorkflow(config),
			},
		];
	},
});

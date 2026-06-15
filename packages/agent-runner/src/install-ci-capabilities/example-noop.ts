/**
 * REFERENCE capability registration (PRD `runner-in-ci`, slice
 * `install-ci-core-and-github-adapter`). This file proves the capability-emitter
 * REGISTRY seam works as a DIRECTORY of self-registering modules: a new capability
 * is a NEW file in `install-ci-capabilities/` that calls {@link registerCapability}
 * at import time — NOT an edit to a shared central list/switch. The four sibling
 * capability slices (build-tick, advance-lifecycle, intake, close-job) each ADD
 * their own file here exactly like this one, so they stay file-orthogonal and
 * mergeable in parallel (WORK-CONTRACT slice-quality / `to-slices` §3).
 *
 * It is a no-op example: it emits NO files (this core slice ships no capability
 * workflow). Its presence + pickup by {@link loadCapabilityRegistry} is the proof
 * that registration needs no shared-file edit.
 */

import {registerCapability} from '../install-ci-core.js';

registerCapability({
	id: 'example-noop',
	label: 'Example (no-op reference capability)',
	emit() {
		return [];
	},
});

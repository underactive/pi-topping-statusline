import assert from "node:assert/strict";
import test from "node:test";
import { resetCapabilitiesCache, setCapabilities, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { renderCometBar } from "@underactive/pi-topping-primitives/color";
import { renderCompactionBar } from "../compaction-bar.ts";

// The bar's geometry, glyphs, clamping and 256-color path are tested where the renderer lives:
// @underactive/pi-topping-primitives tests/color-comet-bar.test.ts.

test("the compaction bar is the shared comet bar, with shimmerElapsedMs as its elapsed time", () => {
	for (const mode of ["truecolor", "256color"] as const) {
		assert.equal(
			renderCompactionBar(50, { mode, shimmerElapsedMs: 500 }),
			renderCometBar(50, { mode, elapsedMs: 500 }),
		);
	}
});

test("default bar color follows terminal capability detection", () => {
	try {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		resetCapabilitiesCache();
		assert.match(renderCompactionBar(50), /\x1b\[38;2;/);
	} finally {
		setCapabilityOverrides({});
		resetCapabilitiesCache();
	}
});

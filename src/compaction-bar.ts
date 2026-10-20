/**
 * The compaction bar: the shared phosphor comet bar from the primitives package, drawn with the
 * same cells and trough glyphs as the context graph. This module reads the terminal's colour
 * depth for it.
 */
import { renderCometBar } from "@underactive/pi-topping-primitives/color";
import { detectColorMode } from "./theme.js";
import type { ColorMode } from "./theme.js";

export function renderCompactionBar(
	percent: number,
	opts: { mode?: ColorMode; shimmerElapsedMs?: number } = {},
): string {
	return renderCometBar(percent, {
		mode: opts.mode ?? detectColorMode(),
		elapsedMs: opts.shimmerElapsedMs,
	});
}
